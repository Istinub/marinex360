import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { Storage } from '@marinex360/storage';
import { buildMimeMessage } from '../src/lib/smtpMailer.js';
import { sendInvoiceEmail } from '../src/jobs/sendInvoiceEmail.js';

describe('invoice email MIME builder', () => {
  it('includes recipient, subject, and PDF attachment metadata', () => {
    const mime = buildMimeMessage({
      from: 'MarineX360 <no-reply@marinex.local>',
      to: 'billing@example.test',
      subject: 'Invoice SG-2026-0001',
      text: 'Attached',
      attachments: [{ filename: 'SG-2026-0001.pdf', contentType: 'application/pdf', content: new Uint8Array([37, 80, 68, 70]) }],
    });
    expect(mime).toContain('To: billing@example.test');
    expect(mime).toContain('Subject: Invoice SG-2026-0001');
    expect(mime).toContain('Content-Type: application/pdf; name="SG-2026-0001.pdf"');
  });
});

const runDb = process.env.RUN_DB_TESTS ? describe : describe.skip;

runDb('sendInvoiceEmail (integration)', () => {
  let prisma: PrismaClient;
  let storage: Storage;
  let admin: { id: string };
  let uniq: string;

  beforeAll(async () => {
    prisma = new PrismaClient();
    storage = Storage.fromEnv();
    admin = await prisma.user.findUniqueOrThrow({ where: { email: 'admin@tkmr.local' } });
    uniq = Date.now().toString().slice(-9);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function createInvoice(suffix: string, data: { billToEmail?: string | null; pdfObjectKey?: string | null }) {
    const client = await prisma.client.create({ data: { branch: 'SG', name: `Email Client ${uniq}-${suffix}` } });
    const vessel = await prisma.vessel.create({ data: { clientId: client.id, imoNumber: `5${uniq}${suffix.length}`.slice(0, 12), name: `MV Email ${suffix}` } });
    const jo = await prisma.jobOrder.create({
      data: {
        joNumber: `SG-EMAIL-${uniq}-${suffix}`,
        branch: 'SG',
        clientId: client.id,
        vesselId: vessel.id,
        scopeSummary: `Email fixture ${suffix}`,
        origin: 'MANUAL',
        quotedAmountMinor: 100000,
        quotedCurrency: 'SGD',
        state: 'COMPLETED',
        createdBy: admin.id,
      },
    });
    return prisma.invoice.create({
      data: {
        invoiceNumber: `INV-EMAIL-${uniq}-${suffix}`,
        jobOrderId: jo.id,
        branch: 'SG',
        status: 'SENT',
        billToName: client.name,
        billToEmail: data.billToEmail ?? null,
        pdfObjectKey: data.pdfObjectKey ?? null,
        totalAmountMinor: 100000,
        totalCurrency: 'SGD',
      },
    });
  }

  it('skips without throwing when billToEmail is null', async () => {
    const invoice = await createInvoice('NOEMAIL', { pdfObjectKey: 'invoices/missing/noemail.pdf' });
    const result = await sendInvoiceEmail(invoice.id);
    expect(result).toEqual({ sent: false, reason: 'MISSING_BILL_TO_EMAIL' });
    expect(await prisma.auditEntry.count({ where: { entityType: 'Invoice', entityId: invoice.id, action: 'EMAIL_SKIPPED' } })).toBe(1);
  });

  it('skips without throwing when pdfObjectKey is missing', async () => {
    const invoice = await createInvoice('NOPDF', { billToEmail: `billing-${uniq}@example.test` });
    const result = await sendInvoiceEmail(invoice.id);
    expect(result).toEqual({ sent: false, reason: 'MISSING_PDF_OBJECT_KEY' });
    expect(await prisma.auditEntry.count({ where: { entityType: 'Invoice', entityId: invoice.id, action: 'EMAIL_SKIPPED' } })).toBe(1);
  });

  it('records EMAIL_FAILED when SMTP delivery fails', async () => {
    const key = `invoices/test/${uniq}/failed.pdf`;
    await storage.put(key, new Uint8Array([37, 80, 68, 70]), 'application/pdf');
    const invoice = await createInvoice('SMTPFAIL', { billToEmail: `billing-fail-${uniq}@example.test`, pdfObjectKey: key });
    const oldPort = process.env.SMTP_PORT;
    process.env.SMTP_PORT = '1';
    try {
      const result = await sendInvoiceEmail(invoice.id);
      expect(result).toEqual({ sent: false, reason: 'SEND_FAILED' });
    } finally {
      if (oldPort == null) delete process.env.SMTP_PORT;
      else process.env.SMTP_PORT = oldPort;
    }
    expect(await prisma.auditEntry.count({ where: { entityType: 'Invoice', entityId: invoice.id, action: 'EMAIL_FAILED' } })).toBe(1);
  });

  it('sends via local Maildev SMTP and writes EMAIL_SENT audit', async () => {
    const key = `invoices/test/${uniq}/sent.pdf`;
    await storage.put(key, new Uint8Array([37, 80, 68, 70]), 'application/pdf');
    const invoice = await createInvoice('SENT', { billToEmail: `billing-sent-${uniq}@example.test`, pdfObjectKey: key });
    const smtpHost = process.env.SMTP_HOST ?? '127.0.0.1';
    const smtpPort = Number(process.env.SMTP_PORT ?? '1025');
    const oldHost = process.env.SMTP_HOST;
    const oldPort = process.env.SMTP_PORT;
    process.env.SMTP_HOST = smtpHost;
    process.env.SMTP_PORT = String(smtpPort);
    try {
      const result = await sendInvoiceEmail(invoice.id);
      expect(result).toEqual({ sent: true });
      expect(await prisma.auditEntry.count({ where: { entityType: 'Invoice', entityId: invoice.id, action: 'EMAIL_SENT' } })).toBe(1);
    } finally {
      if (oldHost == null) delete process.env.SMTP_HOST;
      else process.env.SMTP_HOST = oldHost;
      if (oldPort == null) delete process.env.SMTP_PORT;
      else process.env.SMTP_PORT = oldPort;
    }
  });
});
