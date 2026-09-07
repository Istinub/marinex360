// Checklist routes (G-4, closed via TL ruling S0-8). Templates are admin-authored; instances
// are created against a Job Order and submitted by the assignee. Enforces the ratified
// ChecklistItemDef/ChecklistItemResult shapes at this layer — Json columns stay untyped in
// Prisma per TL's note (contract-type fix, not a schema change).
import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { AppError } from '../lib/errors.js';
import { assertBranchAccess } from '../services/branchScope.js';
import { appendAudit } from '../services/audit.js';
import { validateItemDefs, validateResults } from '../domain/checklist.js';

const isAssignee = (jo: { executionOwnerId: string | null; assignedTechnicianIds: string[] }, uid: string) =>
  jo.executionOwnerId === uid || jo.assignedTechnicianIds.includes(uid);
const isTemplateManager = (roles: string[]) => roles.includes('SYSTEM_ADMIN') || roles.includes('DIRECTOR');

type TemplateEntryInput = { id?: string; label?: unknown; sortOrder?: unknown };

function normalizeTemplateEntries(input: unknown): { label: string; sortOrder: number }[] {
  if (!Array.isArray(input)) return [];
  return input.map((entry: TemplateEntryInput, index) => {
    const label = typeof entry.label === 'string' ? entry.label.trim() : '';
    if (!label) throw new AppError('VALIDATION_ERROR', 'entry label required');
    return {
      label,
      sortOrder: typeof entry.sortOrder === 'number' ? entry.sortOrder : index,
    };
  });
}

function legacyItemsFromEntries(entries: { label: string; sortOrder: number }[]): Prisma.InputJsonValue {
  return entries
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((entry, index) => ({ id: `entry-${index + 1}`, label: entry.label, type: 'boolean', required: false })) as unknown as Prisma.InputJsonValue;
}

async function syncLegacyTemplateItems(tx: Prisma.TransactionClient, templateId: string): Promise<void> {
  const entries = await tx.checklistTemplateEntry.findMany({ where: { templateId }, orderBy: [{ sortOrder: 'asc' }, { label: 'asc' }] });
  await tx.checklistTemplate.update({
    where: { id: templateId },
    data: { items: legacyItemsFromEntries(entries), version: { increment: 1 } },
  });
}

