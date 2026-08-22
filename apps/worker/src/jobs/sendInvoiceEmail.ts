// D-045/P3-7: async invoice email delivery. Uses frozen Invoice.billToEmail and pdfObjectKey;
// never performs a live Contact lookup, and never rolls back issue.
import { PrismaClient } from "@prisma/client";
import { Storage } from "@marinex360/storage";
import { sendMail } from "../lib/smtpMailer.js";

const prisma = new PrismaClient();
const storage = Storage.fromEnv();

export async function sendInvoiceEmail(invoiceId: string): Promise<{ sent: boolean; reason?: string }> {
  const invoice = await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
  if (!invoice.billToEmail) {
    await prisma.auditEntry.create({
      data: {
        entityType: "Invoice",
        entityId: invoice.id,
        action: "EMAIL_SKIPPED",
        actorId: "system:invoice-email",
        diff: { reason: "MISSING_BILL_TO_EMAIL" },
      },
    });
    return { sent: false, reason: "MISSING_BILL_TO_EMAIL" };
  }
  if (!invoice.pdfObjectKey) {
    await prisma.auditEntry.create({
      data: {
        entityType: "Invoice",
        entityId: invoice.id,
        action: "EMAIL_SKIPPED",
        actorId: "system:invoice-email",
        diff: { reason: "MISSING_PDF_OBJECT_KEY" },
      },
    });
    return { sent: false, reason: "MISSING_PDF_OBJECT_KEY" };
  }

  try {
    const pdf = await storage.get(invoice.pdfObjectKey);
    await sendMail({
      from: process.env.EMAIL_FROM ?? "MarineX360 <no-reply@marinex.local>",
      to: invoice.billToEmail,
      subject: `Invoice ${invoice.invoiceNumber}`,
      text: `Please find attached invoice ${invoice.invoiceNumber}.`,
      attachments: [
        {
          filename: `${invoice.invoiceNumber}.pdf`,
          contentType: "application/pdf",
          content: pdf,
        },
      ],
    });
    await prisma.auditEntry.create({
      data: {
        entityType: "Invoice",
        entityId: invoice.id,
        action: "EMAIL_SENT",
        actorId: "system:invoice-email",
        diff: { to: invoice.billToEmail, pdfObjectKey: invoice.pdfObjectKey },
      },
    });
    return { sent: true };
  } catch (err) {
    await prisma.auditEntry.create({
      data: {
        entityType: "Invoice",
        entityId: invoice.id,
        action: "EMAIL_FAILED",
        actorId: "system:invoice-email",
        diff: { message: err instanceof Error ? err.message : String(err) },
      },
    });
    return { sent: false, reason: "SEND_FAILED" };
  }
}
