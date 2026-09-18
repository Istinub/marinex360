import type { FastifyInstance } from 'fastify';
import { Prisma, type PrismaClient } from '@prisma/client';
import { Storage } from '@marinex360/storage';
import { AppError } from '../lib/errors.js';
import { appendAudit } from '../services/audit.js';
import { assertBranchAccess, branchForCreate, scopeWhere } from '../services/branchScope.js';
import { nextQuotationNumber } from '../services/numbering.js';
import { enqueueQuotationPdfGeneration } from '../services/quotationPdfQueue.js';

const ALLOWED_CURRENCIES = new Set(['SGD', 'MYR', 'USD', 'IDR']);
const MUTATING_ROLES = ['OPS_SUPERVISOR', 'DIRECTOR', 'SYSTEM_ADMIN'];
const DEFAULT_EXCLUSIONS =
  'Above Quotation Excludes Shipyard Management Fee, Sea Trial Attendance, Owner Supplied Spares, Third Party Charges, GST, and any work not expressly stated above.';

function canMutate(roles: string[]): boolean {
  return roles.some((role) => MUTATING_ROLES.includes(role));
}

function parseDate(value: unknown, field: string): Date {
  const date = value == null || value === '' ? new Date() : new Date(String(value));
  if (Number.isNaN(date.getTime())) throw new AppError('VALIDATION_ERROR', `${field} must be a valid date`);
  return date;
}

function cleanString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function currency(value: unknown): string {
  const next = typeof value === 'string' ? value.trim().toUpperCase() : '';
  if (!ALLOWED_CURRENCIES.has(next)) throw new AppError('VALIDATION_ERROR', 'currency must be one of SGD, MYR, USD, IDR');
  return next;
}

function decimalOrNull(value: unknown): Prisma.Decimal | null {
  if (value == null || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n)) throw new AppError('VALIDATION_ERROR', 'line numeric fields must be finite');
  return new Prisma.Decimal(n);
}

function normalizeLine(input: any) {
  const description = cleanString(input.description);
  if (!description) throw new AppError('VALIDATION_ERROR', 'line description required');
  const quantity = decimalOrNull(input.quantity);
  const unitPrice = decimalOrNull(input.unitPrice);
  const amount = quantity != null && unitPrice != null ? quantity.mul(unitPrice) : null;
  return {
    itemCode: cleanString(input.itemCode),
    description,
    unit: cleanString(input.unit),
    quantity,
    unitPrice,
    amount,
    remarks: cleanString(input.remarks),
  };
}

function normalizeLines(input: unknown) {
  if (!Array.isArray(input) || input.length === 0) throw new AppError('VALIDATION_ERROR', 'at least one quotation line required');
  return input.map(normalizeLine);
}

async function resolveRefs(
  tx: Prisma.TransactionClient,
  ctx: any,
  branch: string,
  input: any,
): Promise<{ clientId: string | null; vesselId: string | null; manualClientName: string | null; manualVesselName: string | null }> {
  const manualClientName = cleanString(input.manualClientName ?? input.newClientName);
  const manualVesselName = cleanString(input.manualVesselName ?? input.newVesselName);
  let clientId = cleanString(input.clientId);
  let vesselId = cleanString(input.vesselId);

  if (clientId) {
    const client = await tx.client.findFirst({ where: { id: clientId, deletedAt: null } });
    if (!client || client.branch !== branch) throw new AppError('NOT_FOUND', 'client not found');
    assertBranchAccess(ctx, client.branch);
  }

  if (vesselId) {
    const vessel = await tx.vessel.findFirst({ where: { id: vesselId, deletedAt: null }, include: { client: true } });
    if (!vessel || vessel.client.deletedAt != null || vessel.client.branch !== branch) throw new AppError('NOT_FOUND', 'vessel not found');
    if (clientId && vessel.clientId !== clientId) throw new AppError('VALIDATION_ERROR', 'vesselId must belong to clientId');
    clientId ??= vessel.clientId;
  }

  if (!clientId && !manualClientName) throw new AppError('VALIDATION_ERROR', 'clientId or manualClientName required');
  if (!vesselId && !manualVesselName) throw new AppError('VALIDATION_ERROR', 'vesselId or manualVesselName required');

  return {
    clientId,
    vesselId,
    manualClientName: clientId ? null : manualClientName,
    manualVesselName: vesselId ? null : manualVesselName,
  };
}

