import { randomUUID } from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { buildApp } from '../../src/app.js';
import { signAccessToken } from '../../src/auth/tokens.js';

const run = process.env.RUN_DB_TESTS ? describe : describe.skip;
const SECRET = process.env.JWT_ACCESS_SECRET ?? 'test-secret';
const bearer = (user: { id: string; roles: string[]; branch: string }) =>
  `Bearer ${signAccessToken({ sub: user.id, roles: user.roles as any, branch: user.branch, mfaComplete: true }, SECRET)}`;

run('JobOrder workers (integration)', () => {
  let prisma: PrismaClient;
  let app: ReturnType<typeof buildApp>;
  let tech: any;
  let otherTech: any;
  let director: any;
  let client: any;
  let vessel: any;
  let uniq: string;

  beforeAll(async () => {
    prisma = new PrismaClient();
    app = buildApp({ prisma, accessSecret: SECRET, presignPut: async () => ({ uploadUrl: 'http://minio/local', headers: {} }) });
    await app.ready();
    tech = await prisma.user.findUniqueOrThrow({ where: { email: 'tech@tkmr.local' } });
    otherTech = await prisma.user.findUniqueOrThrow({ where: { email: 'tech2@tkmr.local' } });
    director = await prisma.user.findUniqueOrThrow({ where: { email: 'director@tkmr.local' } });
    uniq = randomUUID().slice(0, 8);
    client = await prisma.client.create({ data: { branch: 'SG', name: `Worker Client ${uniq}` } });
    vessel = await prisma.vessel.create({ data: { clientId: client.id, imoNumber: `WRK${uniq}`.slice(0, 12), name: `MV Worker ${uniq}` } });
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  async function createInProgressJob(ownerId = tech.id) {
    return prisma.jobOrder.create({
      data: {
        joNumber: `SG-WORKER-${randomUUID().slice(0, 8)}`,
        branch: 'SG',
        clientId: client.id,
        vesselId: vessel.id,
        scopeSummary: 'Job worker roster fixture',
        origin: 'MANUAL',
        quotedAmountMinor: 10000,
        quotedCurrency: 'SGD',
        state: 'IN_PROGRESS',
        executionOwnerId: ownerId,
        assignedTechnicianIds: [ownerId],
        createdBy: director.id,
      },
    });
  }

  it('lets the execution owner append and list worker names while already IN_PROGRESS', async () => {
    const jo = await createInProgressJob();
    const add = await app.inject({
      method: 'POST',
      url: `/api/v1/job-orders/${jo.id}/workers`,
      headers: { authorization: bearer(tech) },
      payload: { name: 'Ravi Kumar' },
    });
    expect(add.statusCode).toBe(201);
    expect(add.json().name).toBe('Ravi Kumar');

    const list = await app.inject({
      method: 'GET',
      url: `/api/v1/job-orders/${jo.id}/workers`,
      headers: { authorization: bearer(tech) },
    });
    expect(list.statusCode).toBe(200);
    expect(list.json().map((row: any) => row.name)).toContain('Ravi Kumar');
  });

  it('rejects a non-owner technician adding workers', async () => {
    const jo = await createInProgressJob();
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/job-orders/${jo.id}/workers`,
      headers: { authorization: bearer(otherTech) },
      payload: { name: 'Other Worker' },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('FORBIDDEN');
  });

  it('suggests distinct prior names by recent use', async () => {
    const jo = await createInProgressJob();
    const token = randomUUID().slice(0, 6);
    await prisma.jobOrderWorker.createMany({
      data: [
        { jobOrderId: jo.id, name: `Worker ${token} Alpha`, addedAt: new Date('2026-09-08T01:00:00Z') },
        { jobOrderId: jo.id, name: `worker ${token} alpha`, addedAt: new Date('2026-09-08T02:00:00Z') },
        { jobOrderId: jo.id, name: `Worker ${token} Beta`, addedAt: new Date('2026-09-08T03:00:00Z') },
      ],
    });

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/job-orders/workers/suggest?q=${token}`,
      headers: { authorization: bearer(tech) },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([`Worker ${token} Beta`, `worker ${token} alpha`]);
  });
});
