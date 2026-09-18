import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { Queue } from 'bullmq';
import { buildApp } from '../../src/app.js';
import { signAccessToken } from '../../src/auth/tokens.js';

const run = process.env.RUN_DB_TESTS ? describe : describe.skip;
const SECRET = process.env.JWT_ACCESS_SECRET ?? 'test-secret';
const bearer = (user: { id: string; roles: string[]; branch: string }) =>
  `Bearer ${signAccessToken({ sub: user.id, roles: user.roles as any, branch: user.branch, mfaComplete: true }, SECRET)}`;

run('Quotations (integration)', () => {
  let prisma: PrismaClient;
  let app: ReturnType<typeof buildApp>;
  let queue: Queue;
  let ops: any;
  let admin: any;
  let uniq: string;

  beforeAll(async () => {
    prisma = new PrismaClient();
    app = buildApp({ prisma, accessSecret: SECRET, presignPut: async () => ({ uploadUrl: 'http://minio/local', headers: {} }) });
    await app.ready();
    const redisUrl = new URL(process.env.REDIS_URL ?? 'redis://localhost:6379');
    queue = new Queue('quotation-pdf-generation', { connection: { host: redisUrl.hostname, port: Number(redisUrl.port || 6379) } });
    ops = await prisma.user.findUniqueOrThrow({ where: { email: 'ops@tkmr.local' } });
    admin = await prisma.user.findUniqueOrThrow({ where: { email: 'admin@tkmr.local' } });
    uniq = Date.now().toString().slice(-8);
  });

  afterAll(async () => {
    await queue?.close();
    await app.close();
    await prisma.$disconnect();
  });

  function payload(suffix: string) {
    return {
      branch: 'SG',
      manualClientName: `Quotation Fixture Client ${uniq}-${suffix}`,
      manualVesselName: `MV Quote ${suffix}`,
      category: 'MECHANICAL',
      quotationDate: '2026-09-18',
      location: 'Singapore',
      currency: 'SGD',
      validityDays: 30,
      workDurationText: '3 working days',
      lines: [
        {
          itemCode: 'A',
          description: 'Pump overhaul',
          unit: 'sets',
          quantity: 2,
          unitPrice: 1250,
          remarks: 'Workshop scope',
        },
        {
          itemCode: 'B',
          description: 'Sea trial attendance if required',
          unit: 'lot',
          quantity: null,
          unitPrice: null,
          remarks: 'TBA',
        },
      ],
    };
  }

  it('creates quotations with collision-safe sequence numbers and preserves TBA line amounts', async () => {
    const first = await app.inject({
      method: 'POST',
      url: '/api/v1/quotations',
      headers: { authorization: bearer(ops) },
      payload: payload('ONE'),
    });
    const second = await app.inject({
      method: 'POST',
      url: '/api/v1/quotations',
      headers: { authorization: bearer(admin) },
      payload: payload('TWO'),
    });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    const firstBody = first.json();
    const secondBody = second.json();
    expect(firstBody.quotationNumber).toMatch(/^QT-PTTKMR-26-09-\d{3,}$/);
    expect(secondBody.quotationNumber).toMatch(/^QT-PTTKMR-26-09-\d{3,}$/);
    const firstSeq = Number(firstBody.quotationNumber.split('-').at(-1));
    const secondSeq = Number(secondBody.quotationNumber.split('-').at(-1));
    expect(secondSeq).toBe(firstSeq + 1);
    expect(firstBody.lines[0].amount).toBe('2500');
    expect(firstBody.lines[1].amount).toBeNull();

    const detail = await app.inject({ method: 'GET', url: `/api/v1/quotations/${firstBody.id}`, headers: { authorization: bearer(ops) } });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().lines[1].amount).toBeNull();
  });

  it('edits draft quotations with optimistic concurrency and queues PDF generation', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/quotations',
      headers: { authorization: bearer(admin) },
      payload: payload('EDIT'),
    });
    expect(created.statusCode).toBe(200);
    const quotation = created.json();

    const update = await app.inject({
      method: 'PATCH',
      url: `/api/v1/quotations/${quotation.id}`,
      headers: { authorization: bearer(admin) },
      payload: {
        version: quotation.version,
        category: 'PROPULSION',
        validityDays: 45,
        lines: [
          { description: 'Adjusted propulsion scope', unit: 'hours', quantity: 4, unitPrice: 300 },
          { description: 'Specialist part', unit: 'pcs', quantity: null, unitPrice: null, remarks: 'TBA' },
        ],
      },
    });
    expect(update.statusCode).toBe(200);
    expect(update.json().category).toBe('PROPULSION');
    expect(update.json().validityDays).toBe(45);
    expect(update.json().lines[0].amount).toBe('1200');
    expect(update.json().lines[1].amount).toBeNull();

    const generate = await app.inject({
      method: 'POST',
      url: `/api/v1/quotations/${quotation.id}/generate-pdf`,
      headers: { authorization: bearer(admin) },
    });
    expect(generate.statusCode).toBe(200);
    expect(generate.json()).toEqual({ status: 'QUEUED' });
    const jobs = await queue.getJobs(['waiting', 'delayed', 'prioritized', 'paused', 'active', 'completed', 'failed']);
    expect(jobs.some((job) => job.name === 'generate' && job.data.quotationId === quotation.id)).toBe(true);

    const pdf = await app.inject({ method: 'GET', url: `/api/v1/quotations/${quotation.id}/pdf`, headers: { authorization: bearer(admin) } });
    expect(pdf.statusCode).toBe(200);
    expect(pdf.json()).toEqual({ status: 'PENDING' });
  });
});
