// Integration tests for FR-43 financial summary. Guarded so unit runs stay DB-free.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { buildApp } from '../../src/app.js';
import { signAccessToken } from '../../src/auth/tokens.js';

const run = process.env.RUN_DB_TESTS ? describe : describe.skip;
const SECRET = process.env.JWT_ACCESS_SECRET ?? 'test-secret';
const bearer = (user: { id: string; roles: string[]; branch: string }) =>
  `Bearer ${signAccessToken({ sub: user.id, roles: user.roles as any, branch: user.branch, mfaComplete: true }, SECRET)}`;

run('Financial summary route (integration)', () => {
  let prisma: PrismaClient;
  let app: ReturnType<typeof buildApp>;
  let sup: any;
  let tech: any;
  let joId: string;

  beforeAll(async () => {
    prisma = new PrismaClient();
    const presignPut = async () => ({ uploadUrl: 'http://minio/local', headers: {} });
    app = buildApp({ prisma, accessSecret: SECRET, presignPut });
    await app.ready();
    sup = await prisma.user.findUniqueOrThrow({ where: { email: 'ops@tkmr.local' } });
    tech = await prisma.user.findUniqueOrThrow({ where: { email: 'tech@tkmr.local' } });
    const uniq = Date.now().toString().slice(-9);
    const client = await prisma.client.create({
      data: { branch: 'SG', name: `Financial Summary Client ${uniq}` },
    });
    const vessel = await prisma.vessel.create({
      data: { clientId: client.id, imoNumber: `6${uniq}01`.slice(0, 12), name: `MV Summary ${uniq}` },
    });
    const jo = await prisma.jobOrder.create({
      data: {
        joNumber: `SG-FINSUM-${uniq}`,
        branch: 'SG',
        clientId: client.id,
        vesselId: vessel.id,
        scopeSummary: 'Financial summary route fixture',
        origin: 'MANUAL',
        quotedAmountMinor: 100000,
        quotedCurrency: 'SGD',
        state: 'COMPLETED',
        createdBy: sup.id,
      },
    });
    joId = jo.id;
    await prisma.workLog.create({
      data: {
        jobOrderId: jo.id,
        technicianId: tech.id,
        startedAt: new Date('2026-07-01T00:00:00Z'),
        endedAt: new Date('2026-07-01T02:00:00Z'),
        labourRateAmountMinor: 9000,
        labourRateCurrency: 'SGD',
      },
    });
    await prisma.materialLine.create({
      data: {
        jobOrderId: jo.id,
        description: 'Gasket',
        quantity: 2,
        unit: 'pcs',
        unitCostAmountMinor: 5000,
        unitCostCurrency: 'SGD',
        source: 'OFFICE',
        addedById: sup.id,
      },
    });
    await prisma.variation.createMany({
      data: [
        { jobOrderId: jo.id, reason: 'Approved extra scope', amountMinor: 30000, amountCurrency: 'SGD', status: 'APPROVED' },
        { jobOrderId: jo.id, reason: 'Rejected extra scope', amountMinor: 99999, amountCurrency: 'SGD', status: 'REJECTED' },
      ],
    });
    await prisma.invoice.create({
      data: {
        invoiceNumber: `SG-FINSUM-INV-${uniq}`,
        jobOrderId: jo.id,
        branch: 'SG',
        status: 'DRAFT',
        billToName: client.name,
        billToAddress: client.address,
        gstAmountMinor: 5220,
        gstCurrency: 'SGD',
        totalAmountMinor: 58000,
        totalCurrency: 'SGD',
      },
    });
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('returns baseline, actual, revenue, and variance for a branch-scoped job order', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/job-orders/${joId}/financial-summary`,
      headers: { authorization: bearer(sup) },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      baselineAmountMinor: 100000,
      baselineCurrency: 'SGD',
      actualAmountMinor: 58000,
      actualCurrency: 'SGD',
      revenueAmountMinor: 58000,
      revenueCurrency: 'SGD',
      varianceAmountMinor: -42000,
    });
  });
});
