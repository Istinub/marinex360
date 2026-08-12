// Integration tests for invoice lifecycle routes. Guarded so unit runs stay DB-free.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { buildApp } from '../../src/app.js';
import { signAccessToken } from '../../src/auth/tokens.js';

const run = process.env.RUN_DB_TESTS ? describe : describe.skip;
const SECRET = process.env.JWT_ACCESS_SECRET ?? 'test-secret';
const bearer = (user: { id: string; roles: string[]; branch: string }) =>
  `Bearer ${signAccessToken({ sub: user.id, roles: user.roles as any, branch: user.branch, mfaComplete: true }, SECRET)}`;

run('Invoices (integration)', () => {
  let prisma: PrismaClient;
  let app: ReturnType<typeof buildApp>;
  let admin: any;
  let uniq: string;

  beforeAll(async () => {
    prisma = new PrismaClient();
    const presignPut = async () => ({ uploadUrl: 'http://minio/local', headers: {} });
    app = buildApp({ prisma, accessSecret: SECRET, presignPut });
    await app.ready();
    admin = await prisma.user.findUniqueOrThrow({ where: { email: 'admin@tkmr.local' } });
    uniq = Date.now().toString().slice(-9);
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  async function createInvoiceFixture(suffix: string, creditTerms: string | null = 'NET45') {
    const client = await prisma.client.create({
      data: { branch: 'SG', name: `Invoice Lifecycle Client ${uniq}-${suffix}`, creditTerms },
    });
    const vessel = await prisma.vessel.create({
      data: { clientId: client.id, imoNumber: `9${uniq}${suffix.length}`.slice(0, 12), name: `MV Invoice ${suffix}` },
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
  });

  it('D-034: read endpoints report computed OVERDUE without mutating stored invoice status', async () => {
    const invoice = await createInvoiceFixture('OVERDUE');
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
    expect(res.json().status).toBe('OVERDUE');
    const stored = await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
    expect(stored.status).toBe('SENT');
  });
});
