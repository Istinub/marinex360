// D-037: renders the invoice to PDF via Puppeteer (same launch pattern as render-smoke.mjs),
// uploads via the real @marinex360/storage adapter, writes pdfObjectKey back onto Invoice —
// the ONE deliberate exception to post-issue freeze.
import { PrismaClient } from '@prisma/client';
import puppeteer from 'puppeteer-core';
import { Storage } from '@marinex360/storage';
import { renderInvoiceHtml } from '../lib/invoiceTemplate.js';

const prisma = new PrismaClient();
const storage = Storage.fromEnv();

export async function generateInvoicePdf(invoiceId: string): Promise<{ pdfObjectKey: string }> {
  const invoice = await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId }, include: { lines: true } });
  const html = renderInvoiceHtml(invoice);

  const execPath = process.env.PUPPETEER_EXECUTABLE_PATH ?? '/usr/bin/chromium';
  const browser = await puppeteer.launch({
    executablePath: execPath,
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  let pdfBuffer: Uint8Array;
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'load' });
    pdfBuffer = await page.pdf({ format: 'A4', printBackground: true });
  } finally {
    await browser.close();
  }

  const objectKey = `invoices/${invoice.id}/${invoice.invoiceNumber}.pdf`;
  await storage.put(objectKey, pdfBuffer, 'application/pdf');
  await prisma.invoice.update({ where: { id: invoiceId }, data: { pdfObjectKey: objectKey } });
  return { pdfObjectKey: objectKey };
}
