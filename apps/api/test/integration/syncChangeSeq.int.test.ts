// D-012 integration evidence for the monotonic sync cursor. Guarded so unit runs stay DB-free.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { buildApp } from '../../src/app.js';
import { signAccessToken } from '../../src/auth/tokens.js';

const run = process.env.RUN_DB_TESTS ? describe : describe.skip;
const SECRET = process.env.JWT_ACCESS_SECRET ?? 'test-secret';
const bearer = (user: { id: string; roles: string[]; branch: string }) =>
  `Bearer ${signAccessToken({ sub: user.id, roles: user.roles as any, branch: user.branch, mfaComplete: true }, SECRET)}`;

run('Sync assigned changeSeq cursor (integration)', () => {
  let prisma: PrismaClient;
  let app: ReturnType<typeof buildApp>;
  let tech: any;
  let jobOrder: any;

  beforeAll(async () => {
    prisma = new PrismaClient();
    const presignPut = async () => ({ uploadUrl: 'http://minio/local', headers: {} });
    app = buildApp({ prisma, accessSecret: SECRET, presignPut });
    await app.ready();

    tech = await prisma.user.findUniqueOrThrow({ where: { email: 'tech@tkmr.local' } });
    const supervisor = await prisma.user.findUniqueOrThrow({ where: { email: 'ops@tkmr.local' } });
    const client = await prisma.client.findFirstOrThrow({ where: { branch: tech.branch, deletedAt: null } });
    const vessel = await prisma.vessel.findFirstOrThrow({ where: { clientId: client.id, deletedAt: null } });
    const unique = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    jobOrder = await prisma.jobOrder.create({
      data: {
        joNumber: `SG-SYNCSEQ-${unique}`,
        branch: tech.branch,
        clientId: client.id,
        vesselId: vessel.id,
        scopeSummary: 'D-012 changeSeq integration fixture',
        origin: 'MANUAL',
        quotedAmountMinor: 100000,
        quotedCurrency: 'SGD',
        labourRateAmountMinor: 8000,
        labourRateCurrency: 'SGD',
        state: 'SCHEDULED',
        assignedTechnicianIds: [tech.id],
        executionOwnerId: tech.id,
        createdBy: supervisor.id,
      },
    });
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('D-012: two WorkLogs created in immediate succession are BOTH returned in one pass, and NEITHER reappears on the next poll (monotonic changeSeq, no timestamp ties)', async () => {
    const startedAt = new Date('2026-08-29T00:00:00.000Z');
    const workLogData = {
      jobOrderId: jobOrder.id,
      technicianId: tech.id,
      startedAt,
      endedAt: new Date('2026-08-29T01:00:00.000Z'),
      labourRateAmountMinor: 8000,
      labourRateCurrency: 'SGD',
    };
    const wl1 = await prisma.workLog.create({ data: workLogData });
    const wl2 = await prisma.workLog.create({ data: workLogData });
    expect(wl1.changeSeq).not.toBe(wl2.changeSeq);

    const first = await app.inject({
      method: 'GET',
      url: '/api/v1/sync/assigned?since=0',
      headers: { authorization: bearer(tech) },
    });
    expect(first.statusCode).toBe(200);
    const firstBody = first.json();
    const worklogIds = firstBody.children.worklogs.map((worklog: any) => worklog.id);
    expect(worklogIds).toContain(wl1.id);
    expect(worklogIds).toContain(wl2.id);
    expect(firstBody.children.worklogs.every((worklog: any) => typeof worklog.changeSeq === 'string')).toBe(true);

    const second = await app.inject({
      method: 'GET',
      url: `/api/v1/sync/assigned?since=${firstBody.cursor}`,
      headers: { authorization: bearer(tech) },
    });
    expect(second.statusCode).toBe(200);
    const secondIds = second.json().children.worklogs.map((worklog: any) => worklog.id);
    expect(secondIds).not.toContain(wl1.id);
    expect(secondIds).not.toContain(wl2.id);
  });

  it('D-012: an empty poll (nothing changed) echoes the same cursor back, does not advance it', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/sync/assigned?since=999999999',
      headers: { authorization: bearer(tech) },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().cursor).toBe('999999999');
  });

  it('D-012: updating a sync-visible row advances changeSeq and returns it after the prior cursor', async () => {
    const worklog = await prisma.workLog.create({
      data: {
        jobOrderId: jobOrder.id,
        technicianId: tech.id,
        startedAt: new Date('2026-08-29T02:00:00.000Z'),
        labourRateAmountMinor: 8000,
        labourRateCurrency: 'SGD',
      },
    });
    const beforeUpdateCursor = worklog.changeSeq.toString();

    const updated = await prisma.workLog.update({
      where: { id: worklog.id },
      data: { endedAt: new Date('2026-08-29T03:00:00.000Z') },
    });
    expect(updated.changeSeq).toBeGreaterThan(worklog.changeSeq);

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/sync/assigned?since=${beforeUpdateCursor}`,
      headers: { authorization: bearer(tech) },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().children.worklogs.map((row: any) => row.id)).toContain(worklog.id);
  });
});
