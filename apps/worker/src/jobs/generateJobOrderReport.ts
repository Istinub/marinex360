// Completion report PDF generation: same Puppeteer + storage pattern as invoice PDFs.
import { PrismaClient } from '@prisma/client';
import puppeteer from 'puppeteer-core';
import { Storage } from '@marinex360/storage';
import { renderJobOrderReportHtml } from '../lib/jobOrderReportTemplate.js';

const prisma = new PrismaClient();
const storage = Storage.fromEnv();

export async function generateJobOrderReport(jobOrderId: string): Promise<{ reportObjectKey: string }> {
  const jobOrder = await prisma.jobOrder.findUniqueOrThrow({
    where: { id: jobOrderId },
    include: {
      client: { select: { name: true } },
      vessel: { select: { name: true, imoNumber: true } },
      statusHistory: {
        orderBy: { at: 'asc' },
        include: {
          actor: { select: { name: true, email: true } },
          device: { select: { id: true, name: true } },
        },
      },
      checklistItems: { orderBy: [{ sortOrder: 'asc' }, { label: 'asc' }] },
      observations: { orderBy: { createdAt: 'asc' } },
      photos: { orderBy: { takenAt: 'asc' } },
      materials: { where: { deletedAt: null }, orderBy: { createdAt: 'asc' } },
      variations: { orderBy: { createdAt: 'asc' } },
      signature: true,
    },
  });
  const html = renderJobOrderReportHtml(jobOrder);

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

  const objectKey = `job-reports/${jobOrder.id}/${jobOrder.joNumber}.pdf`;
  await storage.put(objectKey, pdfBuffer, 'application/pdf');
  await prisma.jobOrder.update({ where: { id: jobOrderId }, data: { reportObjectKey: objectKey } });
  return { reportObjectKey: objectKey };
}
