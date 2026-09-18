import { PrismaClient } from '@prisma/client';
import puppeteer from 'puppeteer-core';
import { Storage } from '@marinex360/storage';
import { loadBrandingLogo } from '../lib/branding.js';
import { pdfPageMargins, renderPdfFooterTemplate } from '../lib/pdfLetterhead.js';
import { renderQuotationHtml } from '../lib/quotationTemplate.js';

const prisma = new PrismaClient();
const storage = Storage.fromEnv();

export async function generateQuotationPdf(quotationId: string): Promise<{ pdfObjectKey: string }> {
  const quotation = await prisma.quotation.findUniqueOrThrow({
    where: { id: quotationId },
    include: {
      client: { select: { name: true } },
      vessel: { select: { name: true } },
      lines: true,
    },
  });
  const brandingLogo = await loadBrandingLogo(prisma);
  const html = renderQuotationHtml(quotation, brandingLogo);

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
    pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: '<div></div>',
      footerTemplate: renderPdfFooterTemplate(),
      margin: pdfPageMargins,
    });
  } finally {
    await browser.close();
  }

  const objectKey = `quotations/${quotation.id}/${quotation.quotationNumber}.pdf`;
  await storage.put(objectKey, pdfBuffer, 'application/pdf');
  await prisma.quotation.update({ where: { id: quotationId }, data: { pdfObjectKey: objectKey } });
  return { pdfObjectKey: objectKey };
}
