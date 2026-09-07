// Job Order routes (P1-5) — create / read (scoped + IDOR) / header PATCH (locked) / assign /
// JOSM transition. Everything goes through the service layer; audit + version + scope live here.
import type { FastifyInstance } from 'fastify';
import type { Prisma, PrismaClient } from '@prisma/client';
import { AppError } from '../lib/errors.js';
import { assertBranchAccess, scopeWhere, branchForCreate, clientIdForUser } from '../services/branchScope.js';
import { appendAudit } from '../services/audit.js';
import { nextInvoiceNumber, nextJoNumber } from '../services/numbering.js';
import { DEFAULT_LABOUR_RATE } from '../lib/money.js';
import { assertTransition, isHeaderLocked, type JoState } from '../domain/josm.js';
import { buildDraftInvoice } from '../domain/invoice.js';
import { buildFinancialSummary } from '../domain/financialSummary.js';
import { enqueueJobOrderReportGeneration } from '../services/jobOrderReportQueue.js';
import { Storage } from '@marinex360/storage';

const HEADER_FIELDS = ['scopeSummary', 'port', 'plannedStartDate', 'deadline', 'externalQuoteRef', 'externalRfqRef'];
const ALLOWED_CURRENCIES = new Set(['SGD', 'MYR', 'USD', 'IDR']);
const isTech = (roles: string[]) => roles.includes('TECHNICIAN') && roles.length === 1;
const isAdminOrDirector = (roles: string[]) => roles.includes('SYSTEM_ADMIN') || roles.includes('DIRECTOR');
const isDirector = (roles: string[]) => roles.includes('DIRECTOR');

type TechnicianJoAccess = { visible: boolean; canOpen: boolean; readOnly: boolean; canStart: boolean; canResume: boolean };

// P3-11: technician visibility/editability rules should become admin-configurable here.
function technicianAccessFor(jo: { state: string; executionOwnerId?: string | null }, userId: string): TechnicianJoAccess {
  const isOwner = jo.executionOwnerId === userId;
  switch (jo.state) {
    case 'DRAFT':
    case 'CANCELLED':
      return { visible: false, canOpen: false, readOnly: true, canStart: false, canResume: false };
    case 'SCHEDULED':
      return { visible: true, canOpen: true, readOnly: false, canStart: isOwner || jo.executionOwnerId == null, canResume: false };
    case 'IN_PROGRESS':
      return { visible: true, canOpen: isOwner, readOnly: false, canStart: false, canResume: false };
    case 'ON_HOLD':
      return { visible: true, canOpen: true, readOnly: false, canStart: false, canResume: true };
    case 'PENDING_REVIEW':
    case 'COMPLETED':
    case 'INVOICED':
    case 'CLOSED':
      return { visible: true, canOpen: true, readOnly: true, canStart: false, canResume: false };
    default:
      return { visible: false, canOpen: false, readOnly: true, canStart: false, canResume: false };
  }
}

function withTechnicianAccess<T extends { state: string; executionOwnerId?: string | null }>(jo: T, userId: string): T & TechnicianJoAccess {
  return { ...jo, ...technicianAccessFor(jo, userId) };
}

async function validateServiceCategories(prisma: PrismaClient | Prisma.TransactionClient, serviceCategories: unknown): Promise<string[]> {
  if (!Array.isArray(serviceCategories)) {
    throw new AppError('VALIDATION_ERROR', 'serviceCategories must be an array', { field: 'serviceCategories', reason: 'type' });
  }
  const invalid = serviceCategories.find((category) => typeof category !== 'string' || !category.trim());
  if (invalid != null) {
    throw new AppError('VALIDATION_ERROR', 'serviceCategories contains an invalid category', { field: 'serviceCategories', reason: 'invalid' });
  }
  const categories = [...new Set(serviceCategories.map((category) => category.trim()))];
  if (categories.length !== serviceCategories.length) {
    throw new AppError('VALIDATION_ERROR', 'serviceCategories must be unique', { field: 'serviceCategories', reason: 'duplicate' });
  }
  const known = await prisma.checklistCategory.findMany({ where: { id: { in: categories } }, select: { id: true } });
  if (known.length !== categories.length) {
    throw new AppError('VALIDATION_ERROR', 'serviceCategories contains an invalid category', { field: 'serviceCategories', reason: 'invalid' });
  }
  return categories;
}

async function assertJobOrderCreateScope(prisma: PrismaClient, branch: string, clientId: string, vesselId: string): Promise<void> {
  const client = await prisma.client.findFirst({ where: { id: clientId, deletedAt: null } });
  if (!client || client.branch !== branch) throw new AppError('NOT_FOUND', 'client not found');

  const vessel = await prisma.vessel.findFirst({
    where: { id: vesselId, deletedAt: null },
    include: { client: true },
  });
  if (!vessel || vessel.client.deletedAt != null || vessel.client.branch !== branch) throw new AppError('NOT_FOUND', 'vessel not found');
  if (vessel.clientId !== clientId) throw new AppError('VALIDATION_ERROR', 'vesselId must belong to clientId', { field: 'vesselId', reason: 'client_mismatch' });
}

