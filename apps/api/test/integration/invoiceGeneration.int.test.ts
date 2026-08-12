// Integration tests — FR-40 invoice draft generation on JO completion.
// Guarded like the rest of the DB-backed suite; RUN_DB_TESTS=1.
import { randomUUID } from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { buildApp } from '../../src/app.js';
import { signAccessToken } from '../../src/auth/tokens.js';

const run = process.env.RUN_DB_TESTS ? describe : describe.skip;
const SECRET = process.env.JWT_ACCESS_SECRET ?? 'test-secret';
const bearer = (user: { id: string; roles: string[]; branch: string }) =>
  `Bearer ${signAccessToken({ sub: user.id, roles: user.roles as any, branch: user.branch, mfaComplete: true }, SECRET)}`;

run('Invoice generation (integration)', () => {
  let prisma: PrismaClient;
  let app: ReturnType<typeof buildApp>;
  let sup: any, tech: any, director: any;
  let clientSG: any, vesselSG: any;
  let uniq: string;

  beforeAll(async () => {
    prisma = new PrismaClient();
    const presignPut = async () => ({ uploadUrl: 'http://minio/local', headers: {} });
    app = buildApp({ prisma, accessSecret: SECRET, presignPut });
    await app.ready();
    sup = await prisma.user.findUniqueOrThrow({ where: { email: 'ops@tkmr.local' } });
    tech = await prisma.user.findUniqueOrThrow({ where: { email: 'tech@tkmr.local' } });
    director = await prisma.user.findUniqueOrThrow({ where: { email: 'director@tkmr.local' } });
    clientSG = await prisma.client.findFirstOrThrow({ where: { branch: 'SG', deletedAt: null } });
    vesselSG = await prisma.vessel.findFirstOrThrow({ where: { clientId: clientSG.id, deletedAt: null } });
    uniq = Date.now().toString().slice(-9);
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  async function createDraftJobOrder(suffix: string) {
    return prisma.jobOrder.create({
      data: {
        joNumber: `SG-INVTEST-${uniq}-${suffix}`,
        branch: 'SG',
        clientId: clientSG.id,
        vesselId: vesselSG.id,
        scopeSummary: `Invoice generation fixture ${suffix}`,
        origin: 'MANUAL',
        quotedAmountMinor: 100000,
        quotedCurrency: 'SGD',
        labourRateAmountMinor: 9000,
        labourRateCurrency: 'SGD',
        state: 'DRAFT',
        createdBy: sup.id,
      },
    });
  }

  async function driveToCompleted(jobOrderId: string): Promise<void> {
    let jo = await prisma.jobOrder.findUniqueOrThrow({ where: { id: jobOrderId } });
    const assign = await app.inject({
      method: 'POST',
      url: `/api/v1/job-orders/${jobOrderId}/assign`,
      headers: { authorization: bearer(sup) },
      payload: { technicianIds: [tech.id], executionOwnerId: tech.id, version: jo.version },
    });
    expect(assign.statusCode).toBe(200);

    jo = await prisma.jobOrder.findUniqueOrThrow({ where: { id: jobOrderId } });
    const schedule = await app.inject({
      method: 'POST',
      url: `/api/v1/job-orders/${jobOrderId}/transition`,
      headers: { authorization: bearer(sup) },
      payload: { to: 'SCHEDULED', version: jo.version },
    });
    expect(schedule.statusCode).toBe(200);

    jo = await prisma.jobOrder.findUniqueOrThrow({ where: { id: jobOrderId } });
    const start = await app.inject({
      method: 'POST',
      url: `/api/v1/job-orders/${jobOrderId}/transition`,
      headers: { authorization: bearer(tech) },
      payload: { to: 'IN_PROGRESS', version: jo.version },
    });
    expect(start.statusCode).toBe(200);

    jo = await prisma.jobOrder.findUniqueOrThrow({ where: { id: jobOrderId } });
    const review = await app.inject({
      method: 'POST',
      url: `/api/v1/job-orders/${jobOrderId}/transition`,
      headers: { authorization: bearer(tech) },
      payload: { to: 'PENDING_REVIEW', version: jo.version },
    });
    expect(review.statusCode).toBe(200);

    jo = await prisma.jobOrder.findUniqueOrThrow({ where: { id: jobOrderId } });
    const complete = await app.inject({
      method: 'POST',
      url: `/api/v1/job-orders/${jobOrderId}/transition`,
      headers: { authorization: bearer(sup) },
      payload: { to: 'COMPLETED', version: jo.version },
    });
    expect(complete.statusCode).toBe(200);
  }

  it('generates one DRAFT invoice with labour, material, approved variation lines when a JO reaches COMPLETED', async () => {
    const jo = await createDraftJobOrder('FULL');
    const startedAt = new Date('2026-07-01T00:00:00.000Z');
    const endedAt = new Date('2026-07-01T04:00:00.000Z');
    await prisma.workLog.createMany({
      data: [
        { jobOrderId: jo.id, technicianId: tech.id, startedAt, endedAt },
        { jobOrderId: jo.id, technicianId: tech.id, startedAt: new Date('2026-07-01T05:00:00.000Z'), endedAt: null },
      ],
    });
    await prisma.materialLine.create({
      data: {
        jobOrderId: jo.id,
        description: 'Gasket kit',
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
        { jobOrderId: jo.id, reason: 'Approved extra scope', amountMinor: 30000, amountCurrency: 'SGD', status: 'APPROVED', approverId: director.id },
        { jobOrderId: jo.id, reason: 'Rejected scope', amountMinor: 88888, amountCurrency: 'SGD', status: 'REJECTED', approverId: director.id },
      ],
    });

    await driveToCompleted(jo.id);

    const invoices = await prisma.invoice.findMany({ where: { jobOrderId: jo.id }, include: { lines: true } });
    expect(invoices).toHaveLength(1);
    const invoice = invoices[0];
    expect(invoice.status).toBe('DRAFT');
    expect(invoice.issuedAt).toBeNull();
    expect(invoice.billToName).toBe(clientSG.name);
    expect(invoice.billToAddress).toBe(clientSG.address);
    expect(invoice.totalCurrency).toBe('SGD');
    expect(invoice.gstCurrency).toBe('SGD');

    const labourLines = invoice.lines.filter((line) => line.kind === 'LABOUR');
    const materialLines = invoice.lines.filter((line) => line.kind === 'MATERIAL');
    const variationLines = invoice.lines.filter((line) => line.kind === 'VARIATION');
    expect(labourLines).toHaveLength(1);
    expect(materialLines).toHaveLength(1);
    expect(variationLines).toHaveLength(1);
    expect(Number(labourLines[0].quantity)).toBe(4);
    expect(labourLines[0].lineTotalAmountMinor).toBe(4 * 9000);
    expect(Number(materialLines[0].quantity)).toBe(2);
    expect(materialLines[0].lineTotalAmountMinor).toBe(2 * 5000);
    expect(variationLines[0].lineTotalAmountMinor).toBe(30000);
    expect(invoice.totalAmountMinor).toBe(4 * 9000 + 2 * 5000 + 30000);
    expect(invoice.gstAmountMinor).toBe(Math.round(invoice.totalAmountMinor * (Number(process.env.GST_RATE_PERCENT ?? '9') / 100)));
    expect(await prisma.auditEntry.count({ where: { entityType: 'Invoice', entityId: invoice.id, action: 'CREATE' } })).toBe(1);
  });

  it('generates a zero-total DRAFT invoice for a completed JO with no billable lines', async () => {
    const jo = await createDraftJobOrder('ZERO');

    await driveToCompleted(jo.id);

    const invoice = await prisma.invoice.findFirstOrThrow({ where: { jobOrderId: jo.id }, include: { lines: true } });
    expect(invoice.status).toBe('DRAFT');
    expect(invoice.issuedAt).toBeNull();
    expect(invoice.totalAmountMinor).toBe(0);
    expect(invoice.totalCurrency).toBe('SGD');
    expect(invoice.gstAmountMinor).toBe(0);
    expect(invoice.lines).toHaveLength(0);
  });

  it('D-011/CC-9: a WorkLog bills at its OWN snapshotted rate, even if the JobOrder.labourRate changes afterward', async () => {
    const jo = await prisma.jobOrder.create({
      data: {
        joNumber: `SG-INVTEST-RATECHANGE-${uniq}`,
        branch: 'SG',
        clientId: clientSG.id,
        vesselId: vesselSG.id,
        scopeSummary: 'Rate-change immutability fixture',
        origin: 'MANUAL',
        quotedAmountMinor: 100000,
        quotedCurrency: 'SGD',
        state: 'DRAFT',
        createdBy: sup.id,
        labourRateAmountMinor: 8000,
        labourRateCurrency: 'SGD',
        assignedTechnicianIds: [tech.id],
        executionOwnerId: tech.id,
      },
    });

    await prisma.$executeRaw`
      INSERT INTO "WorkLog" (
        "id", "jobOrderId", "technicianId", "startedAt", "endedAt",
        "labourRateAmountMinor", "labourRateCurrency"
      )
      VALUES (
        ${randomUUID()}, ${jo.id}, ${tech.id},
        ${new Date('2026-07-01T00:00:00Z')}, ${new Date('2026-07-01T01:00:00Z')},
        ${8000}, ${'SGD'}
      )
    `;

    await prisma.jobOrder.update({ where: { id: jo.id }, data: { labourRateAmountMinor: 20000 } });

    let v = (await prisma.jobOrder.findUniqueOrThrow({ where: { id: jo.id } })).version;
    const sched = await app.inject({
      method: 'POST',
      url: `/api/v1/job-orders/${jo.id}/transition`,
      headers: { authorization: bearer(sup) },
      payload: { to: 'SCHEDULED', version: v },
    });
    expect(sched.statusCode).toBe(200);
    v = sched.json().version;

    const started = await app.inject({
      method: 'POST',
      url: `/api/v1/job-orders/${jo.id}/transition`,
      headers: { authorization: bearer(tech) },
      payload: { to: 'IN_PROGRESS', version: v },
    });
    expect(started.statusCode).toBe(200);
    v = started.json().version;

    const review = await app.inject({
      method: 'POST',
      url: `/api/v1/job-orders/${jo.id}/transition`,
      headers: { authorization: bearer(tech) },
      payload: { to: 'PENDING_REVIEW', version: v },
    });
    expect(review.statusCode).toBe(200);
    v = review.json().version;

    const completed = await app.inject({
      method: 'POST',
      url: `/api/v1/job-orders/${jo.id}/transition`,
      headers: { authorization: bearer(sup) },
      payload: { to: 'COMPLETED', version: v },
    });
    expect(completed.statusCode).toBe(200);

    const invoice = await prisma.invoice.findFirstOrThrow({ where: { jobOrderId: jo.id }, include: { lines: true } });
    const labourLine = invoice.lines.find((line) => line.kind === 'LABOUR')!;
    expect(labourLine.unitPriceAmountMinor).toBe(8000);
    expect(labourLine.lineTotalAmountMinor).toBe(1 * 8000);
  });

  it('D-031: a currency mismatch in a line source is rejected at the API level, and the JO transition itself rolls back (same transaction)', async () => {
    const jo = await prisma.jobOrder.create({
      data: {
        joNumber: `SG-INVTEST-CURMISMATCH-${uniq}`,
        branch: 'SG',
        clientId: clientSG.id,
        vesselId: vesselSG.id,
        scopeSummary: 'Currency mismatch fixture',
        origin: 'MANUAL',
        quotedAmountMinor: 100000,
        quotedCurrency: 'SGD',
        state: 'DRAFT',
        createdBy: sup.id,
        assignedTechnicianIds: [tech.id],
        executionOwnerId: tech.id,
      },
    });
    await prisma.materialLine.create({
      data: {
        jobOrderId: jo.id,
        description: 'Mis-currency part',
        quantity: 1,
        unit: 'pcs',
        unitCostAmountMinor: 5000,
        unitCostCurrency: 'MYR',
        source: 'FIELD',
        addedById: tech.id,
      },
    });

    let v = jo.version;
    const sched = await app.inject({
      method: 'POST',
      url: `/api/v1/job-orders/${jo.id}/transition`,
      headers: { authorization: bearer(sup) },
      payload: { to: 'SCHEDULED', version: v },
    });
    expect(sched.statusCode).toBe(200);
    v = sched.json().version;

    const started = await app.inject({
      method: 'POST',
      url: `/api/v1/job-orders/${jo.id}/transition`,
      headers: { authorization: bearer(tech) },
      payload: { to: 'IN_PROGRESS', version: v },
    });
    expect(started.statusCode).toBe(200);
    v = started.json().version;

    const review = await app.inject({
      method: 'POST',
      url: `/api/v1/job-orders/${jo.id}/transition`,
      headers: { authorization: bearer(tech) },
      payload: { to: 'PENDING_REVIEW', version: v },
    });
    expect(review.statusCode).toBe(200);
    v = review.json().version;

    const completed = await app.inject({
      method: 'POST',
      url: `/api/v1/job-orders/${jo.id}/transition`,
      headers: { authorization: bearer(sup) },
      payload: { to: 'COMPLETED', version: v },
    });

    expect(completed.statusCode).toBe(400);
    expect(completed.json().error.code).toBe('VALIDATION_ERROR');
    expect(completed.json().error.message).toMatch(/does not match invoice currency/);

    const freshJo = await prisma.jobOrder.findUniqueOrThrow({ where: { id: jo.id } });
    expect(freshJo.state).toBe('PENDING_REVIEW');
    expect(freshJo.version).toBe(v);
    expect(await prisma.invoice.count({ where: { jobOrderId: jo.id } })).toBe(0);
  });

  it('D-031: attempting to generate an invoice for an unsupported branch (non-SG) is rejected explicitly', async () => {
    const admin = await prisma.user.findUniqueOrThrow({ where: { email: 'admin@tkmr.local' } });
    const clientMY = await prisma.client.upsert({
      where: { id: 'client-inttest-invoice-my' },
      update: {},
      create: { id: 'client-inttest-invoice-my', branch: 'MY', name: 'Invoice Test MY Client' },
    });
    const vesselMY = await prisma.vessel.upsert({
      where: { imoNumber: `4${uniq}` },
      update: {},
      create: { clientId: clientMY.id, imoNumber: `4${uniq}`, name: 'MV Invoice Test MY' },
    });
    const joMY = await prisma.jobOrder.create({
      data: {
        joNumber: `MY-INVTEST-${uniq}`,
        branch: 'MY',
        clientId: clientMY.id,
        vesselId: vesselMY.id,
        scopeSummary: 'Unsupported-branch invoice fixture',
        origin: 'MANUAL',
        quotedAmountMinor: 100000,
        quotedCurrency: 'MYR',
        state: 'DRAFT',
        createdBy: admin.id,
        assignedTechnicianIds: [admin.id],
        executionOwnerId: admin.id,
      },
    });

    let v = joMY.version;
    const sched = await app.inject({
      method: 'POST',
      url: `/api/v1/job-orders/${joMY.id}/transition`,
      headers: { authorization: bearer(admin) },
      payload: { to: 'SCHEDULED', version: v },
    });
    expect(sched.statusCode).toBe(200);
    v = sched.json().version;

    const started = await app.inject({
      method: 'POST',
      url: `/api/v1/job-orders/${joMY.id}/transition`,
      headers: { authorization: bearer(admin) },
      payload: { to: 'IN_PROGRESS', version: v },
    });
    expect(started.statusCode).toBe(200);
    v = started.json().version;

    const review = await app.inject({
      method: 'POST',
      url: `/api/v1/job-orders/${joMY.id}/transition`,
      headers: { authorization: bearer(admin) },
      payload: { to: 'PENDING_REVIEW', version: v },
    });
    expect(review.statusCode).toBe(200);
    v = review.json().version;

    const completed = await app.inject({
      method: 'POST',
      url: `/api/v1/job-orders/${joMY.id}/transition`,
      headers: { authorization: bearer(admin) },
      payload: { to: 'COMPLETED', version: v },
    });

    expect(completed.statusCode).toBe(400);
    expect(completed.json().error.message).toMatch(/not yet supported for auto-invoicing/);
    const freshJoMY = await prisma.jobOrder.findUniqueOrThrow({ where: { id: joMY.id } });
    expect(freshJoMY.state).toBe('PENDING_REVIEW');
    expect(freshJoMY.version).toBe(v);
    expect(await prisma.invoice.count({ where: { jobOrderId: joMY.id } })).toBe(0);
  });
});
