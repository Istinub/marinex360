import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { Storage } from '@marinex360/storage';
import pdfParse from 'pdf-parse';
import { generateInvoicePdf } from '../src/jobs/generateInvoicePdf.js';

const run = process.env.RUN_WORKER_TESTS ? describe : describe.skip;

run('generateInvoicePdf (D-036/D-037 worker integration)', () => {
  const prisma = new PrismaClient();
  const storage = Storage.fromEnv();
  let invoiceId: string;

  beforeAll(async () => {
    const uniq = Date.now().toString().slice(-9);
    const user = await prisma.user.findFirstOrThrow({ where: { roles: { has: 'FINANCE' } } });
    const client = await prisma.client.create({
      data: { branch: 'SG', name: `Worker PDF Client ${uniq}`, address: '1 Test Quay', creditTerms: 'NET30' },
    });
    const vessel = await prisma.vessel.create({
      data: { clientId: client.id, imoNumber: `7${uniq}01`.slice(0, 12), name: `MV Worker PDF ${uniq}` },
    });
    const jobOrder = await prisma.jobOrder.create({
      data: {
        joNumber: `SG-WPDF-${uniq}`,
        branch: 'SG',
        clientId: client.id,
        vesselId: vessel.id,
        scopeSummary: 'Worker PDF fixture',
        origin: 'MANUAL',
        quotedAmountMinor: 10000,
        quotedCurrency: 'SGD',
        state: 'COMPLETED',
        createdBy: user.id,
      },
    });
    const invoice = await prisma.invoice.create({
      data: {
        invoiceNumber: `SG-2026-${uniq.slice(-4)}`,
        jobOrderId: jobOrder.id,
        branch: 'SG',
        status: 'SENT',
        billToName: client.name,
        billToAddress: client.address,
        gstAmountMinor: 900,
        gstCurrency: 'SGD',
        totalAmountMinor: 10900,
        totalCurrency: 'SGD',
        issuedAt: new Date('2026-08-01T00:00:00Z'),
        dueAt: new Date('2026-08-31T00:00:00Z'),
        lines: {
          create: [
            {
              kind: 'LABOUR',
              description: 'Labour',
              quantity: 2,
              unit: 'hr',
              unitPriceAmountMinor: 5000,
              unitPriceCurrency: 'SGD',
              lineTotalAmountMinor: 10000,
              lineTotalCurrency: 'SGD',
            },
          ],
        },
      },
    });
    invoiceId = invoice.id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('renders a real PDF, uploads it, and writes pdfObjectKey with correct content', async () => {
    const result = await generateInvoicePdf(invoiceId);
    expect(result.pdfObjectKey).toMatch(/^invoices\//);

    const invoice = await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
    expect(invoice.pdfObjectKey).toBe(result.pdfObjectKey);

    const bytes = await storage.get(result.pdfObjectKey);
    expect(Buffer.from(bytes.slice(0, 4)).toString('ascii')).toBe('%PDF');

    const parsed = await pdfParse(Buffer.from(bytes));
    expect(parsed.text).toContain(invoice.invoiceNumber);
    expect(parsed.text).toContain(invoice.billToName);
    if (invoice.gstAmountMinor != null) {
      expect(parsed.text).toContain((invoice.gstAmountMinor / 100).toFixed(2));
    }
  });
});
