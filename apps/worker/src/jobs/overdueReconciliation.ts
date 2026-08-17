// D-034: OVERDUE reconciliation. The API's computed-on-read effectiveStatus() gives immediate
// correctness for reads, but nothing persists status=OVERDUE or fires FR-42 alerts without this
// recurring worker job.
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export async function reconcileOverdueInvoices(now: Date = new Date()): Promise<{ reconciled: number }> {
  // Same eligibility rule as effectiveStatus() in the API: SENT or PARTIAL, dueAt passed. This
  // simple predicate is duplicated locally because the worker and API are separate deployables.
  const overdue = await prisma.invoice.findMany({
    where: { status: { in: ["SENT", "PARTIAL"] }, dueAt: { lt: now } },
    select: {
      id: true,
      invoiceNumber: true,
      branch: true,
      jobOrder: { select: { createdBy: true } },
    },
  });

  let reconciled = 0;
  for (const inv of overdue) {
    const didReconcile = await prisma.$transaction(async (tx) => {
      // Re-check inside the transaction; payment or another worker may have moved it already.
      const fresh = await tx.invoice.findUnique({ where: { id: inv.id } });
      if (!fresh || (fresh.status !== "SENT" && fresh.status !== "PARTIAL")) return false;

      await tx.invoice.update({ where: { id: inv.id }, data: { status: "OVERDUE" } });
      await tx.auditEntry.create({
        data: {
          entityType: "Invoice",
          entityId: inv.id,
          action: "AUTO_OVERDUE",
          actorId: "system:overdue-reconciliation",
          diff: { at: now },
        },
      });
      // FR-42/FR-60: recipient targeting is a placeholder until notification-matrix work lands.
      await tx.notification.create({
        data: {
          recipientId: inv.jobOrder.createdBy,
          kind: "INVOICE_OVERDUE",
          title: `Invoice ${inv.invoiceNumber} is overdue`,
          body: `Invoice ${inv.invoiceNumber} (branch ${inv.branch}) passed its due date and has not been paid.`,
        },
      });
      return true;
    });

    if (didReconcile) reconciled += 1;
  }

  return { reconciled };
}
