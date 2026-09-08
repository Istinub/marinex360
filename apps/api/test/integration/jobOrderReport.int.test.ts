import { randomUUID } from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
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
  let client: any;
  let vessel: any;

  beforeAll(async () => {
    process.env.S3_ACCESS_KEY_ID ||= 'test-access-key';
    process.env.S3_SECRET_ACCESS_KEY ||= 'test-secret-key';
    process.env.S3_BUCKET ||= 'marinex360-test';
    prisma = new PrismaClient();
    app = buildApp({ prisma, accessSecret: SECRET, presignPut: async () => ({ uploadUrl: 'http://minio/local', headers: {} }) });
    await app.ready();
    director = await prisma.user.findUniqueOrThrow({ where: { email: 'director@tkmr.local' } });
    client = await prisma.client.create({
      data: { branch: 'SG', name: `Report Client ${randomUUID()}`, status: 'ACTIVE' },
    });
    vessel = await prisma.vessel.create({
      data: { clientId: client.id, imoNumber: `REPORT-${randomUUID().slice(0, 12)}`, name: `Report Vessel ${randomUUID().slice(0, 8)}` },
    });
  });

  afterAll(async () => {
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
});
