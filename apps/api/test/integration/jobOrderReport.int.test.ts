import { randomUUID } from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { Queue } from 'bullmq';
import { buildApp } from '../../src/app.js';
import { signAccessToken } from '../../src/auth/tokens.js';

const run = process.env.RUN_DB_TESTS ? describe : describe.skip;
const SECRET = process.env.JWT_ACCESS_SECRET ?? 'test-secret';
const bearer = (user: { id: string; roles: string[]; branch: string }) =>
  `Bearer ${signAccessToken({ sub: user.id, roles: user.roles as any, branch: user.branch, mfaComplete: true }, SECRET)}`;

run('JobOrder report endpoint (integration)', () => {
  let prisma: PrismaClient;
  let app: ReturnType<typeof buildApp>;
  let director: any;
  let admin: any;
  let ops: any;
  let client: any;
  let vessel: any;
  let reportQueue: Queue;

  beforeAll(async () => {
    process.env.S3_ACCESS_KEY_ID ||= 'test-access-key';
    process.env.S3_SECRET_ACCESS_KEY ||= 'test-secret-key';
    process.env.S3_BUCKET ||= 'marinex360-test';
    prisma = new PrismaClient();
    app = buildApp({ prisma, accessSecret: SECRET, presignPut: async () => ({ uploadUrl: 'http://minio/local', headers: {} }) });
    await app.ready();
    director = await prisma.user.findUniqueOrThrow({ where: { email: 'director@tkmr.local' } });
    admin = await prisma.user.findUniqueOrThrow({ where: { email: 'admin@tkmr.local' } });
    ops = await prisma.user.findUniqueOrThrow({ where: { email: 'ops@tkmr.local' } });
    const redisUrl = new URL(process.env.REDIS_URL ?? 'redis://localhost:6379');
    reportQueue = new Queue('job-order-report-generation', { connection: { host: redisUrl.hostname, port: Number(redisUrl.port || 6379) } });
    client = await prisma.client.create({
      data: { branch: 'SG', name: `Report Client ${randomUUID()}`, status: 'ACTIVE' },
    });
    vessel = await prisma.vessel.create({
      data: { clientId: client.id, imoNumber: `REPORT-${randomUUID().slice(0, 12)}`, name: `Report Vessel ${randomUUID().slice(0, 8)}` },
    });
  });

  afterAll(async () => {
    await reportQueue.close();
    await app.close();
    await prisma.$disconnect();
  });

  async function createCompletedJobOrder(reportObjectKey: string | null = null) {
    return prisma.jobOrder.create({
      data: {
        joNumber: `SG-REPORT-${randomUUID().slice(0, 8)}`,
        branch: 'SG',
        clientId: client.id,
        vesselId: vessel.id,
        scopeSummary: 'Report endpoint fixture',
        origin: 'MANUAL',
        quotedAmountMinor: 10000,
        quotedCurrency: 'SGD',
        state: 'COMPLETED',
        reportObjectKey,
        createdBy: director.id,
      },
    });
  }

  it('returns pending before the report object key is written', async () => {
    const jo = await createCompletedJobOrder();
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/job-orders/${jo.id}/report`,
      headers: { authorization: bearer(director) },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'PENDING' });
  });

  it('returns a presigned URL once reportObjectKey is ready', async () => {
    const key = `job-reports/test/${randomUUID()}.pdf`;
    const jo = await createCompletedJobOrder(key);
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/job-orders/${jo.id}/report`,
      headers: { authorization: bearer(director) },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('READY');
    expect(res.json().objectKey).toBe(key);
    expect(res.json().url).toContain(encodeURIComponent(key).replaceAll('%2F', '/'));
  });

  it('lets Director/Admin re-enqueue an existing completed report and marks it pending', async () => {
    const key = `job-reports/test/${randomUUID()}.pdf`;
    const jo = await createCompletedJobOrder(key);
    const beforeCount = (await reportQueue.getJobs(['waiting', 'delayed', 'prioritized', 'paused', 'active', 'completed', 'failed'])).length;

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/job-orders/${jo.id}/report/regenerate`,
      headers: { authorization: bearer(admin) },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'QUEUED' });
    await expect(prisma.jobOrder.findUniqueOrThrow({ where: { id: jo.id } })).resolves.toMatchObject({ reportObjectKey: null });
    expect(await prisma.auditEntry.count({ where: { entityType: 'JobOrder', entityId: jo.id, action: 'REGENERATE_REPORT' } })).toBe(1);
    const jobs = await reportQueue.getJobs(['waiting', 'delayed', 'prioritized', 'paused', 'active', 'completed', 'failed']);
    expect(jobs.length).toBeGreaterThan(beforeCount);
    expect(jobs.some((job) => job.name === 'generate' && job.data.jobOrderId === jo.id)).toBe(true);
  });

  it('blocks report regeneration for non Director/Admin roles and jobs without an existing report', async () => {
    const withReport = await createCompletedJobOrder(`job-reports/test/${randomUUID()}.pdf`);
    const noReport = await createCompletedJobOrder(null);
    const draft = await prisma.jobOrder.create({
      data: {
        joNumber: `SG-REPORT-DRAFT-${randomUUID().slice(0, 8)}`,
        branch: 'SG',
        clientId: client.id,
        vesselId: vessel.id,
        scopeSummary: 'Report draft fixture',
        origin: 'MANUAL',
        quotedAmountMinor: 10000,
        quotedCurrency: 'SGD',
        state: 'DRAFT',
        reportObjectKey: `job-reports/test/${randomUUID()}.pdf`,
        createdBy: director.id,
      },
    });

    const forbidden = await app.inject({
      method: 'POST',
      url: `/api/v1/job-orders/${withReport.id}/report/regenerate`,
      headers: { authorization: bearer(ops) },
    });
    expect(forbidden.statusCode).toBe(403);

    const missingInitialReport = await app.inject({
      method: 'POST',
      url: `/api/v1/job-orders/${noReport.id}/report/regenerate`,
      headers: { authorization: bearer(director) },
    });
    expect(missingInitialReport.statusCode).toBe(400);

    const wrongState = await app.inject({
      method: 'POST',
      url: `/api/v1/job-orders/${draft.id}/report/regenerate`,
      headers: { authorization: bearer(director) },
    });
    expect(wrongState.statusCode).toBe(400);
  });
});