export function checklistRoutes(app: FastifyInstance, prisma: PrismaClient): void {
  const authed = { preHandler: [app.authenticate, app.requireMfaEnrolled] };

  // ---- Templates (Director/Admin-authored; readable by every authenticated app role) ----
  app.post('/api/v1/checklist-templates', authed, async (req, reply) => {
    if (!isTemplateManager(req.ctx.roles)) throw new AppError('FORBIDDEN');
    const b = (req.body ?? {}) as any;
    const name = typeof b.name === 'string' ? b.name.trim() : '';
    if (!name) throw new AppError('VALIDATION_ERROR', 'name required');
    const entries = normalizeTemplateEntries(b.entries ?? b.items ?? []);
    const tpl = await prisma.$transaction(async (tx) => {
      if (b.categoryId) {
        const category = await tx.checklistCategory.findUnique({ where: { id: b.categoryId } });
        if (!category) throw new AppError('NOT_FOUND', 'category not found');
      }
      const t = await tx.checklistTemplate.create({
        data: {
          name,
          categoryId: b.categoryId ?? null,
          createdBy: req.ctx.userId,
          serviceCategory: b.categoryId ?? null,
          jobType: b.jobType ?? null,
          items: legacyItemsFromEntries(entries),
          entries: { create: entries },
        },
        include: { entries: { orderBy: [{ sortOrder: 'asc' }, { label: 'asc' }] }, category: true },
      });
      await appendAudit(tx, req.ctx, { entityType: 'ChecklistTemplate', entityId: t.id, action: 'CREATE' });
      return t;
    });
    return reply.status(201).send(tpl);
  });

  app.get('/api/v1/checklist-templates', authed, async (req) => {
    const { categoryId } = (req.query ?? {}) as { categoryId?: string };
    const where: Prisma.ChecklistTemplateWhereInput = categoryId
      ? { active: true, OR: [{ categoryId }, { categoryId: null }] }
      : { active: true };
    return prisma.checklistTemplate.findMany({
      where,
      orderBy: [{ categoryId: 'asc' }, { name: 'asc' }],
      include: { entries: { orderBy: [{ sortOrder: 'asc' }, { label: 'asc' }] }, category: true },
    });
  });

  app.patch('/api/v1/checklist-templates/:id', authed, async (req) => {
    if (!isTemplateManager(req.ctx.roles)) throw new AppError('FORBIDDEN');
    const { id } = req.params as any;
    const b = (req.body ?? {}) as any;
    return prisma.$transaction(async (tx) => {
      const template = await tx.checklistTemplate.findFirst({ where: { id, active: true } });
      if (!template) throw new AppError('NOT_FOUND');
      if ('categoryId' in b && b.categoryId) {
        const category = await tx.checklistCategory.findUnique({ where: { id: b.categoryId } });
        if (!category) throw new AppError('NOT_FOUND', 'category not found');
      }
      const data: Prisma.ChecklistTemplateUpdateInput = {};
      if ('name' in b) {
        const name = typeof b.name === 'string' ? b.name.trim() : '';
        if (!name) throw new AppError('VALIDATION_ERROR', 'name required');
        data.name = name;
      }
      if ('categoryId' in b) {
        data.category = b.categoryId ? { connect: { id: b.categoryId } } : { disconnect: true };
        data.serviceCategory = b.categoryId ?? null;
      }
      const updated = await tx.checklistTemplate.update({
        where: { id },
        data: { ...data, version: { increment: 1 } },
        include: { entries: { orderBy: [{ sortOrder: 'asc' }, { label: 'asc' }] }, category: true },
      });
      await appendAudit(tx, req.ctx, { entityType: 'ChecklistTemplate', entityId: id, action: 'UPDATE', diff: b });
      return updated;
    });
  });

  app.delete('/api/v1/checklist-templates/:id', authed, async (req) => {
    if (!isTemplateManager(req.ctx.roles)) throw new AppError('FORBIDDEN');
    const { id } = req.params as any;
    await prisma.$transaction(async (tx) => {
      const template = await tx.checklistTemplate.findFirst({ where: { id, active: true } });
      if (!template) throw new AppError('NOT_FOUND');
      await tx.checklistTemplate.update({ where: { id }, data: { active: false, version: { increment: 1 } } });
      await appendAudit(tx, req.ctx, { entityType: 'ChecklistTemplate', entityId: id, action: 'DELETE' });
    });
    return { deleted: true };
  });

  app.post('/api/v1/checklist-templates/:id/entries', authed, async (req, reply) => {
    if (!isTemplateManager(req.ctx.roles)) throw new AppError('FORBIDDEN');
    const { id } = req.params as any;
    const [entryInput] = normalizeTemplateEntries([req.body ?? {}]);
    const entry = await prisma.$transaction(async (tx) => {
      const template = await tx.checklistTemplate.findFirst({ where: { id, active: true } });
      if (!template) throw new AppError('NOT_FOUND');
      const created = await tx.checklistTemplateEntry.create({ data: { templateId: id, ...entryInput } });
      await syncLegacyTemplateItems(tx, id);
      await appendAudit(tx, req.ctx, { entityType: 'ChecklistTemplate', entityId: id, action: 'ADD_ENTRY', diff: { entryId: created.id, label: created.label } });
      return created;
    });
    return reply.status(201).send(entry);
  });

  app.patch('/api/v1/checklist-templates/:id/entries/:entryId', authed, async (req) => {
    if (!isTemplateManager(req.ctx.roles)) throw new AppError('FORBIDDEN');
    const { id, entryId } = req.params as any;
    const b = (req.body ?? {}) as any;
    return prisma.$transaction(async (tx) => {
      const entry = await tx.checklistTemplateEntry.findFirst({ where: { id: entryId, templateId: id } });
      if (!entry) throw new AppError('NOT_FOUND');
      const data: Prisma.ChecklistTemplateEntryUpdateInput = {};
      if ('label' in b) {
        const label = typeof b.label === 'string' ? b.label.trim() : '';
        if (!label) throw new AppError('VALIDATION_ERROR', 'entry label required');
        data.label = label;
      }
      if ('sortOrder' in b) {
        if (typeof b.sortOrder !== 'number') throw new AppError('VALIDATION_ERROR', 'sortOrder must be a number');
        data.sortOrder = b.sortOrder;
      }
      const updated = await tx.checklistTemplateEntry.update({ where: { id: entryId }, data });
      await syncLegacyTemplateItems(tx, id);
      await appendAudit(tx, req.ctx, { entityType: 'ChecklistTemplate', entityId: id, action: 'UPDATE_ENTRY', diff: { entryId } });
      return updated;
    });
  });

  app.delete('/api/v1/checklist-templates/:id/entries/:entryId', authed, async (req) => {
    if (!isTemplateManager(req.ctx.roles)) throw new AppError('FORBIDDEN');
    const { id, entryId } = req.params as any;
    await prisma.$transaction(async (tx) => {
      const entry = await tx.checklistTemplateEntry.findFirst({ where: { id: entryId, templateId: id } });
      if (!entry) throw new AppError('NOT_FOUND');
      await tx.checklistTemplateEntry.delete({ where: { id: entryId } });
      await syncLegacyTemplateItems(tx, id);
      await appendAudit(tx, req.ctx, { entityType: 'ChecklistTemplate', entityId: id, action: 'DELETE_ENTRY', diff: { entryId } });
    });
    return { deleted: true };
  });

  // ---- Instances (created against a JO; submission enforces results against the template) ----
  app.post('/api/v1/job-orders/:id/checklists', authed, async (req, reply) => {
    const { id: jobOrderId } = req.params as any;
    const { templateId } = (req.body ?? {}) as any;
    if (!templateId) throw new AppError('VALIDATION_ERROR', 'templateId required');
    const jo = await prisma.jobOrder.findFirst({ where: { id: jobOrderId, deletedAt: null } });
    if (!jo) throw new AppError('NOT_FOUND');
    assertBranchAccess(req.ctx, jo.branch);
    const template = await prisma.checklistTemplate.findUnique({ where: { id: templateId } });
    if (!template || !template.active) throw new AppError('NOT_FOUND', 'template not found');
    const instance = await prisma.$transaction(async (tx) => {
      const inst = await tx.checklistInstance.create({ data: { jobOrderId, templateId, results: [] } });
      await appendAudit(tx, req.ctx, { entityType: 'ChecklistInstance', entityId: inst.id, action: 'CREATE' });
      return inst;
    });
    return reply.status(201).send(instance);
  });

  // Submit/complete: validates results against the instance's own template, sets completedAt.
  // reviewState stays whatever SYNC-13 flagging set it to (untouched here) — this is the online
  // path; the offline path goes through /sync/batch and sets reviewState per D-002.
  app.post('/api/v1/checklists/:id/submit', authed, async (req, reply) => {
    const { id } = req.params as any;
    const { results, version } = (req.body ?? {}) as any;
    if (typeof version !== 'number') throw new AppError('VALIDATION_ERROR', 'version required');
    const out = await prisma.$transaction(async (tx) => {
      const inst = await tx.checklistInstance.findUnique({ where: { id }, include: { jobOrder: true, template: true } });
      if (!inst) throw new AppError('NOT_FOUND');
      assertBranchAccess(req.ctx, inst.jobOrder.branch);
      if (!isAssignee(inst.jobOrder, req.ctx.userId) && !req.ctx.roles.includes('OPS_SUPERVISOR') && !req.ctx.roles.includes('SYSTEM_ADMIN')) {
        throw new AppError('FORBIDDEN', 'only the assignee or a supervisor may submit this checklist');
      }
      const defs = validateItemDefs(inst.template.items); // re-validate template defensively
      const validated = validateResults(defs, results);   // throws VALIDATION_ERROR on any mismatch
      const res = await tx.checklistInstance.updateMany({
        where: { id, version },
        data: { results: validated as unknown as Prisma.InputJsonValue, completedById: req.ctx.userId, completedAt: new Date(), version: { increment: 1 } },
      });
      if (res.count === 0) throw new AppError('VERSION_CONFLICT');
      await appendAudit(tx, req.ctx, { entityType: 'ChecklistInstance', entityId: id, action: 'SUBMIT' });
      return tx.checklistInstance.findUnique({ where: { id } });
    });
    return reply.send(out);
  });
}
