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
const TEMPLATE_MANAGER_ROLES = ['DIRECTOR', 'SYSTEM_ADMIN'];
const DEFAULT_EXCLUSIONS =
  'Above Quotation Excludes Shipyard Management Fee, Sea Trial Attendance, Owner Supplied Spares, Third Party Charges, GST, and any work not expressly stated above.';

function canMutate(roles: string[]): boolean {
  return roles.some((role) => MUTATING_ROLES.includes(role));
}

function canManageTemplates(roles: string[]): boolean {
  return roles.some((role) => TEMPLATE_MANAGER_ROLES.includes(role));
}

function activeQuotationWhere(ctx: any, extra: Prisma.QuotationWhereInput = {}): Prisma.QuotationWhereInput {
  return {
    ...scopeWhere(ctx),
    deletedAt: null,
    purgedAt: null,
    ...extra,
  };
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

function normalizeTemplateEntry(input: any) {
  const description = cleanString(input.description);
  if (!description) throw new AppError('VALIDATION_ERROR', 'entry description required');
  return {
    itemCode: cleanString(input.itemCode),
    description,
    unit: cleanString(input.unit),
    typicalUnitPrice: decimalOrNull(input.typicalUnitPrice ?? input.unitPrice),
  };
}

function normalizeTemplateEntries(input: unknown) {
  if (!Array.isArray(input) || input.length === 0) throw new AppError('VALIDATION_ERROR', 'at least one template entry required');
  return input.map(normalizeTemplateEntry);
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

function templateInclude() {
  return {
    entries: { orderBy: [{ createdAt: 'asc' }, { description: 'asc' }] },
  } satisfies Prisma.QuotationLineTemplateInclude;
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

function serializeTemplate<T extends { entries?: any[] }>(template: T): T {
  return {
    ...template,
    entries: template.entries?.map((entry) => ({
      ...entry,
      typicalUnitPrice: serializeDecimal(entry.typicalUnitPrice),
    })),
  };
}

function serializeQuotationLine(line: any) {
  return {
    ...line,
    quantity: serializeDecimal(line.quantity),
    unitPrice: serializeDecimal(line.unitPrice),
    amount: serializeDecimal(line.amount),
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

  app.post('/api/v1/quotations/:id/duplicate', authed, async (req) => {
    canWrite(req);
    const { id } = req.params as any;
    return prisma.$transaction(async (tx) => {
      const source = await tx.quotation.findFirst({ where: activeQuotationWhere(req.ctx, { id }), include: { lines: true } });
      if (!source) throw new AppError('NOT_FOUND');
      const quotationNumber = await nextQuotationNumber(tx);
      const duplicate = await tx.quotation.create({
        data: {
          quotationNumber,
          branch: source.branch,
          createdBy: req.ctx.userId,
          clientId: null,
          vesselId: null,
          manualClientName: null,
          manualVesselName: null,
          category: source.category,
          quotationDate: new Date(),
          location: source.location,
          currency: source.currency,
          validityDays: source.validityDays,
          workDurationText: source.workDurationText,
          exclusionsText: source.exclusionsText,
          status: 'DRAFT',
          lines: {
            create: source.lines.map((line) => ({
              itemCode: line.itemCode,
              description: line.description,
              unit: line.unit,
              quantity: line.quantity,
              unitPrice: line.unitPrice,
              amount: line.amount,
              remarks: line.remarks,
            })),
          },
        },
        include: quotationInclude(),
      });
      await appendAudit(tx, req.ctx, { entityType: 'Quotation', entityId: duplicate.id, action: 'DUPLICATE', diff: { sourceId: source.id, quotationNumber } });
      return serializeQuotation(duplicate);
    });
  });

  app.get('/api/v1/quotations', authed, async (req) => {
    const q = (req.query ?? {}) as any;
    const where: Prisma.QuotationWhereInput = activeQuotationWhere(req.ctx);
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

  app.get('/api/v1/quotations/lines/search', authed, async (req) => {
    const q = (req.query ?? {}) as any;
    const page = Math.max(1, Number.parseInt(String(q.page ?? '1'), 10) || 1);
    const pageSize = Math.min(50, Math.max(1, Number.parseInt(String(q.pageSize ?? q.limit ?? '20'), 10) || 20));
    const keyword = cleanString(q.keyword ?? q.q);
    const category = cleanString(q.category);
    const quotationWhere: Prisma.QuotationWhereInput = activeQuotationWhere(req.ctx);
    if (category) quotationWhere.category = category;
    if (q.from || q.to) {
      quotationWhere.quotationDate = {
        ...(q.from ? { gte: parseDate(q.from, 'from') } : {}),
        ...(q.to ? { lte: parseDate(q.to, 'to') } : {}),
      };
    }
    const where: Prisma.QuotationLineWhereInput = {
      quotation: quotationWhere,
      ...(keyword
        ? {
            OR: [
              { description: { contains: keyword, mode: 'insensitive' } },
              { itemCode: { contains: keyword, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [total, items] = await prisma.$transaction([
      prisma.quotationLine.count({ where }),
      prisma.quotationLine.findMany({
        where,
        orderBy: [
          { quotation: { quotationDate: 'desc' } },
          { id: 'asc' },
        ],
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          quotation: {
            select: {
              id: true,
              quotationNumber: true,
              category: true,
              quotationDate: true,
              currency: true,
              client: { select: { name: true } },
              vessel: { select: { name: true } },
              manualClientName: true,
              manualVesselName: true,
            },
          },
        },
      }),
    ]);
    return {
      page,
      pageSize,
      total,
      items: items.map((line) => ({
        ...serializeQuotationLine(line),
        quotation: {
          id: line.quotation.id,
          quotationNumber: line.quotation.quotationNumber,
          category: line.quotation.category,
          quotationDate: line.quotation.quotationDate,
          currency: line.quotation.currency,
          clientName: line.quotation.client?.name ?? line.quotation.manualClientName,
          vesselName: line.quotation.vessel?.name ?? line.quotation.manualVesselName,
        },
      })),
    };
  });

  app.get('/api/v1/quotations/trash', authed, async (req) => {
    canWrite(req);
    const quotations = await prisma.quotation.findMany({
      where: { ...scopeWhere(req.ctx), deletedAt: { not: null }, purgedAt: null },
      orderBy: { deletedAt: 'desc' },
      include: quotationInclude(),
    });
    return quotations.map(serializeQuotation);
  });

  app.get('/api/v1/quotations/:id', authed, async (req) => {
    const { id } = req.params as any;
    const quotation = await prisma.quotation.findFirst({ where: activeQuotationWhere(req.ctx, { id }), include: quotationInclude() });
    if (!quotation) throw new AppError('NOT_FOUND');
    return serializeQuotation(quotation);
  });

  app.post('/api/v1/quotations/:id/delete', authed, async (req) => {
    canWrite(req);
    const { id } = req.params as any;
    const now = new Date();
    await prisma.$transaction(async (tx) => {
      const quotation = await tx.quotation.findFirst({ where: activeQuotationWhere(req.ctx, { id }) });
      if (!quotation) throw new AppError('NOT_FOUND');
      await tx.quotation.update({ where: { id }, data: { deletedAt: now, purgedAt: null, version: { increment: 1 } } });
      await appendAudit(tx, req.ctx, { entityType: 'Quotation', entityId: id, action: 'DELETE', diff: { deletedAt: now } });
    });
    return { deleted: true };
  });

  app.post('/api/v1/quotations/:id/restore', authed, async (req) => {
    canWrite(req);
    const { id } = req.params as any;
    await prisma.$transaction(async (tx) => {
      const quotation = await tx.quotation.findFirst({ where: { ...scopeWhere(req.ctx), id, deletedAt: { not: null }, purgedAt: null } });
      if (!quotation) throw new AppError('NOT_FOUND');
      await tx.quotation.update({ where: { id }, data: { deletedAt: null, version: { increment: 1 } } });
      await appendAudit(tx, req.ctx, { entityType: 'Quotation', entityId: id, action: 'RESTORE', diff: { deletedAt: null } });
    });
    return { restored: true };
  });

  app.patch('/api/v1/quotations/:id', authed, async (req) => {
    canWrite(req);
    const { id } = req.params as any;
    const b = (req.body ?? {}) as any;
    const lines = 'lines' in b ? normalizeLines(b.lines) : null;
    return prisma.$transaction(async (tx) => {
      const existing = await tx.quotation.findFirst({ where: activeQuotationWhere(req.ctx, { id }) });
      if (!existing) throw new AppError('NOT_FOUND');
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

  app.post('/api/v1/quotations/:id/copy-lines', authed, async (req) => {
    canWrite(req);
    const { id } = req.params as any;
    const b = (req.body ?? {}) as any;
    const rawIds = Array.isArray(b) ? b : b.sourceLineIds ?? b.lineIds;
    if (!Array.isArray(rawIds) || rawIds.length === 0 || rawIds.some((lineId) => typeof lineId !== 'string' || !lineId.trim())) {
      throw new AppError('VALIDATION_ERROR', 'source line ids required');
    }
    const sourceLineIds = rawIds.map((lineId) => lineId.trim());
    const uniqueSourceLineIds = [...new Set(sourceLineIds)];
    return prisma.$transaction(async (tx) => {
      const target = await tx.quotation.findFirst({ where: activeQuotationWhere(req.ctx, { id }) });
      if (!target) throw new AppError('NOT_FOUND');
      if (target.status !== 'DRAFT') throw new AppError('FORBIDDEN', 'only draft quotations can be edited');
      const sourceLines = await tx.quotationLine.findMany({
        where: {
          id: { in: uniqueSourceLineIds },
          quotation: activeQuotationWhere(req.ctx),
        },
      });
      if (sourceLines.length !== uniqueSourceLineIds.length) throw new AppError('NOT_FOUND', 'source quotation line not found');
      const byId = new Map(sourceLines.map((line) => [line.id, line]));
      await tx.quotationLine.createMany({
        data: sourceLineIds.map((sourceLineId) => {
          const line = byId.get(sourceLineId);
          if (!line) throw new AppError('NOT_FOUND', 'source quotation line not found');
          const amount = line.quantity != null && line.unitPrice != null
            ? line.quantity.mul(line.unitPrice)
            : null;
          return {
            quotationId: id,
            itemCode: line.itemCode,
            description: line.description,
            unit: line.unit,
            quantity: line.quantity,
            unitPrice: line.unitPrice,
            amount,
            remarks: line.remarks,
          };
        }),
      });
      await tx.quotation.update({ where: { id }, data: { pdfObjectKey: null, version: { increment: 1 } } });
      await appendAudit(tx, req.ctx, { entityType: 'Quotation', entityId: id, action: 'COPY_LINES', diff: { sourceLineIds } });
      const updated = await tx.quotation.findUniqueOrThrow({ where: { id }, include: quotationInclude() });
      return serializeQuotation(updated);
    });
  });

  app.post('/api/v1/quotations/:id/apply-template/:templateId', authed, async (req) => {
    canWrite(req);
    const { id, templateId } = req.params as any;
    return prisma.$transaction(async (tx) => {
      const quotation = await tx.quotation.findFirst({ where: activeQuotationWhere(req.ctx, { id }) });
      if (!quotation) throw new AppError('NOT_FOUND');
      if (quotation.status !== 'DRAFT') throw new AppError('FORBIDDEN', 'only draft quotations can be edited');
      const template = await tx.quotationLineTemplate.findFirst({
        where: { id: templateId, active: true },
        include: { entries: { orderBy: [{ createdAt: 'asc' }, { description: 'asc' }] } },
      });
      if (!template) throw new AppError('NOT_FOUND', 'template not found');
      await tx.quotationLine.createMany({
        data: template.entries.map((entry) => ({
          quotationId: id,
          itemCode: entry.itemCode,
          description: entry.description,
          unit: entry.unit,
          quantity: null,
          unitPrice: entry.typicalUnitPrice,
          amount: null,
          remarks: entry.typicalUnitPrice == null ? 'Price TBA subject to inspection.' : null,
        })),
      });
      await tx.quotation.update({ where: { id }, data: { pdfObjectKey: null, version: { increment: 1 } } });
      await appendAudit(tx, req.ctx, { entityType: 'Quotation', entityId: id, action: 'APPLY_LINE_TEMPLATE', diff: { templateId } });
      const updated = await tx.quotation.findUniqueOrThrow({ where: { id }, include: quotationInclude() });
      return serializeQuotation(updated);
    });
  });

  app.post('/api/v1/quotations/:id/generate-pdf', authed, async (req) => {
    canWrite(req);
    const { id } = req.params as any;
    const quotation = await prisma.quotation.findFirst({ where: activeQuotationWhere(req.ctx, { id }) });
    if (!quotation) throw new AppError('NOT_FOUND');
    await enqueueQuotationPdfGeneration(id);
    await appendAudit(prisma as any, req.ctx, { entityType: 'Quotation', entityId: id, action: 'GENERATE_PDF', diff: {} });
    return { status: 'QUEUED' };
  });

  app.get('/api/v1/quotations/:id/pdf', authed, async (req) => {
    const { id } = req.params as any;
    const quotation = await prisma.quotation.findFirst({ where: activeQuotationWhere(req.ctx, { id }) });
    if (!quotation) throw new AppError('NOT_FOUND');
    if (!quotation.pdfObjectKey) return { status: 'PENDING' };
    const url = await Storage.fromEnv().presignGet(quotation.pdfObjectKey, 900);
    return { status: 'READY', url, objectKey: quotation.pdfObjectKey };
  });

  app.get('/api/v1/quotation-line-templates', authed, async (req) => {
    const { category } = (req.query ?? {}) as { category?: string };
    const normalizedCategory = cleanString(category)?.toUpperCase() ?? null;
    const where: Prisma.QuotationLineTemplateWhereInput = normalizedCategory
      ? { active: true, OR: [{ category: normalizedCategory }, { category: null }] }
      : { active: true };
    const templates = await prisma.quotationLineTemplate.findMany({
      where,
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
      include: templateInclude(),
    });
    return templates.map(serializeTemplate);
  });

  app.post('/api/v1/quotation-line-templates', authed, async (req, reply) => {
    if (!canManageTemplates(req.ctx.roles)) throw new AppError('FORBIDDEN');
    const b = (req.body ?? {}) as any;
    const name = cleanString(b.name);
    if (!name) throw new AppError('VALIDATION_ERROR', 'name required');
    const entries = normalizeTemplateEntries(b.entries);
    const template = await prisma.$transaction(async (tx) => {
      const created = await tx.quotationLineTemplate.create({
        data: {
          name,
          category: cleanString(b.category)?.toUpperCase() ?? null,
          createdBy: req.ctx.userId,
          entries: { create: entries },
        },
        include: templateInclude(),
      });
      await appendAudit(tx, req.ctx, { entityType: 'QuotationLineTemplate', entityId: created.id, action: 'CREATE' });
      return created;
    });
    return reply.status(201).send(serializeTemplate(template));
  });

  app.patch('/api/v1/quotation-line-templates/:id', authed, async (req) => {
    if (!canManageTemplates(req.ctx.roles)) throw new AppError('FORBIDDEN');
    const { id } = req.params as any;
    const b = (req.body ?? {}) as any;
    const entries = 'entries' in b ? normalizeTemplateEntries(b.entries) : null;
    return prisma.$transaction(async (tx) => {
      const existing = await tx.quotationLineTemplate.findFirst({ where: { id, active: true } });
      if (!existing) throw new AppError('NOT_FOUND');
      const data: Prisma.QuotationLineTemplateUpdateInput = { version: { increment: 1 } };
      if ('name' in b) {
        const name = cleanString(b.name);
        if (!name) throw new AppError('VALIDATION_ERROR', 'name required');
        data.name = name;
      }
      if ('category' in b) data.category = cleanString(b.category)?.toUpperCase() ?? null;
      await tx.quotationLineTemplate.update({ where: { id }, data });
      if (entries) {
        await tx.quotationLineTemplateEntry.deleteMany({ where: { templateId: id } });
        await tx.quotationLineTemplateEntry.createMany({ data: entries.map((entry) => ({ templateId: id, ...entry })) });
      }
      await appendAudit(tx, req.ctx, { entityType: 'QuotationLineTemplate', entityId: id, action: 'UPDATE', diff: b });
      return serializeTemplate(await tx.quotationLineTemplate.findUniqueOrThrow({ where: { id }, include: templateInclude() }));
    });
  });

  app.delete('/api/v1/quotation-line-templates/:id', authed, async (req) => {
    if (!canManageTemplates(req.ctx.roles)) throw new AppError('FORBIDDEN');
    const { id } = req.params as any;
    await prisma.$transaction(async (tx) => {
      const existing = await tx.quotationLineTemplate.findFirst({ where: { id, active: true } });
      if (!existing) throw new AppError('NOT_FOUND');
      await tx.quotationLineTemplate.update({ where: { id }, data: { active: false, version: { increment: 1 } } });
      await appendAudit(tx, req.ctx, { entityType: 'QuotationLineTemplate', entityId: id, action: 'DELETE' });
    });
    return { deleted: true };
  });

  app.post('/api/v1/quotation-line-templates/from-quotation/:id', authed, async (req, reply) => {
    if (!canManageTemplates(req.ctx.roles)) throw new AppError('FORBIDDEN');
    const { id } = req.params as any;
    const b = (req.body ?? {}) as any;
    const name = cleanString(b.name);
    if (!name) throw new AppError('VALIDATION_ERROR', 'name required');
    const template = await prisma.$transaction(async (tx) => {
      const quotation = await tx.quotation.findFirst({ where: activeQuotationWhere(req.ctx, { id }), include: { lines: true } });
      if (!quotation) throw new AppError('NOT_FOUND');
      if (quotation.lines.length === 0) throw new AppError('VALIDATION_ERROR', 'quotation has no lines');
      const created = await tx.quotationLineTemplate.create({
        data: {
          name,
          category: cleanString(b.category ?? quotation.category)?.toUpperCase() ?? null,
          createdBy: req.ctx.userId,
          entries: {
            create: quotation.lines.map((line) => ({
              itemCode: line.itemCode,
              description: line.description,
              unit: line.unit,
              typicalUnitPrice: line.unitPrice,
            })),
          },
        },
        include: templateInclude(),
      });
      await appendAudit(tx, req.ctx, { entityType: 'QuotationLineTemplate', entityId: created.id, action: 'CREATE_FROM_QUOTATION', diff: { quotationId: id } });
      return created;
    });
    return reply.status(201).send(serializeTemplate(template));
  });
}
