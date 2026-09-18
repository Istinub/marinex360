// Invoice routes (FR-40 generation already exists in jobOrders.ts; this file owns read, issue,
// and D-035 payment recording).
import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import { Storage } from '@marinex360/storage';
import { AppError } from '../lib/errors.js';
import { scopeWhere, assertBranchAccess, clientIdForUser } from '../services/branchScope.js';
import { appendAudit } from '../services/audit.js';
import { computeDueAt, assertCanIssue, deriveStatusFromSum } from '../domain/invoiceLifecycle.js';
import { enqueueInvoicePdfGeneration } from '../services/invoicePdfQueue.js';
import { enqueueInvoiceEmailDelivery } from '../services/invoiceEmailQueue.js';
import { GST_RATE_PERCENT } from '../lib/invoiceConfig.js';

const INVOICE_LINE_KINDS = new Set(['LABOUR', 'MATERIAL', 'VARIATION', 'OTHER']);

export function invoiceRoutes(app: FastifyInstance, prisma: PrismaClient): void {
  const w = (action: string) => ({ preHandler: [app.authenticate, app.requireMfaEnrolled, app.requireAction(action as any)] });

  function validateLineInput(body: any, invoiceCurrency: string) {
    const kind = String(body.kind ?? '').trim().toUpperCase();
    const description = String(body.description ?? '').trim();
    const quantity = Number(body.quantity);
    const unit = body.unit == null || String(body.unit).trim() === '' ? null : String(body.unit).trim();
    const unitPriceAmountMinor = Number(body.unitPriceAmountMinor);
    const unitPriceCurrency = String(body.unitPriceCurrency ?? invoiceCurrency).trim();

    if (!INVOICE_LINE_KINDS.has(kind)) throw new AppError('VALIDATION_ERROR', 'invalid invoice line kind');
    if (!description) throw new AppError('VALIDATION_ERROR', 'description required');
    if (!Number.isFinite(quantity) || quantity < 0) throw new AppError('VALIDATION_ERROR', 'quantity must be a non-negative number');
    if (!Number.isInteger(unitPriceAmountMinor) || unitPriceAmountMinor < 0) {
      throw new AppError('VALIDATION_ERROR', 'unitPriceAmountMinor must be a non-negative integer');
    }
    if (unitPriceCurrency !== invoiceCurrency) {
      throw new AppError('VALIDATION_ERROR', 'line currency must match invoice currency (no conversion, D-031 convention)');
    }

    return {
      kind,
      description,
      quantity,
      unit,
      unitPriceAmountMinor,
      unitPriceCurrency,
      lineTotalAmountMinor: Math.round(quantity * unitPriceAmountMinor),
      lineTotalCurrency: invoiceCurrency,
    };
  }

  async function recalcDraftInvoice(tx: any, id: string, version: number) {
    const lines = await tx.invoiceLine.findMany({ where: { invoiceId: id } });
    const totalAmountMinor = lines.reduce((sum: number, line: any) => sum + line.lineTotalAmountMinor, 0);
    const invoice = await tx.invoice.findUniqueOrThrow({ where: { id } });
    const gstAmountMinor = invoice.gstAmountMinor == null ? null : Math.round(totalAmountMinor * (GST_RATE_PERCENT / 100));
    const res = await tx.invoice.updateMany({
      where: { id, version },
      data: {
        totalAmountMinor,
        ...(gstAmountMinor == null ? {} : { gstAmountMinor }),
        version: { increment: 1 },
      },
    });
    if (res.count === 0) throw new AppError('VERSION_CONFLICT');
    return tx.invoice.findUniqueOrThrow({ where: { id }, include: { lines: true, payments: true } });
  }

  async function assertEditableDraft(tx: any, req: any, id: string) {
    const invoice = await tx.invoice.findFirst({ where: { id } });
    if (!invoice) throw new AppError('NOT_FOUND');
    assertBranchAccess(req.ctx, invoice.branch);
    if (invoice.status !== 'DRAFT') throw new AppError('FORBIDDEN', 'issued invoices are locked');
    return invoice;
  }

  app.get('/api/v1/invoices', w('invoice:read'), async (req) => {
    const clientId = await clientIdForUser(prisma, req.ctx);
    const where: any = clientId ? { jobOrder: { clientId } } : scopeWhere(req.ctx);
    return prisma.invoice.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });
  });

  app.get('/api/v1/invoices/:id', w('invoice:read'), async (req) => {
    const { id } = req.params as any;
    const invoice = await prisma.invoice.findFirst({ where: { id }, include: { lines: true, payments: true } });
    if (!invoice) throw new AppError('NOT_FOUND');
    assertBranchAccess(req.ctx, invoice.branch);
    if (req.ctx.roles.includes('CLIENT' as any)) {
      const clientId = await clientIdForUser(prisma, req.ctx);
      if (!clientId || (invoice.jobOrderId && (await prisma.jobOrder.findFirst({ where: { id: invoice.jobOrderId, clientId } })) == null)) throw new AppError('NOT_FOUND');
    }
    return invoice;
  });

  app.get('/api/v1/invoices/:id/pdf', w('invoice:read'), async (req) => {
    const { id } = req.params as any;
    const invoice = await prisma.invoice.findFirst({ where: { id }, include: { jobOrder: true } });
    if (!invoice) throw new AppError('NOT_FOUND');
    assertBranchAccess(req.ctx, invoice.branch);
    if (req.ctx.roles.includes('CLIENT' as any)) {
      const clientId = await clientIdForUser(prisma, req.ctx);
      if (!clientId || invoice.jobOrder.clientId !== clientId) throw new AppError('NOT_FOUND');
    }
    if (!invoice.pdfObjectKey) return { status: 'PENDING' };
    const url = await Storage.fromEnv().presignGet(invoice.pdfObjectKey, 900);
    return { status: 'READY', url, objectKey: invoice.pdfObjectKey };
  });

  app.post('/api/v1/invoices/:id/lines', w('invoice:create'), async (req) => {
    const { id } = req.params as any;
    const { version } = (req.body ?? {}) as any;
    if (typeof version !== 'number') throw new AppError('VALIDATION_ERROR', 'version required');

    return prisma.$transaction(async (tx) => {
      const invoice = await assertEditableDraft(tx, req, id);
      const line = validateLineInput(req.body as any, invoice.totalCurrency);
      await tx.invoiceLine.create({ data: { invoiceId: id, ...line } });
      const updated = await recalcDraftInvoice(tx, id, version);
      await appendAudit(tx, req.ctx, { entityType: 'Invoice', entityId: id, action: 'ADD_LINE', diff: line });
      return updated;
    });
  });

  app.patch('/api/v1/invoices/:id/lines/:lineId', w('invoice:create'), async (req) => {
    const { id, lineId } = req.params as any;
    const { version } = (req.body ?? {}) as any;
    if (typeof version !== 'number') throw new AppError('VALIDATION_ERROR', 'version required');

    return prisma.$transaction(async (tx) => {
      const invoice = await assertEditableDraft(tx, req, id);
      const existing = await tx.invoiceLine.findFirst({ where: { id: lineId, invoiceId: id } });
      if (!existing) throw new AppError('NOT_FOUND');
      const line = validateLineInput(req.body as any, invoice.totalCurrency);
      await tx.invoiceLine.update({ where: { id: lineId }, data: line });
      const updated = await recalcDraftInvoice(tx, id, version);
      await appendAudit(tx, req.ctx, { entityType: 'InvoiceLine', entityId: lineId, action: 'UPDATE_LINE', diff: line });
      return updated;
    });
  });

  app.delete('/api/v1/invoices/:id/lines/:lineId', w('invoice:create'), async (req) => {
    const { id, lineId } = req.params as any;
    const version = Number((req.query as any)?.version);
    if (!Number.isInteger(version)) throw new AppError('VALIDATION_ERROR', 'version required');

    return prisma.$transaction(async (tx) => {
      await assertEditableDraft(tx, req, id);
      const existing = await tx.invoiceLine.findFirst({ where: { id: lineId, invoiceId: id } });
      if (!existing) throw new AppError('NOT_FOUND');
      await tx.invoiceLine.delete({ where: { id: lineId } });
      const updated = await recalcDraftInvoice(tx, id, version);
      await appendAudit(tx, req.ctx, { entityType: 'InvoiceLine', entityId: lineId, action: 'DELETE_LINE', diff: { invoiceId: id } });
      return updated;
    });
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
    try {
      await enqueueInvoiceEmailDelivery(issued.id);
    } catch (err) {
      await prisma.auditEntry.create({
        data: {
          entityType: 'Invoice',
          entityId: issued.id,
          action: 'EMAIL_ENQUEUE_FAILED',
          actorId: req.ctx.userId,
          diff: { message: err instanceof Error ? err.message : String(err) },
        },
      });
    }
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