function normalizeCurrency(input: unknown): string {
  if (typeof input !== 'string') throw new AppError('VALIDATION_ERROR', 'currency required');
  const currency = input.trim().toUpperCase();
  if (!ALLOWED_CURRENCIES.has(currency)) throw new AppError('VALIDATION_ERROR', 'currency must be one of SGD, MYR, USD, IDR');
  return currency;
}

async function vendorTagForBranch(
  prisma: PrismaClient | Prisma.TransactionClient,
  branch: string,
  input: { isSubcontracted?: unknown; vendorId?: unknown },
): Promise<{ isSubcontracted: boolean; vendorId: string | null }> {
  const isSubcontracted = Boolean(input.isSubcontracted);
  const vendorId = typeof input.vendorId === 'string' && input.vendorId.trim() ? input.vendorId.trim() : null;
  if (!isSubcontracted) return { isSubcontracted: false, vendorId: null };
  if (!vendorId) throw new AppError('VALIDATION_ERROR', 'vendorId required when job is subcontracted', { field: 'vendorId', reason: 'required' });
  const vendor = await prisma.vendor.findFirst({ where: { id: vendorId, branch, deletedAt: null }, select: { id: true } });
  if (!vendor) throw new AppError('NOT_FOUND', 'vendor not found');
  return { isSubcontracted: true, vendorId };
}

async function assertAssignableTechnicians(prisma: PrismaClient | Prisma.TransactionClient, jobBranch: string, technicianIds: string[]): Promise<void> {
  const uniqueTechnicianIds = new Set(technicianIds);
  if (uniqueTechnicianIds.size !== technicianIds.length) {
    throw new AppError('VALIDATION_ERROR', 'technicianIds must be unique', { field: 'technicianIds', reason: 'duplicate' });
  }

  const technicians = await prisma.user.findMany({
    where: { id: { in: technicianIds }, active: true },
    select: { id: true, roles: true, branch: true },
  });
  if (technicians.length !== technicianIds.length) {
    throw new AppError('VALIDATION_ERROR', 'technicianIds must refer to active technicians in the job branch', { field: 'technicianIds', reason: 'not_found' });
  }
  if (technicians.some((technician) => !technician.roles.includes('TECHNICIAN') || technician.branch !== jobBranch)) {
    throw new AppError('VALIDATION_ERROR', 'technicianIds must refer to active technicians in the job branch', { field: 'technicianIds', reason: 'invalid_technician' });
  }
}

function normalizeJobChecklistItems(input: unknown): { label: string; sortOrder: number }[] {
  if (!Array.isArray(input)) return [];
  return input.map((item: any, index) => {
    const label = typeof item?.label === 'string' ? item.label.trim() : '';
    if (!label) throw new AppError('VALIDATION_ERROR', 'checklist item label required');
    return { label, sortOrder: typeof item.sortOrder === 'number' ? item.sortOrder : index };
  });
}

async function snapshotChecklistForJob(
  tx: Prisma.TransactionClient,
  jobOrderId: string,
  input: { checklistTemplateId?: string | null; checklistItems?: unknown; customChecklistItems?: unknown },
): Promise<void> {
  const existing = await tx.jobOrderChecklistItem.count({ where: { jobOrderId } });
  if (existing > 0) return;

  if (input.checklistTemplateId) {
    const template = await tx.checklistTemplate.findFirst({
      where: { id: input.checklistTemplateId, active: true },
      include: { entries: { orderBy: [{ sortOrder: 'asc' }, { label: 'asc' }] } },
    });
    if (!template) throw new AppError('NOT_FOUND', 'checklist template not found');
    const entries = template.entries.map((entry, index) => ({ label: entry.label, sortOrder: entry.sortOrder ?? index }));
    if (entries.length === 0 && Array.isArray(template.items)) {
      for (const [index, item] of (template.items as any[]).entries()) {
        if (typeof item?.label === 'string' && item.label.trim()) entries.push({ label: item.label.trim(), sortOrder: index });
      }
    }
    if (entries.length > 0) await tx.jobOrderChecklistItem.createMany({ data: entries.map((entry) => ({ jobOrderId, ...entry })) });
    return;
  }

  const customItems = normalizeJobChecklistItems(input.customChecklistItems ?? input.checklistItems);
  if (customItems.length > 0) await tx.jobOrderChecklistItem.createMany({ data: customItems.map((item) => ({ jobOrderId, ...item })) });
}

async function findScopedVisibleJobOrder(tx: Prisma.TransactionClient, id: string, ctx: any): Promise<any> {
  const jo = await tx.jobOrder.findFirst({ where: { id, deletedAt: null, archivedAt: null, purgedAt: null } });
  if (!jo) throw new AppError('NOT_FOUND');
  assertBranchAccess(ctx, jo.branch);
  if (isTech(ctx.roles)) {
    const access = technicianAccessFor(jo, ctx.userId);
    if (!access.visible || !access.canOpen) throw new AppError('NOT_FOUND');
  }
  return jo;
}

