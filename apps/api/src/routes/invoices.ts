// Invoice routes (FR-40 generation already exists in jobOrders.ts; this file owns read, issue,
// and D-035 payment recording).
import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import { AppError } from '../lib/errors.js';
import { scopeWhere, assertBranchAccess } from '../services/branchScope.js';
import { appendAudit } from '../services/audit.js';
import { computeDueAt, assertCanIssue, deriveStatusFromSum } from '../domain/invoiceLifecycle.js';
import { enqueueInvoicePdfGeneration } from '../services/invoicePdfQueue.js';

export function invoiceRoutes(app: FastifyInstance, prisma: PrismaClient): void {
  const w = (action: string) => ({ preHandler: [app.authenticate, app.requireMfaEnrolled, app.requireAction(action as any)] });

  app.get('/api/v1/invoices', w('invoice:read'), async (req) => {
    return prisma.invoice.findMany({
      where: scopeWhere(req.ctx),
      orderBy: { createdAt: 'desc' },
    });
  });

  app.get('/api/v1/invoices/:id', w('invoice:read'), async (req) => {
    const { id } = req.params as any;
    const invoice = await prisma.invoice.findFirst({ where: { id }, include: { lines: true } });
    if (!invoice) throw new AppError('NOT_FOUND');
    assertBranchAccess(req.ctx, invoice.branch);
    return invoice;
  });

  // D-034: DRAFT -> SENT. Computes dueAt from the Client's creditTerms. Freezes the invoice
  // (OD-03) — no PATCH endpoint exists for Invoice, so "freeze" is enforced by omission for now.
  app.post('/api/v1/invoices/:id/issue', w('invoice:issue'), async (req) => {
    const { id } = req.params as any;
    const { version } = (req.body ?? {}) as any;
    if (typeof version !== 'number') throw new AppError('VALIDATION_ERROR', 'version required');

    const issued = await prisma.$transaction(async (tx) => {
      const invoice = await tx.invoice.findFirst({ where: { id }, include: { jobOrder: true } });
      if (!invoice) throw new AppError('NOT_FOUND');
      assertBranchAccess(req.ctx, invoice.branch);
      assertCanIssue(invoice.status);

      const client = await tx.client.findUniqueOrThrow({ where: { id: invoice.jobOrder.clientId } });
      const issuedAt = new Date();
      const dueAt = computeDueAt(issuedAt, client.creditTerms);
      const res = await tx.invoice.updateMany({
        where: { id, version },
        data: { status: 'SENT', issuedAt, dueAt, version: { increment: 1 } },
      });
      if (res.count === 0) throw new AppError('VERSION_CONFLICT');
      await appendAudit(tx, req.ctx, { entityType: 'Invoice', entityId: id, action: 'ISSUE', diff: { issuedAt, dueAt } });
      return tx.invoice.findUniqueOrThrow({ where: { id } });
    });
    await enqueueInvoicePdfGeneration(issued.id);
    return issued;
  });

  // D-035: record a payment (or reversal via negative amountMinor). Insert-only Payment row,
  // then recompute status from the full payment sum in the same transaction.
  app.post('/api/v1/invoices/:id/payments', w('invoice:recordPayment'), async (req) => {
    const { id } = req.params as any;
    const { amountMinor, currency, paidAt, method, reference, version } = (req.body ?? {}) as any;
    if (typeof amountMinor !== 'number' || !Number.isInteger(amountMinor) || amountMinor === 0) {
      throw new AppError('VALIDATION_ERROR', 'amountMinor must be a non-zero integer');
    }
    if (!currency) throw new AppError('VALIDATION_ERROR', 'currency required');
    if (typeof version !== 'number') throw new AppError('VALIDATION_ERROR', 'version required');

    return prisma.$transaction(async (tx) => {
      const invoice = await tx.invoice.findFirst({ where: { id } });
      if (!invoice) throw new AppError('NOT_FOUND');
      assertBranchAccess(req.ctx, invoice.branch);
      if (invoice.status === 'DRAFT') throw new AppError('VALIDATION_ERROR', 'invoice must be issued before recording payments');
      if (currency !== invoice.totalCurrency) {
        throw new AppError('VALIDATION_ERROR', 'payment currency does not match invoice currency (no conversion, D-031 convention)');
      }

      const payment = await tx.payment.create({
        data: {
          invoiceId: id,
          amountMinor,
          currency,
          paidAt: paidAt ? new Date(paidAt) : new Date(),
          recordedById: req.ctx.userId,
          method: method ?? null,
          reference: reference ?? null,
        },
      });
      const agg = await tx.payment.aggregate({ where: { invoiceId: id }, _sum: { amountMinor: true } });
      const sum = agg._sum.amountMinor ?? 0;
      const newStatus = deriveStatusFromSum(sum, invoice.totalAmountMinor);

      const res = await tx.invoice.updateMany({
        where: { id, version },
        data: { status: newStatus, version: { increment: 1 } },
      });
      if (res.count === 0) throw new AppError('VERSION_CONFLICT');
      await appendAudit(tx, req.ctx, {
        entityType: 'Payment',
        entityId: payment.id,
        action: 'RECORD_PAYMENT',
        diff: { invoiceId: id, amountMinor, newStatus, sum },
      });
      return tx.invoice.findUniqueOrThrow({ where: { id }, include: { payments: true } });
    });
  });
}
