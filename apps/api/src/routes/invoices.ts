// Invoice routes (FR-40 generation already exists in jobOrders.ts; this file owns read + the
// D-034 issue transition). PARTIAL/PAID (D-035/Payment model) are explicitly NOT here yet.
import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import { AppError } from '../lib/errors.js';
import { scopeWhere, assertBranchAccess } from '../services/branchScope.js';
import { appendAudit } from '../services/audit.js';
import { effectiveStatus, computeDueAt, assertCanIssue } from '../domain/invoiceLifecycle.js';

export function invoiceRoutes(app: FastifyInstance, prisma: PrismaClient): void {
  const w = (action: string) => ({ preHandler: [app.authenticate, app.requireMfaEnrolled, app.requireAction(action as any)] });

  app.get('/api/v1/invoices', w('invoice:read'), async (req) => {
    const rows = await prisma.invoice.findMany({
      where: scopeWhere(req.ctx),
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((invoice) => ({ ...invoice, status: effectiveStatus(invoice) }));
  });

  app.get('/api/v1/invoices/:id', w('invoice:read'), async (req) => {
    const { id } = req.params as any;
    const invoice = await prisma.invoice.findFirst({ where: { id }, include: { lines: true } });
    if (!invoice) throw new AppError('NOT_FOUND');
    assertBranchAccess(req.ctx, invoice.branch);
    return { ...invoice, status: effectiveStatus(invoice) };
  });

  // D-034: DRAFT -> SENT. Computes dueAt from the Client's creditTerms. Freezes the invoice
  // (OD-03) — no PATCH endpoint exists for Invoice, so "freeze" is enforced by omission for now.
  app.post('/api/v1/invoices/:id/issue', w('invoice:issue'), async (req) => {
    const { id } = req.params as any;
    const { version } = (req.body ?? {}) as any;
    if (typeof version !== 'number') throw new AppError('VALIDATION_ERROR', 'version required');

    return prisma.$transaction(async (tx) => {
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
  });
}