export function jobOrderRoutes(app: FastifyInstance, prisma: PrismaClient): void {
  const authed = { preHandler: [app.authenticate, app.requireMfaEnrolled] };

  async function findScopedJobOrder(id: string, ctx: any): Promise<any> {
    const jo = await prisma.jobOrder.findFirst({ where: { id, purgedAt: null } });
    if (!jo) throw new AppError('NOT_FOUND');
    assertBranchAccess(ctx, jo.branch);
    return jo;
  }

  function assertLifecycleManager(roles: string[]): void {
    if (!isAdminOrDirector(roles)) throw new AppError('FORBIDDEN');
  }

  async function listLifecycleBucket(req: any, where: Prisma.JobOrderWhereInput): Promise<Prisma.JobOrderGetPayload<{}>[]> {
    return prisma.jobOrder.findMany({
      where: { ...scopeWhere(req.ctx), ...where, purgedAt: null },
      orderBy: { createdAt: 'desc' },
    });
  }

  // CREATE (OD-02 frozen baseline; D-004 labour rate default; CONV-ID-1 server-issued id)
  app.post('/api/v1/job-orders', { preHandler: [app.authenticate, app.requireMfaEnrolled, app.requireAction('jobOrder:create')] }, async (req, reply) => {
    const b = (req.body ?? {}) as any;
    if (!b.clientId || !b.vesselId || !b.scopeSummary || b.quotedAmountMinor == null || !b.quotedCurrency) {
      throw new AppError('VALIDATION_ERROR', 'clientId, vesselId, scopeSummary, quotedAmount required');
    }
    const branch = branchForCreate(req.ctx, b.branch);
    const quotedCurrency = normalizeCurrency(b.quotedCurrency);
    await assertJobOrderCreateScope(prisma, branch, b.clientId, b.vesselId);
    const created = await prisma.$transaction(async (tx) => {
      const serviceCategories = await validateServiceCategories(tx, b.serviceCategories ?? []);
      const vendorTag = await vendorTagForBranch(tx, branch, b);
      const joNumber = await nextJoNumber(tx, branch);
      const jo = await tx.jobOrder.create({
        data: {
          joNumber, branch, clientId: b.clientId, vesselId: b.vesselId,
          vendorId: vendorTag.vendorId,
          isSubcontracted: vendorTag.isSubcontracted,
          serviceCategories, port: b.port ?? null, scopeSummary: b.scopeSummary,
          deadline: b.deadline ? new Date(b.deadline) : null,
          origin: 'MANUAL', externalQuoteRef: b.externalQuoteRef ?? null, externalRfqRef: b.externalRfqRef ?? null,
          quotedAmountMinor: b.quotedAmountMinor, quotedCurrency,
          labourRateAmountMinor: b.labourRateAmountMinor ?? DEFAULT_LABOUR_RATE.amountMinor,
          labourRateCurrency: b.labourRateCurrency ?? DEFAULT_LABOUR_RATE.currency,
          state: 'DRAFT', createdBy: req.ctx.userId,
        },
      });
      await snapshotChecklistForJob(tx, jo.id, b);
      await appendAudit(tx, req.ctx, { entityType: 'JobOrder', entityId: jo.id, action: 'CREATE' });
      return jo;
    });
    return reply.status(201).send(created);
  });

  // LIST (RBAC-SCOPE-1 service-layer scoping)
  app.get('/api/v1/job-orders', { preHandler: [app.authenticate, app.requireMfaEnrolled, app.requireAction('jobOrder:read')] }, async (req) => {
    const where: any = { ...scopeWhere(req.ctx), deletedAt: null, archivedAt: null, purgedAt: null };
    const clientId = await clientIdForUser(prisma, req.ctx);
    if (req.ctx.roles.includes('CLIENT' as any)) {
      where.clientId = clientId ?? '__unlinked_client__';
      delete where.branch;
    }
    if (isTech(req.ctx.roles)) {
      where.state = { notIn: ['DRAFT', 'CANCELLED'] };
    }
    const jos = await prisma.jobOrder.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        client: { select: { id: true, name: true } },
        vessel: { select: { id: true, name: true, imoNumber: true } },
        vendor: { select: { id: true, name: true } },
      },
    });
    if (!isTech(req.ctx.roles)) return jos;
    return jos.map((jo) => withTechnicianAccess(jo, req.ctx.userId));
  });

  app.get('/api/v1/job-orders/trash', { preHandler: [app.authenticate, app.requireMfaEnrolled, app.requireAction('jobOrder:read')] }, async (req) => {
    assertLifecycleManager(req.ctx.roles);
    return listLifecycleBucket(req, { deletedAt: { not: null } });
  });

  app.get('/api/v1/job-orders/archive', { preHandler: [app.authenticate, app.requireMfaEnrolled, app.requireAction('jobOrder:read')] }, async (req) => {
    assertLifecycleManager(req.ctx.roles);
    return listLifecycleBucket(req, { archivedAt: { not: null }, deletedAt: null });
  });

  app.post('/api/v1/job-orders/trash/empty', { preHandler: [app.authenticate, app.requireMfaEnrolled, app.requireAction('jobOrder:updateHeader')] }, async (req) => {
    assertLifecycleManager(req.ctx.roles);
    const now = new Date();
    const result = await prisma.$transaction(async (tx) => {
      const updateResult = await tx.jobOrder.updateMany({
        where: { ...scopeWhere(req.ctx), deletedAt: { not: null }, purgedAt: null },
        data: { purgedAt: now },
      });
      await appendAudit(tx, req.ctx, { entityType: 'JobOrder', entityId: 'trash', action: 'EMPTY_TRASH', diff: { count: updateResult.count, purgedAt: now } });
      return updateResult;
    });
    return { purged: result.count };
  });

  // GET by id (cross-branch -> NOT_FOUND; technician IDOR -> NOT_FOUND, RBAC-IDOR-1)
  app.get('/api/v1/job-orders/:id', { preHandler: [app.authenticate, app.requireMfaEnrolled, app.requireAction('jobOrder:read')] }, async (req) => {
    const { id } = req.params as any;
    const jo = await prisma.jobOrder.findFirst({
      where: { id, deletedAt: null, archivedAt: null, purgedAt: null },
      include: {
        variations: true,
        client: { select: { id: true, name: true } },
        vessel: { select: { id: true, name: true, imoNumber: true } },
        vendor: { select: { id: true, name: true } },
        checklistItems: { orderBy: [{ sortOrder: 'asc' }, { label: 'asc' }] },
        statusHistory: {
          orderBy: { at: 'asc' },
          include: {
            actor: { select: { id: true, name: true, email: true } },
            device: { select: { id: true, name: true } },
          },
        },
        invoices: {
          orderBy: { createdAt: 'desc' },
          include: { payments: true },
        },
      },
    });
    if (!jo) throw new AppError('NOT_FOUND');
    assertBranchAccess(req.ctx, jo.branch);                 // scope BEFORE anything else (CC-05)
    if (isTech(req.ctx.roles)) {
      const access = technicianAccessFor(jo, req.ctx.userId);
      if (!access.visible || !access.canOpen) throw new AppError('NOT_FOUND');
      return { ...jo, ...access };
    }
    if (req.ctx.roles.includes('CLIENT' as any)) {
      const clientId = await clientIdForUser(prisma, req.ctx);
      if (jo.clientId !== clientId) throw new AppError('NOT_FOUND');
    }
    return jo;
  });

  app.get('/api/v1/job-orders/:id/financial-summary', { preHandler: [app.authenticate, app.requireMfaEnrolled, app.requireAction('jobOrder:read')] }, async (req) => {
    const { id } = req.params as any;
    const jo = await prisma.jobOrder.findFirst({ where: { id, deletedAt: null, archivedAt: null, purgedAt: null } });
    if (!jo) throw new AppError('NOT_FOUND');
    assertBranchAccess(req.ctx, jo.branch);
    if (isTech(req.ctx.roles)) {
      const access = technicianAccessFor(jo, req.ctx.userId);
      if (!access.visible || !access.canOpen) throw new AppError('NOT_FOUND');
    }
    if (req.ctx.roles.includes('CLIENT' as any) && (await clientIdForUser(prisma, req.ctx)) !== jo.clientId) throw new AppError('NOT_FOUND');

    type InvoiceWorkLogRow = {
      startedAt: Date;
      endedAt: Date | null;
      labourRateAmountMinor: number | null;
      labourRateCurrency: string | null;
    };
    const [workLogs, materialLines, variations, invoice] = await Promise.all([
      prisma.$queryRaw<InvoiceWorkLogRow[]>`
        SELECT "startedAt", "endedAt", "labourRateAmountMinor", "labourRateCurrency"
        FROM "WorkLog"
        WHERE "jobOrderId" = ${id}
      `,
      prisma.materialLine.findMany({ where: { jobOrderId: id, deletedAt: null } }),
      prisma.variation.findMany({ where: { jobOrderId: id } }),
      prisma.invoice.findFirst({ where: { jobOrderId: id }, orderBy: { createdAt: 'desc' } }),
    ]);

    return buildFinancialSummary({
      branch: jo.branch,
      baselineAmountMinor: jo.quotedAmountMinor,
      baselineCurrency: jo.quotedCurrency,
      workLogs: workLogs.map((workLog) => ({
        startedAt: workLog.startedAt,
        endedAt: workLog.endedAt,
        labourRateAmountMinor: workLog.labourRateAmountMinor,
        labourRateCurrency: workLog.labourRateCurrency,
      })),
      materialLines: materialLines.map((materialLine) => ({
        description: materialLine.description,
        quantity: Number(materialLine.quantity),
        unit: materialLine.unit,
        unitCostAmountMinor: materialLine.unitCostAmountMinor,
        unitCostCurrency: materialLine.unitCostCurrency,
      })),
      variations: variations.map((variation) => ({
        reason: variation.reason,
        status: variation.status,
        amountMinor: variation.amountMinor,
        amountCurrency: variation.amountCurrency,
      })),
      invoice: invoice ? { totalAmountMinor: invoice.totalAmountMinor, totalCurrency: invoice.totalCurrency } : null,
    });
  });

  app.post('/api/v1/job-orders/:id/delete', { preHandler: [app.authenticate, app.requireMfaEnrolled, app.requireAction('jobOrder:updateHeader')] }, async (req) => {
    assertLifecycleManager(req.ctx.roles);
    const { id } = req.params as any;
    const jo = await findScopedJobOrder(id, req.ctx);
    const now = new Date();
    await prisma.$transaction(async (tx) => {
      await tx.jobOrder.update({ where: { id: jo.id }, data: { deletedAt: now, archivedAt: null } });
      await appendAudit(tx, req.ctx, { entityType: 'JobOrder', entityId: jo.id, action: 'DELETE', diff: { deletedAt: now, archivedAt: null } });
    });
    return prisma.jobOrder.findUnique({ where: { id: jo.id } });
  });

  app.post('/api/v1/job-orders/:id/archive', { preHandler: [app.authenticate, app.requireMfaEnrolled, app.requireAction('jobOrder:updateHeader')] }, async (req) => {
    assertLifecycleManager(req.ctx.roles);
    const { id } = req.params as any;
    const jo = await findScopedJobOrder(id, req.ctx);
    const now = new Date();
    await prisma.$transaction(async (tx) => {
      await tx.jobOrder.update({ where: { id: jo.id }, data: { archivedAt: now, deletedAt: null } });
      await appendAudit(tx, req.ctx, { entityType: 'JobOrder', entityId: jo.id, action: 'ARCHIVE', diff: { archivedAt: now, deletedAt: null } });
    });
    return prisma.jobOrder.findUnique({ where: { id: jo.id } });
  });

  app.post('/api/v1/job-orders/:id/purge', { preHandler: [app.authenticate, app.requireMfaEnrolled, app.requireAction('jobOrder:updateHeader')] }, async (req) => {
    assertLifecycleManager(req.ctx.roles);
    const { id } = req.params as any;
    const jo = await findScopedJobOrder(id, req.ctx);
    if (jo.deletedAt == null && jo.archivedAt == null) {
      throw new AppError('VALIDATION_ERROR', 'job order must be trashed or archived before purge');
    }
    if (jo.deletedAt == null && jo.archivedAt != null && !isDirector(req.ctx.roles)) {
      throw new AppError('FORBIDDEN', 'only DIRECTOR can purge archived job orders');
    }
    const now = new Date();
    await prisma.$transaction(async (tx) => {
      await tx.jobOrder.update({ where: { id: jo.id }, data: { purgedAt: now } });
      await appendAudit(tx, req.ctx, { entityType: 'JobOrder', entityId: jo.id, action: 'PURGE', diff: { purgedAt: now, from: jo.deletedAt != null ? 'trash' : 'archive' } });
    });
    return { purged: true };
  });

  // PATCH header (CC-02/JOSM-6 header lock; scope changes go via Variation)
  app.patch('/api/v1/job-orders/:id', { preHandler: [app.authenticate, app.requireMfaEnrolled, app.requireAction('jobOrder:updateHeader')] }, async (req) => {
    const { id } = req.params as any;
    const b = (req.body ?? {}) as any;
    if (typeof b.version !== 'number') throw new AppError('VALIDATION_ERROR', 'version required');
    return prisma.$transaction(async (tx) => {
      const jo = await tx.jobOrder.findFirst({ where: { id, deletedAt: null, archivedAt: null, purgedAt: null } });
      if (!jo) throw new AppError('NOT_FOUND');
      assertBranchAccess(req.ctx, jo.branch);
      if (isHeaderLocked(jo.state as JoState)) throw new AppError('FORBIDDEN', 'header locked; scope changes require a Variation');
      const data: any = {};
      for (const f of HEADER_FIELDS) if (f in b) data[f] = b[f];
      if ('isSubcontracted' in b || 'vendorId' in b) {
        Object.assign(data, await vendorTagForBranch(tx, jo.branch, b));
      }
      const res = await tx.jobOrder.updateMany({ where: { id, version: b.version }, data: { ...data, version: { increment: 1 } } });
      if (res.count === 0) throw new AppError('VERSION_CONFLICT');
      await appendAudit(tx, req.ctx, { entityType: 'JobOrder', entityId: id, action: 'UPDATE', diff: data });
      return tx.jobOrder.findUnique({ where: { id } });
    });
  });

  app.patch('/api/v1/job-orders/:id/categories', { preHandler: [app.authenticate, app.requireMfaEnrolled, app.requireAction('jobOrder:updateHeader')] }, async (req) => {
    const { id } = req.params as any;
    const b = (req.body ?? {}) as any;
    if (typeof b.version !== 'number') throw new AppError('VALIDATION_ERROR', 'version required');
    return prisma.$transaction(async (tx) => {
      const serviceCategories = await validateServiceCategories(tx, b.serviceCategories);
      const jo = await tx.jobOrder.findFirst({ where: { id, deletedAt: null, archivedAt: null, purgedAt: null } });
      if (!jo) throw new AppError('NOT_FOUND');
      assertBranchAccess(req.ctx, jo.branch);
      const res = await tx.jobOrder.updateMany({
        where: { id, version: b.version },
        data: { serviceCategories, version: { increment: 1 } },
      });
      if (res.count === 0) throw new AppError('VERSION_CONFLICT');
      await appendAudit(tx, req.ctx, { entityType: 'JobOrder', entityId: id, action: 'UPDATE_CATEGORIES', diff: { serviceCategories } });
      return tx.jobOrder.findUnique({ where: { id } });
    });
  });

  // ASSIGN single execution owner (OD-05/CC-1). Owner must be among technicianIds. Locks once IN_PROGRESS.
  app.post('/api/v1/job-orders/:id/assign', { preHandler: [app.authenticate, app.requireMfaEnrolled, app.requireAction('jobOrder:assign')] }, async (req) => {
    const { id } = req.params as any;
    const { technicianIds, executionOwnerId, version } = (req.body ?? {}) as any;
    if (!Array.isArray(technicianIds) || !executionOwnerId) throw new AppError('VALIDATION_ERROR', 'technicianIds[] and executionOwnerId required');
    if (!technicianIds.includes(executionOwnerId)) throw new AppError('VALIDATION_ERROR', 'executionOwnerId must be one of technicianIds');
    if (typeof version !== 'number') throw new AppError('VALIDATION_ERROR', 'version required');
    return prisma.$transaction(async (tx) => {
      const jo = await tx.jobOrder.findFirst({ where: { id, deletedAt: null, archivedAt: null, purgedAt: null } });
      if (!jo) throw new AppError('NOT_FOUND');
      assertBranchAccess(req.ctx, jo.branch);
      await assertAssignableTechnicians(tx, jo.branch, technicianIds);
      if (['IN_PROGRESS', 'PENDING_REVIEW', 'COMPLETED', 'INVOICED', 'CLOSED'].includes(jo.state)) {
        throw new AppError('FORBIDDEN', 'assignment locked once execution has begun');
      }
      const res = await tx.jobOrder.updateMany({ where: { id, version }, data: { assignedTechnicianIds: technicianIds, executionOwnerId, version: { increment: 1 } } });
      if (res.count === 0) throw new AppError('VERSION_CONFLICT');
      await appendAudit(tx, req.ctx, { entityType: 'JobOrder', entityId: id, action: 'ASSIGN', diff: { technicianIds, executionOwnerId } });
      return tx.jobOrder.findUnique({ where: { id } });
    });
  });

  app.get('/api/v1/job-orders/:id/checklist-items', authed, async (req) => {
    const { id } = req.params as any;
    return prisma.$transaction(async (tx) => {
      await findScopedVisibleJobOrder(tx, id, req.ctx);
      return tx.jobOrderChecklistItem.findMany({ where: { jobOrderId: id }, orderBy: [{ sortOrder: 'asc' }, { label: 'asc' }] });
    });
  });

  app.post('/api/v1/job-orders/:id/checklist-items', { preHandler: [app.authenticate, app.requireMfaEnrolled, app.requireAction('jobOrder:updateHeader')] }, async (req, reply) => {
    if (!isAdminOrDirector(req.ctx.roles)) throw new AppError('FORBIDDEN');
    const { id } = req.params as any;
    const b = (req.body ?? {}) as any;
    const [item] = normalizeJobChecklistItems([b]);
    const created = await prisma.$transaction(async (tx) => {
      const jo = await tx.jobOrder.findFirst({
        where: { id, deletedAt: null, archivedAt: null, purgedAt: null },
        include: { invoices: { select: { id: true }, take: 1 } },
      });
      if (!jo) throw new AppError('NOT_FOUND');
      assertBranchAccess(req.ctx, jo.branch);
      if (jo.state === 'INVOICED' || jo.invoices.length > 0) throw new AppError('VALIDATION_ERROR', 'Cannot modify checklist after invoicing');
      const row = await tx.jobOrderChecklistItem.create({ data: { jobOrderId: id, ...item } });
      if (jo.state === 'COMPLETED') {
        const reason = 'New checklist item added — requires re-verification';
        const history = await tx.jobStatusHistory.findMany({ where: { jobOrderId: id }, orderBy: { at: 'asc' }, select: { fromState: true, toState: true } });
        const { to: target } = assertTransition({
          from: jo.state as JoState,
          to: 'ON_HOLD',
          actor: { userId: req.ctx.userId, roles: req.ctx.roles },
          reason,
          executionOwnerId: jo.executionOwnerId,
          history,
        });
        await tx.jobOrder.update({ where: { id }, data: { state: target, version: { increment: 1 } } });
        await tx.jobStatusHistory.create({ data: { jobOrderId: id, fromState: jo.state, toState: target, actorId: req.ctx.userId, deviceId: req.ctx.deviceId ?? null, reason } });
        await appendAudit(tx, req.ctx, { entityType: 'JobOrder', entityId: id, action: 'STATE_TRANSITION', diff: { from: jo.state, to: target, reason } });
      }
      await appendAudit(tx, req.ctx, { entityType: 'JobOrderChecklistItem', entityId: row.id, action: 'CREATE', diff: { jobOrderId: id, label: row.label } });
      return row;
    });
    return reply.status(201).send(created);
  });

  app.patch('/api/v1/job-orders/:id/checklist-items/:itemId', authed, async (req) => {
    const { id, itemId } = req.params as any;
    const b = (req.body ?? {}) as any;
    if (typeof b.checked !== 'boolean') throw new AppError('VALIDATION_ERROR', 'checked must be boolean');
    return prisma.$transaction(async (tx) => {
      const jo = await findScopedVisibleJobOrder(tx, id, req.ctx);
      if (isTech(req.ctx.roles) && technicianAccessFor(jo, req.ctx.userId).readOnly) throw new AppError('FORBIDDEN');
      const existing = await tx.jobOrderChecklistItem.findFirst({ where: { id: itemId, jobOrderId: id } });
      if (!existing) throw new AppError('NOT_FOUND');
      const updated = await tx.jobOrderChecklistItem.update({ where: { id: itemId }, data: { checked: b.checked } });
      await appendAudit(tx, req.ctx, { entityType: 'JobOrderChecklistItem', entityId: itemId, action: 'UPDATE', diff: { checked: b.checked } });
      return updated;
    });
  });

  // TRANSITION (JOSM). Gating (role/exec-owner/reason) is enforced by assertTransition.
  app.get('/api/v1/job-orders/:id/report', { preHandler: [app.authenticate, app.requireMfaEnrolled, app.requireAction('jobOrder:read')] }, async (req) => {
    const { id } = req.params as any;
    const jo = await prisma.jobOrder.findFirst({ where: { id, deletedAt: null, archivedAt: null, purgedAt: null } });
    if (!jo) throw new AppError('NOT_FOUND');
    assertBranchAccess(req.ctx, jo.branch);
    if (req.ctx.roles.includes('CLIENT' as any) && (await clientIdForUser(prisma, req.ctx)) !== jo.clientId) throw new AppError('NOT_FOUND');
    if (isTech(req.ctx.roles)) {
      const access = technicianAccessFor(jo, req.ctx.userId);
      if (!access.visible || !access.canOpen) throw new AppError('NOT_FOUND');
    }
    if (!['COMPLETED', 'INVOICED', 'CLOSED'].includes(jo.state)) {
      throw new AppError('VALIDATION_ERROR', 'report is only available once the job order is completed');
    }
    if (!jo.reportObjectKey) return { status: 'PENDING' };
    const url = await Storage.fromEnv().presignGet(jo.reportObjectKey, 900);
    return { status: 'READY', url, objectKey: jo.reportObjectKey };
  });

  app.post('/api/v1/job-orders/:id/transition', authed, async (req) => {
    const { id } = req.params as any;
    const { to, reason, version } = (req.body ?? {}) as any;
    if (!to || typeof version !== 'number') throw new AppError('VALIDATION_ERROR', 'to and version required');
    const transitioned = await prisma.$transaction(async (tx) => {
      const jo = await tx.jobOrder.findFirst({ where: { id, deletedAt: null, archivedAt: null, purgedAt: null } });
      if (!jo) throw new AppError('NOT_FOUND');
      assertBranchAccess(req.ctx, jo.branch);               // scope before version (CC-05)
      const history = await tx.jobStatusHistory.findMany({ where: { jobOrderId: id }, orderBy: { at: 'asc' }, select: { fromState: true, toState: true } });
      const techResumeClaim = isTech(req.ctx.roles) && jo.state === 'ON_HOLD';
      const techStartClaim = isTech(req.ctx.roles) && jo.state === 'SCHEDULED' && jo.executionOwnerId == null;
      const { to: target } = assertTransition({
        from: jo.state as JoState, to, actor: { userId: req.ctx.userId, roles: req.ctx.roles }, reason,
        executionOwnerId: techResumeClaim || techStartClaim ? req.ctx.userId : jo.executionOwnerId, history,
      });
      const data: Prisma.JobOrderUpdateManyMutationInput = { state: target, version: { increment: 1 } };
      if (techResumeClaim || techStartClaim) {
        const technicianIds = (jo.assignedTechnicianIds ?? []).includes(req.ctx.userId)
          ? jo.assignedTechnicianIds
          : [...(jo.assignedTechnicianIds ?? []), req.ctx.userId];
        data.executionOwnerId = req.ctx.userId;
        data.assignedTechnicianIds = technicianIds;
      }
      const updateWhere = techStartClaim ? { id, version, executionOwnerId: null } : { id, version };
      const res = await tx.jobOrder.updateMany({ where: updateWhere, data });
      if (res.count === 0) throw new AppError('VERSION_CONFLICT'); // CC-04 concurrent transition loser
      if (target === 'SCHEDULED') await snapshotChecklistForJob(tx, id, req.body as any);
      await tx.jobStatusHistory.create({ data: { jobOrderId: id, fromState: jo.state, toState: target, actorId: req.ctx.userId, deviceId: req.ctx.deviceId ?? null, reason: reason ?? null } });
      // D-006 (closed): reason is now first-class on JobStatusHistory itself, not just the
      // audit diff. Kept in the audit diff too for redundancy — cheap, and audit stays the
      // fuller record of "what happened and why" independent of any one table.
      await appendAudit(tx, req.ctx, { entityType: 'JobOrder', entityId: id, action: 'STATE_TRANSITION', diff: { from: jo.state, to: target, reason: reason ?? null } });
      // FR-40: auto-generate a DRAFT invoice the moment a JO reaches COMPLETED. Same
      // transaction as the state change — a failure here rolls back the transition too,
      // which is correct (never leave a JO COMPLETED with no invoice).
      if (target === 'COMPLETED') {
        type InvoiceWorkLogRow = {
          startedAt: Date;
          endedAt: Date | null;
          labourRateAmountMinor: number | null;
          labourRateCurrency: string | null;
        };
        const [workLogs, materialLines, variations, client] = await Promise.all([
          tx.$queryRaw<InvoiceWorkLogRow[]>`
            SELECT "startedAt", "endedAt", "labourRateAmountMinor", "labourRateCurrency"
            FROM "WorkLog"
            WHERE "jobOrderId" = ${id}
          `,
          tx.materialLine.findMany({ where: { jobOrderId: id, deletedAt: null } }),
          tx.variation.findMany({ where: { jobOrderId: id } }),
          tx.client.findUniqueOrThrow({ where: { id: jo.clientId }, include: { primaryContact: true } }),
        ]);
        const draft = buildDraftInvoice({
          branch: jo.branch,
          currency: jo.quotedCurrency,
          workLogs: workLogs.map((workLog) => ({
            startedAt: workLog.startedAt,
            endedAt: workLog.endedAt,
            labourRateAmountMinor: workLog.labourRateAmountMinor,
            labourRateCurrency: workLog.labourRateCurrency,
          })),
          materialLines: materialLines.map((materialLine) => ({
            description: materialLine.description,
            quantity: Number(materialLine.quantity),
            unit: materialLine.unit,
            unitCostAmountMinor: materialLine.unitCostAmountMinor,
            unitCostCurrency: materialLine.unitCostCurrency,
          })),
          variations: variations.map((variation) => ({
            reason: variation.reason,
            status: variation.status,
            amountMinor: variation.amountMinor,
            amountCurrency: variation.amountCurrency,
          })),
        });
        const invoiceNumber = await nextInvoiceNumber(tx, jo.branch);
        const invoice = await tx.invoice.create({
          data: {
            invoiceNumber, jobOrderId: id, branch: jo.branch, status: 'DRAFT',
            billToName: client.name, billToAddress: client.address ?? null, billToEmail: client.primaryContact?.email ?? null,
            gstAmountMinor: draft.gstAmountMinor, gstCurrency: draft.gstCurrency,
            totalAmountMinor: draft.totalAmountMinor, totalCurrency: draft.currency,
            lines: { create: draft.lines.map((line) => ({
              kind: line.kind, description: line.description, quantity: line.quantity, unit: line.unit,
              unitPriceAmountMinor: line.unitPriceAmountMinor, unitPriceCurrency: line.unitPriceCurrency,
              lineTotalAmountMinor: line.lineTotalAmountMinor, lineTotalCurrency: line.lineTotalCurrency,
            })) },
          },
        });
        await appendAudit(tx, req.ctx, { entityType: 'Invoice', entityId: invoice.id, action: 'CREATE', diff: { jobOrderId: id, totalAmountMinor: draft.totalAmountMinor, lineCount: draft.lines.length } });
      }
      return tx.jobOrder.findUnique({ where: { id } });
    });
    if (transitioned?.state === 'COMPLETED') {
      try {
        await enqueueJobOrderReportGeneration(id);
      } catch (err) {
        await prisma.auditEntry.create({
          data: {
            entityType: 'JobOrder',
            entityId: id,
            action: 'REPORT_ENQUEUE_FAILED',
            actorId: req.ctx.userId,
            diff: { message: err instanceof Error ? err.message : String(err) },
          },
        });
      }
    }
    return transitioned;
  });
}
