import { randomUUID } from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { Storage } from '@marinex360/storage';
import pdfParse from 'pdf-parse';
import { generateJobOrderReport } from '../src/jobs/generateJobOrderReport.js';

const run = process.env.RUN_WORKER_TESTS ? describe : describe.skip;

run('generateJobOrderReport worker integration', () => {
  const prisma = new PrismaClient();
  const storage = Storage.fromEnv();
  let jobOrderId: string;
  let joNumber: string;

  beforeAll(async () => {
    const uniq = Date.now().toString().slice(-9);
    const user = await prisma.user.findFirstOrThrow({ where: { roles: { has: 'DIRECTOR' } } });
    const client = await prisma.client.create({ data: { branch: 'SG', name: `Report PDF Client ${uniq}` } });
    const vessel = await prisma.vessel.create({ data: { clientId: client.id, imoNumber: `8${uniq}01`.slice(0, 12), name: `MV Report PDF ${uniq}` } });
    joNumber = `SG-RPDF-${uniq}`;
    const jobOrder = await prisma.jobOrder.create({
      data: {
        joNumber,
        branch: 'SG',
        clientId: client.id,
        vesselId: vessel.id,
        serviceCategories: ['inspection'],
        scopeSummary: 'Report PDF fixture',
        origin: 'MANUAL',
        quotedAmountMinor: 10000,
        quotedCurrency: 'SGD',
        state: 'COMPLETED',
        createdBy: user.id,
        checklistItems: { create: [{ label: 'Sea trial complete', sortOrder: 1, checked: true }] },
        observations: { create: [{ body: 'All checks passed.', authorId: user.id }] },
        materials: {
          create: [{
            description: 'Gasket kit',
            quantity: 1,
            unit: 'pcs',
            unitCostAmountMinor: 5000,
            unitCostCurrency: 'SGD',
            source: 'FIELD',
            addedById: user.id,
          }],
        },
        statusHistory: { create: [{ fromState: 'PENDING_REVIEW', toState: 'COMPLETED', actorId: user.id }] },
      },
    });
    jobOrderId = jobOrder.id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('renders a real completion report PDF and writes reportObjectKey', async () => {
    const result = await generateJobOrderReport(jobOrderId);
    expect(result.reportObjectKey).toMatch(/^job-reports\//);

    const jobOrder = await prisma.jobOrder.findUniqueOrThrow({ where: { id: jobOrderId } });
    expect(jobOrder.reportObjectKey).toBe(result.reportObjectKey);

    const bytes = await storage.get(result.reportObjectKey);
    expect(Buffer.from(bytes.slice(0, 4)).toString('ascii')).toBe('%PDF');
    const parsed = await pdfParse(Buffer.from(bytes));
    expect(parsed.text).toContain(joNumber);
    expect(parsed.text).toContain('Sea trial complete');
  });
});
