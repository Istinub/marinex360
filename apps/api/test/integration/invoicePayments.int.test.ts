// Integration tests for D-035/CC-12 payment recording. Guarded so unit runs stay DB-free.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { buildApp } from '../../src/app.js';
import { signAccessToken } from '../../src/auth/tokens.js';

const run = process.env.RUN_DB_TESTS ? describe : describe.skip;
const SECRET = process.env.JWT_ACCESS_SECRET ?? 'test-secret';
const bearer = (user: { id: string; roles: string[]; branch: string }) =>
  `Bearer ${signAccessToken({ sub: user.id, roles: user.roles as any, branch: user.branch, mfaComplete: true }, SECRET)}`;

run('Invoice payments (integration)', () => {
  let prisma: PrismaClient;
  let app: ReturnType<typeof buildApp>;
  let finance: any;
  let admin: any;
  let uniq: string;
  let fixtureSeq = 0;

  beforeAll(async () => {
    prisma = new PrismaClient();
    const presignPut = async () => ({ uploadUrl: 'http://minio/local', headers: {} });
    app = buildApp({ prisma, accessSecret: SECRET, presignPut });
    await app.ready();
    finance = await prisma.user.findUniqueOrThrow({ where: { email: 'finance@tkmr.local' } });
    admin = await prisma.user.findUniqueOrThrow({ where: { email: 'admin@tkmr.local' } });
    uniq = Date.now().toString().slice(-9);
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  async function createInvoiceFixture(suffix: string, status: string = 'SENT', totalAmountMinor: number = 100000) {
    fixtureSeq += 1;
    const client = await prisma.client.create({
      data: { branch: 'SG', name: `Payment Client ${uniq}-${suffix}`, creditTerms: 'NET30' },
    });
    const vessel = await prisma.vessel.create({
      data: {
        clientId: client.id,
        imoNumber: `8${uniq}${fixtureSeq.toString().padStart(2, '0')}`.slice(0, 12),
        name: `MV Payment ${suffix}`,
      },
    });
    const jo = await prisma.jobOrder.create({
      data: {
        joNumber: `SG-PAYTEST-${uniq}-${suffix}`,
        branch: 'SG',
        clientId: client.id,
        vesselId: vessel.id,
        scopeSummary: `Payment fixture ${suffix}`,
        origin: 'MANUAL',
        quotedAmountMinor: totalAmountMinor,
        quotedCurrency: 'SGD',
        state: 'COMPLETED',
        createdBy: admin.id,
      },
    });
    return prisma.invoice.create({
      data: {
        invoiceNumber: `INV-PAY-${uniq}-${suffix}`,
        jobOrderId: jo.id,
        branch: 'SG',
        status,
        billToName: client.name,
        billToAddress: client.address,
        gstAmountMinor: 0,
        gstCurrency: 'SGD',
        totalAmountMinor,
        totalCurrency: 'SGD',
        issuedAt: status === 'DRAFT' ? null : new Date('2026-08-01T00:00:00Z'),
        dueAt: status === 'DRAFT' ? null : new Date('2026-08-31T00:00:00Z'),
      },
    });
  }

  async function recordPayment(invoiceId: string, payload: Record<string, unknown>, user = finance) {
    return app.inject({
      method: 'POST',
      url: `/api/v1/invoices/${invoiceId}/payments`,
      headers: { authorization: bearer(user) },
      payload,
    });
  }

  it('recording a partial payment moves SENT -> PARTIAL and writes a Payment audit row', async () => {
    const invoice = await createInvoiceFixture('PARTIAL');

    const res = await recordPayment(invoice.id, {
      amountMinor: 40000,
      currency: 'SGD',
      paidAt: '2026-08-10T00:00:00Z',
      method: 'BANK_TRANSFER',
      reference: 'PAY-PARTIAL',
      version: invoice.version,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe('PARTIAL');
    expect(body.version).toBe(invoice.version + 1);
    expect(body.payments).toHaveLength(1);
    expect(body.payments[0].amountMinor).toBe(40000);
    expect(await prisma.auditEntry.count({ where: { entityType: 'Payment', action: 'RECORD_PAYMENT' } })).toBeGreaterThanOrEqual(1);
  });

  it('a second payment completing the total moves PARTIAL -> PAID', async () => {
    let invoice = await createInvoiceFixture('SECOND');
    const first = await recordPayment(invoice.id, { amountMinor: 45000, currency: 'SGD', version: invoice.version });
    expect(first.statusCode).toBe(200);
    invoice = first.json();

    const second = await recordPayment(invoice.id, { amountMinor: 55000, currency: 'SGD', version: invoice.version });

    expect(second.statusCode).toBe(200);
    const body = second.json();
    expect(body.status).toBe('PAID');
    expect(body.payments).toHaveLength(2);
  });

  it('a single full payment jumps SENT -> PAID directly', async () => {
    const invoice = await createInvoiceFixture('FULL');

    const res = await recordPayment(invoice.id, { amountMinor: 100000, currency: 'SGD', version: invoice.version });

    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('PAID');
  });

  it('negative reversal payments can move PAID back to PARTIAL and then SENT', async () => {
    let invoice = await createInvoiceFixture('REVERSAL');
    let res = await recordPayment(invoice.id, { amountMinor: 100000, currency: 'SGD', version: invoice.version });
    expect(res.statusCode).toBe(200);
    invoice = res.json();
    expect(invoice.status).toBe('PAID');

    res = await recordPayment(invoice.id, { amountMinor: -50000, currency: 'SGD', version: invoice.version });
    expect(res.statusCode).toBe(200);
    invoice = res.json();
    expect(invoice.status).toBe('PARTIAL');

    res = await recordPayment(invoice.id, { amountMinor: -50000, currency: 'SGD', version: invoice.version });
    expect(res.statusCode).toBe(200);
    invoice = res.json();
    expect(invoice.status).toBe('SENT');

    const sum = await prisma.payment.aggregate({ where: { invoiceId: invoice.id }, _sum: { amountMinor: true } });
    expect(sum._sum.amountMinor).toBe(0);
  });

  it('rejects payment recording for a DRAFT invoice', async () => {
    const invoice = await createInvoiceFixture('DRAFT', 'DRAFT');

    const res = await recordPayment(invoice.id, { amountMinor: 1000, currency: 'SGD', version: invoice.version });

    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
    expect(await prisma.payment.count({ where: { invoiceId: invoice.id } })).toBe(0);
  });

  it('rejects currency-mismatched payments', async () => {
    const invoice = await createInvoiceFixture('CURRENCY');

    const res = await recordPayment(invoice.id, { amountMinor: 1000, currency: 'USD', version: invoice.version });

    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
    expect(await prisma.payment.count({ where: { invoiceId: invoice.id } })).toBe(0);
  });

  it('returns VERSION_CONFLICT and rolls back the Payment row on stale version', async () => {
    const invoice = await createInvoiceFixture('STALE');
    await prisma.invoice.update({ where: { id: invoice.id }, data: { version: { increment: 1 } } });

    const res = await recordPayment(invoice.id, { amountMinor: 1000, currency: 'SGD', version: invoice.version });

    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('VERSION_CONFLICT');
    expect(await prisma.payment.count({ where: { invoiceId: invoice.id } })).toBe(0);
  });

  it('writes one AuditEntry for each recorded payment', async () => {
    let invoice = await createInvoiceFixture('AUDIT');
    let res = await recordPayment(invoice.id, { amountMinor: 30000, currency: 'SGD', version: invoice.version });
    expect(res.statusCode).toBe(200);
    invoice = res.json();
    res = await recordPayment(invoice.id, { amountMinor: 30000, currency: 'SGD', version: invoice.version });
    expect(res.statusCode).toBe(200);

    const payments = await prisma.payment.findMany({ where: { invoiceId: invoice.id } });
    const audits = await prisma.auditEntry.findMany({
      where: { entityType: 'Payment', action: 'RECORD_PAYMENT', entityId: { in: payments.map((payment) => payment.id) } },
    });
    expect(payments).toHaveLength(2);
    expect(audits).toHaveLength(2);
  });

  it('does not expose Payment update/delete API routes', async () => {
    const invoice = await createInvoiceFixture('NOEDIT');
    const paymentRes = await recordPayment(invoice.id, { amountMinor: 1000, currency: 'SGD', version: invoice.version });
    expect(paymentRes.statusCode).toBe(200);
    const paymentId = paymentRes.json().payments[0].id;

    const patchRes = await app.inject({
      method: 'PATCH',
      url: `/api/v1/payments/${paymentId}`,
      headers: { authorization: bearer(finance) },
      payload: { amountMinor: 999999 },
    });
    const deleteRes = await app.inject({
      method: 'DELETE',
      url: `/api/v1/payments/${paymentId}`,
      headers: { authorization: bearer(finance) },
    });

    expect(patchRes.statusCode).toBe(404);
    expect(deleteRes.statusCode).toBe(404);
  });
});
