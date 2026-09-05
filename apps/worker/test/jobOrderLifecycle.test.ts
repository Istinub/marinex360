import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { daysBefore, reconcileJobOrderLifecycle } from '../src/jobs/jobOrderLifecycle.js';

describe('job order lifecycle rules', () => {
  it('computes whole-day cutoffs from the supplied clock', () => {
    expect(daysBefore(new Date('2026-09-05T00:00:00Z'), 30).toISOString()).toBe('2026-08-06T00:00:00.000Z');
  });
});

const runDb = process.env.RUN_DB_TESTS ? describe : describe.skip;

runDb('job order lifecycle job (integration)', () => {
  let prisma: PrismaClient;
  let clientId: string;
  let vesselId: string;
  let actorId: string;

  beforeAll(async () => {
    prisma = new PrismaClient();
    const client = await prisma.client.findFirstOrThrow({ where: { branch: 'SG', deletedAt: null } });
    const vessel = await prisma.vessel.findFirstOrThrow({ where: { clientId: client.id, deletedAt: null } });
    const actor = await prisma.user.findUniqueOrThrow({ where: { email: 'ops@tkmr.local' } });
    clientId = client.id;
    vesselId = vessel.id;
    actorId = actor.id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('auto-purges trashed job orders after 30 days', async () => {
    const now = new Date('2026-09-05T00:00:00Z');
    const oldTrash = await prisma.jobOrder.create({
      data: {
        joNumber: `SG-WORKER-TRASH-OLD-${Date.now()}`,
        branch: 'SG',
        clientId,
        vesselId,
        scopeSummary: 'Old trash lifecycle fixture',
        origin: 'MANUAL',
        quotedAmountMinor: 100000,
        quotedCurrency: 'SGD',
        state: 'DRAFT',
        deletedAt: new Date('2026-08-05T00:00:00Z'),
        createdBy: actorId,
      },
    });
    const freshTrash = await prisma.jobOrder.create({
      data: {
        joNumber: `SG-WORKER-TRASH-FRESH-${Date.now()}`,
        branch: 'SG',
        clientId,
        vesselId,
        scopeSummary: 'Fresh trash lifecycle fixture',
        origin: 'MANUAL',
        quotedAmountMinor: 100000,
        quotedCurrency: 'SGD',
        state: 'DRAFT',
        deletedAt: new Date('2026-08-20T00:00:00Z'),
        createdBy: actorId,
      },
    });

    const result = await reconcileJobOrderLifecycle(now);

    expect(result.purged).toBeGreaterThanOrEqual(1);
    await expect(prisma.jobOrder.findUniqueOrThrow({ where: { id: oldTrash.id } })).resolves.toMatchObject({ purgedAt: now });
    await expect(prisma.jobOrder.findUniqueOrThrow({ where: { id: freshTrash.id } })).resolves.toMatchObject({ purgedAt: null });
  });

  it('auto-archives completed job orders 15 days after their COMPLETED history entry', async () => {
    const now = new Date('2026-09-05T00:00:00Z');
    const completedOld = await prisma.jobOrder.create({
      data: {
        joNumber: `SG-WORKER-ARCHIVE-OLD-${Date.now()}`,
        branch: 'SG',
        clientId,
        vesselId,
        scopeSummary: 'Old completed lifecycle fixture',
        origin: 'MANUAL',
        quotedAmountMinor: 100000,
        quotedCurrency: 'SGD',
        state: 'COMPLETED',
        createdBy: actorId,
      },
    });
    await prisma.jobStatusHistory.create({
      data: {
        jobOrderId: completedOld.id,
        fromState: 'PENDING_REVIEW',
        toState: 'COMPLETED',
        actorId,
        at: new Date('2026-08-20T00:00:00Z'),
      },
    });
    const completedFresh = await prisma.jobOrder.create({
      data: {
        joNumber: `SG-WORKER-ARCHIVE-FRESH-${Date.now()}`,
        branch: 'SG',
        clientId,
        vesselId,
        scopeSummary: 'Fresh completed lifecycle fixture',
        origin: 'MANUAL',
        quotedAmountMinor: 100000,
        quotedCurrency: 'SGD',
        state: 'COMPLETED',
        createdBy: actorId,
      },
    });
    await prisma.jobStatusHistory.create({
      data: {
        jobOrderId: completedFresh.id,
        fromState: 'PENDING_REVIEW',
        toState: 'COMPLETED',
        actorId,
        at: new Date('2026-08-25T00:00:00Z'),
      },
    });

    const result = await reconcileJobOrderLifecycle(now);

    expect(result.archived).toBeGreaterThanOrEqual(1);
    await expect(prisma.jobOrder.findUniqueOrThrow({ where: { id: completedOld.id } })).resolves.toMatchObject({ archivedAt: now });
    await expect(prisma.jobOrder.findUniqueOrThrow({ where: { id: completedFresh.id } })).resolves.toMatchObject({ archivedAt: null });
  });
});