function quotationInclude() {
  return {
    lines: true,
    client: { select: { id: true, name: true } },
    vessel: { select: { id: true, name: true, imoNumber: true } },
  } satisfies Prisma.QuotationInclude;
}

function serializeDecimal(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === 'object' && 'toString' in value && typeof value.toString === 'function') return value.toString();
  return String(value);
}

function serializeQuotation<T extends { lines?: any[] }>(quotation: T): T {
  return {
    ...quotation,
    lines: quotation.lines?.map((line) => ({
      ...line,
      quantity: serializeDecimal(line.quantity),
      unitPrice: serializeDecimal(line.unitPrice),
      amount: serializeDecimal(line.amount),
    })),
  };
}

export function quotationRoutes(app: FastifyInstance, prisma: PrismaClient): void {
  const authed = { preHandler: [app.authenticate, app.requireMfaEnrolled] };
  const canWrite = (req: any) => {
    if (!canMutate(req.ctx.roles)) throw new AppError('FORBIDDEN');
  };

  app.post('/api/v1/quotations', authed, async (req) => {
    canWrite(req);
    const b = (req.body ?? {}) as any;
    const branch = branchForCreate(req.ctx, b.branch);
    const lines = normalizeLines(b.lines);
    return prisma.$transaction(async (tx) => {
      const refs = await resolveRefs(tx, req.ctx, branch, b);
      const quotationNumber = await nextQuotationNumber(tx);
      const quotation = await tx.quotation.create({
        data: {
          quotationNumber,
          branch,
          createdBy: req.ctx.userId,
          ...refs,
          category: cleanString(b.category) ?? 'GENERAL',
          quotationDate: parseDate(b.quotationDate, 'quotationDate'),
          location: cleanString(b.location),
          currency: currency(b.currency ?? 'SGD'),
          validityDays: Number.isInteger(Number(b.validityDays)) ? Number(b.validityDays) : 30,
          workDurationText: cleanString(b.workDurationText),
          exclusionsText: cleanString(b.exclusionsText) ?? DEFAULT_EXCLUSIONS,
          lines: { create: lines },
        },
        include: quotationInclude(),
      });
      await appendAudit(tx, req.ctx, { entityType: 'Quotation', entityId: quotation.id, action: 'CREATE', diff: { quotationNumber } });
      return serializeQuotation(quotation);
    });
  });

  app.get('/api/v1/quotations', authed, async (req) => {
    const q = (req.query ?? {}) as any;
    const where: Prisma.QuotationWhereInput = { ...scopeWhere(req.ctx) };
    if (typeof q.status === 'string' && q.status) where.status = q.status;
    if (typeof q.clientId === 'string' && q.clientId) where.clientId = q.clientId;
    if (q.from || q.to) {
      where.quotationDate = {
        ...(q.from ? { gte: parseDate(q.from, 'from') } : {}),
        ...(q.to ? { lte: parseDate(q.to, 'to') } : {}),
      };
    }
    const quotations = await prisma.quotation.findMany({
      where,
      orderBy: { quotationDate: 'desc' },
      include: quotationInclude(),
    });
    return quotations.map(serializeQuotation);
  });

  app.get('/api/v1/quotations/:id', authed, async (req) => {
    const { id } = req.params as any;
    const quotation = await prisma.quotation.findFirst({ where: { id }, include: quotationInclude() });
    if (!quotation) throw new AppError('NOT_FOUND');
    assertBranchAccess(req.ctx, quotation.branch);
    return serializeQuotation(quotation);
  });

  app.patch('/api/v1/quotations/:id', authed, async (req) => {
    canWrite(req);
    const { id } = req.params as any;
    const b = (req.body ?? {}) as any;
    const lines = 'lines' in b ? normalizeLines(b.lines) : null;
    return prisma.$transaction(async (tx) => {
      const existing = await tx.quotation.findFirst({ where: { id } });
      if (!existing) throw new AppError('NOT_FOUND');
      assertBranchAccess(req.ctx, existing.branch);
      if (existing.status !== 'DRAFT') throw new AppError('FORBIDDEN', 'only draft quotations can be edited');
      if (typeof b.version !== 'number') throw new AppError('VALIDATION_ERROR', 'version required');
      const branch = 'branch' in b ? branchForCreate(req.ctx, b.branch) : existing.branch;
      const refs = ('clientId' in b || 'vesselId' in b || 'manualClientName' in b || 'manualVesselName' in b || 'newClientName' in b || 'newVesselName' in b)
        ? await resolveRefs(tx, req.ctx, branch, b)
        : {};
      const res = await tx.quotation.updateMany({
        where: { id, version: b.version },
        data: {
          branch,
          ...refs,
          ...(b.category !== undefined ? { category: cleanString(b.category) ?? existing.category } : {}),
          ...(b.quotationDate !== undefined ? { quotationDate: parseDate(b.quotationDate, 'quotationDate') } : {}),
          ...(b.location !== undefined ? { location: cleanString(b.location) } : {}),
          ...(b.currency !== undefined ? { currency: currency(b.currency) } : {}),
          ...(b.validityDays !== undefined ? { validityDays: Number(b.validityDays) } : {}),
          ...(b.workDurationText !== undefined ? { workDurationText: cleanString(b.workDurationText) } : {}),
          ...(b.exclusionsText !== undefined ? { exclusionsText: cleanString(b.exclusionsText) ?? DEFAULT_EXCLUSIONS } : {}),
          pdfObjectKey: null,
          version: { increment: 1 },
        },
      });
      if (res.count === 0) throw new AppError('VERSION_CONFLICT');
      if (lines) {
        await tx.quotationLine.deleteMany({ where: { quotationId: id } });
        await tx.quotationLine.createMany({ data: lines.map((line) => ({ quotationId: id, ...line })) });
      }
      await appendAudit(tx, req.ctx, { entityType: 'Quotation', entityId: id, action: 'UPDATE', diff: { fields: Object.keys(b) } });
      const updated = await tx.quotation.findUniqueOrThrow({ where: { id }, include: quotationInclude() });
      return serializeQuotation(updated);
    });
  });

  app.post('/api/v1/quotations/:id/generate-pdf', authed, async (req) => {
    canWrite(req);
    const { id } = req.params as any;
    const quotation = await prisma.quotation.findFirst({ where: { id } });
    if (!quotation) throw new AppError('NOT_FOUND');
    assertBranchAccess(req.ctx, quotation.branch);
    await enqueueQuotationPdfGeneration(id);
    await appendAudit(prisma as any, req.ctx, { entityType: 'Quotation', entityId: id, action: 'GENERATE_PDF', diff: {} });
    return { status: 'QUEUED' };
  });

  app.get('/api/v1/quotations/:id/pdf', authed, async (req) => {
    const { id } = req.params as any;
    const quotation = await prisma.quotation.findFirst({ where: { id } });
    if (!quotation) throw new AppError('NOT_FOUND');
    assertBranchAccess(req.ctx, quotation.branch);
    if (!quotation.pdfObjectKey) return { status: 'PENDING' };
    const url = await Storage.fromEnv().presignGet(quotation.pdfObjectKey, 900);
    return { status: 'READY', url, objectKey: quotation.pdfObjectKey };
  });
}
