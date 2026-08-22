// Integration tests for invoice lifecycle routes. Guarded so unit runs stay DB-free.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { Queue } from 'bullmq';
import { buildApp } from '../../src/app.js';
import { signAccessToken } from '../../src/auth/tokens.js';

const run = process.env.RUN_DB_TESTS ? describe : describe.skip;
const SECRET = process.env.JWT_ACCESS_SECRET ?? 'test-secret';
const bearer = (user: { id: string; roles: string[]; branch: string }) =>
  `Bearer ${signAccessToken({ sub: user.id, roles: user.roles as any, branch: user.branch, mfaComplete: true }, SECRET)}`;

run('Invoices (integration)', () => {
  let prisma: PrismaClient;
  let app: ReturnType<typeof buildApp>;
  let pdfQueue: Queue;
  let emailQueue: Queue;
  let admin: any;
  let finance: any;
  let uniq: string;
  let fixtureSeq = 0;

  beforeAll(async () => {
    prisma = new PrismaClient();
    const presignPut = async () => ({ uploadUrl: 'http://minio/local', headers: {} });
    app = buildApp({ prisma, accessSecret: SECRET, presignPut });
    await app.ready();
    const redisUrl = new URL(process.env.REDIS_URL ?? 'redis://localhost:6379');
    pdfQueue = new Queue('invoice-pdf-generation', {
      connection: { host: redisUrl.hostname, port: Number(redisUrl.port || 6379) },
    });
    emailQueue = new Queue('invoice-email-delivery', {
      connection: { host: redisUrl.hostname, port: Number(redisUrl.port || 6379) },
    });
    admin = await prisma.user.findUniqueOrThrow({ where: { email: 'admin@tkmr.local' } });
    finance = await prisma.user.findUniqueOrThrow({ where: { email: 'finance@tkmr.local' } });
    uniq = Date.now().toString().slice(-9);
  });

  afterAll(async () => {
    await pdfQueue?.close();
    await emailQueue?.close();
    await app.close();
    await prisma.$disconnect();
  });

  async function createInvoiceFixture(suffix: string, creditTerms: string | null = 'NET45') {
    fixtureSeq += 1;
    const client = await prisma.client.create({
      data: { branch: 'SG', name: `Invoice Lifecycle Client ${uniq}-${suffix}`, creditTerms },
    });
    const vessel = await prisma.vessel.create({
      data: { clientId: client.id, imoNumber: `9${uniq}${fixtureSeq.toString().padStart(2, '0')}`.slice(0, 12), name: `MV Invoice ${suffix}` },
    });
    const jo = await prisma.jobOrder.create({
      data: {
        joNumber: `SG-INVROUTE-${uniq}-${suffix}`,
        branch: 'SG',
        clientId: client.id,
        vesselId: vessel.id,
        scopeSummary: `Invoice route fixture ${suffix}`,
        origin: 'MANUAL',
        quotedAmountMinor: 100000,
        quotedCurrency: 'SGD',
        state: 'COMPLETED',
        createdBy: admin.id,
      },
    });
    return prisma.invoice.create({
      data: {
        invoiceNumber: `INV-ROUTE-${uniq}-${suffix}`,
        jobOrderId: jo.id,
        branch: 'SG',
        status: 'DRAFT',
        billToName: client.name,
        billToAddress: client.address,
        billToEmail: `billing-${suffix.toLowerCase()}@example.test`,
        gstAmountMinor: 0,
        gstCurrency: 'SGD',
        totalAmountMinor: 100000,
        totalCurrency: 'SGD',
      },
    });
  }

  it('D-034: issues a DRAFT invoice, computes dueAt from client creditTerms, and writes audit', async () => {
    const invoice = await createInvoiceFixture('ISSUE', 'NET45');

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/invoices/${invoice.id}/issue`,
      headers: { authorization: bearer(admin) },
      payload: { version: invoice.version },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe('SENT');
    expect(body.issuedAt).toBeTruthy();
    expect(body.dueAt).toBeTruthy();
    const issuedAt = new Date(body.issuedAt);
    const dueAt = new Date(body.dueAt);
    expect(Math.round((dueAt.getTime() - issuedAt.getTime()) / 86_400_000)).toBe(45);
    expect(body.version).toBe(invoice.version + 1);
    expect(await prisma.auditEntry.count({ where: { entityType: 'Invoice', entityId: invoice.id, action: 'ISSUE' } })).toBe(1);
    const jobs = await pdfQueue.getJobs(['waiting', 'delayed', 'prioritized', 'paused']);
    expect(jobs.some((job) => job.name === 'generate' && job.data.invoiceId === body.id)).toBe(true);
    const emailJobs = await emailQueue.getJobs(['waiting', 'delayed', 'prioritized', 'paused']);
    expect(emailJobs.some((job) => job.name === 'send' && job.data.invoiceId === body.id)).toBe(true);
  });

  it('WEB P3-5: lists invoices and returns detail with lines and payments', async () => {
    const invoice = await createInvoiceFixture('DETAIL');
    await prisma.invoiceLine.create({
      data: {
        invoiceId: invoice.id,
        kind: 'LABOUR',
        description: 'Labour',
        quantity: 1,
        unit: 'hr',
        unitPriceAmountMinor: 100000,
        unitPriceCurrency: 'SGD',
        lineTotalAmountMinor: 100000,
        lineTotalCurrency: 'SGD',
      },
    });
    await prisma.payment.create({
      data: {
        invoiceId: invoice.id,
        amountMinor: 25000,
        currency: 'SGD',
        paidAt: new Date('2026-08-10T00:00:00Z'),
        recordedById: finance.id,
        method: 'BANK_TRANSFER',
        reference: 'PAY-DETAIL',
      },
    });

    const list = await app.inject({ method: 'GET', url: '/api/v1/invoices', headers: { authorization: bearer(finance) } });
    expect(list.statusCode).toBe(200);
    expect(list.json().some((row: any) => row.id === invoice.id)).toBe(true);

    const detail = await app.inject({ method: 'GET', url: `/api/v1/invoices/${invoice.id}`, headers: { authorization: bearer(finance) } });
    expect(detail.statusCode).toBe(200);
    const body = detail.json();
    expect(body.id).toBe(invoice.id);
    expect(body.lines).toHaveLength(1);
    expect(body.payments).toHaveLength(1);
    expect(body.payments[0].amountMinor).toBe(25000);
  });

  it('WEB P3-5: cross-branch direct invoice detail reads are masked as NOT_FOUND', async () => {
    const clientMY = await prisma.client.create({ data: { branch: 'MY', name: `Invoice MY Client ${uniq}` } });
    const vesselMY = await prisma.vessel.create({ data: { clientId: clientMY.id, imoNumber: `6${uniq}44`.slice(0, 12), name: 'MV Invoice MY' } });
    const joMY = await prisma.jobOrder.create({
      data: {
        joNumber: `MY-INVROUTE-${uniq}`,
        branch: 'MY',
        clientId: clientMY.id,
        vesselId: vesselMY.id,
        scopeSummary: 'MY invoice masking fixture',
        origin: 'MANUAL',
        quotedAmountMinor: 100000,
        quotedCurrency: 'MYR',
        state: 'COMPLETED',
        createdBy: admin.id,
      },
    });
    const invoiceMY = await prisma.invoice.create({
      data: {
        invoiceNumber: `INV-ROUTE-${uniq}-MY`,
        jobOrderId: joMY.id,
        branch: 'MY',
        status: 'DRAFT',
        billToName: clientMY.name,
        totalAmountMinor: 100000,
        totalCurrency: 'MYR',
      },
    });

    const res = await app.inject({ method: 'GET', url: `/api/v1/invoices/${invoiceMY.id}`, headers: { authorization: bearer(finance) } });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('NOT_FOUND');
  });

  it('D-034 (corrected): a SENT invoice past dueAt still reads as SENT via the API — no computed-on-read override, stored-status-only', async () => {
    const invoice = await createInvoiceFixture('STORED');
    await prisma.invoice.update({
      where: { id: invoice.id },
      data: { status: 'SENT', issuedAt: new Date('2020-01-01T00:00:00Z'), dueAt: new Date('2020-01-31T00:00:00Z') },
    });

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/invoices/${invoice.id}`,
      headers: { authorization: bearer(admin) },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('SENT');
    const stored = await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
    expect(stored.status).toBe('SENT');
  });
});
