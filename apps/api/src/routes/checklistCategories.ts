import type { FastifyInstance } from 'fastify';
import type { Prisma, PrismaClient } from '@prisma/client';
import { AppError } from '../lib/errors.js';
import { appendAudit } from '../services/audit.js';

type ChecklistCategoryWithItems = Prisma.ChecklistCategoryGetPayload<{ include: { items: true } }>;

function cleanName(value: unknown, field = 'name'): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new AppError('VALIDATION_ERROR', `${field} is required`, { field, reason: 'required' });
  }
  return value.trim();
}

function cleanSortOrder(value: unknown, fallback = 0): number {
  if (value == null) return fallback;
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new AppError('VALIDATION_ERROR', 'sortOrder must be an integer', { field: 'sortOrder', reason: 'type' });
  }
  return value;
}

function mirrorTemplateId(categoryId: string): string {
  return `fixed-${categoryId}`;
}

function mirrorItems(category: ChecklistCategoryWithItems): Prisma.InputJsonValue {
  return category.items
    .sort((a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label))
    .map((item) => ({ id: item.id, label: item.label })) as Prisma.InputJsonValue;
}

async function categoryOrNotFound(prisma: PrismaClient | Prisma.TransactionClient, id: string): Promise<ChecklistCategoryWithItems> {
  const category = await prisma.checklistCategory.findUnique({
    where: { id },
    include: { items: { orderBy: [{ sortOrder: 'asc' }, { label: 'asc' }] } },
  });
  if (!category) throw new AppError('NOT_FOUND');
  return category;
}

async function refreshTemplateMirror(tx: Prisma.TransactionClient, categoryId: string): Promise<void> {
  const category = await categoryOrNotFound(tx, categoryId);
  await tx.checklistTemplate.upsert({
    where: { id: mirrorTemplateId(category.id) },
    update: {
      name: `${category.name} checklist`,
      serviceCategory: category.id,
      items: mirrorItems(category),
      active: true,
      version: { increment: 1 },
    },
    create: {
      id: mirrorTemplateId(category.id),
      name: `${category.name} checklist`,
      serviceCategory: category.id,
      items: mirrorItems(category),
      active: true,
    },
  });
}

export function checklistCategoryRoutes(app: FastifyInstance, prisma: PrismaClient): void {
  const authed = { preHandler: [app.authenticate, app.requireMfaEnrolled] };
  const adminDirector = { preHandler: [app.authenticate, app.requireMfaEnrolled, app.requireAction('user:admin')] };

  app.get('/api/v1/checklist-categories', authed, async () =>
    prisma.checklistCategory.findMany({
      include: { items: { orderBy: [{ sortOrder: 'asc' }, { label: 'asc' }] } },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    }));

  app.post('/api/v1/checklist-categories', adminDirector, async (req, reply) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const name = cleanName(body.name);
    const sortOrder = cleanSortOrder(body.sortOrder);
    const category = await prisma.$transaction(async (tx) => {
      const created = await tx.checklistCategory.create({ data: { name, sortOrder }, include: { items: true } });
      await refreshTemplateMirror(tx, created.id);
      await appendAudit(tx, req.ctx, { entityType: 'ChecklistCategory', entityId: created.id, action: 'CREATE', diff: { name, sortOrder } });
      return categoryOrNotFound(tx, created.id);
    });
    return reply.status(201).send(category);
  });

  app.patch('/api/v1/checklist-categories/:id', adminDirector, async (req) => {
    const { id } = req.params as { id: string };
    const body = (req.body ?? {}) as Record<string, unknown>;
    const existing = await categoryOrNotFound(prisma, id);
    const data: Prisma.ChecklistCategoryUpdateInput = {};
    const diff: Record<string, string | number> = {};
    if ('name' in body) data.name = cleanName(body.name);
    if ('name' in body) diff.name = data.name as string;
    if ('sortOrder' in body) data.sortOrder = cleanSortOrder(body.sortOrder, existing.sortOrder);
    if ('sortOrder' in body) diff.sortOrder = data.sortOrder as number;
    return prisma.$transaction(async (tx) => {
      await tx.checklistCategory.update({ where: { id }, data });
      await refreshTemplateMirror(tx, id);
      await appendAudit(tx, req.ctx, { entityType: 'ChecklistCategory', entityId: id, action: 'UPDATE', diff });
      return categoryOrNotFound(tx, id);
    });
  });

  app.delete('/api/v1/checklist-categories/:id', adminDirector, async (req) => {
    const { id } = req.params as { id: string };
    await categoryOrNotFound(prisma, id);
    const [jobOrderUse, checklistUse] = await Promise.all([
      prisma.jobOrder.count({ where: { serviceCategories: { has: id } } }),
      prisma.checklistInstance.count({ where: { templateId: mirrorTemplateId(id) } }),
    ]);
    if (jobOrderUse > 0 || checklistUse > 0) {
      throw new AppError('VALIDATION_ERROR', 'category cannot be deleted while job orders or checklist history use it', {
        field: 'category',
        reason: 'in_use',
      });
    }
    await prisma.$transaction(async (tx) => {
      await tx.checklistTemplate.updateMany({ where: { id: mirrorTemplateId(id) }, data: { active: false } });
      await tx.checklistTemplateItem.deleteMany({ where: { categoryId: id } });
      await tx.checklistCategory.delete({ where: { id } });
      await appendAudit(tx, req.ctx, { entityType: 'ChecklistCategory', entityId: id, action: 'DELETE' });
    });
    return { deleted: true };
  });

  app.post('/api/v1/checklist-categories/:id/items', adminDirector, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = (req.body ?? {}) as Record<string, unknown>;
    await categoryOrNotFound(prisma, id);
    const label = cleanName(body.label, 'label');
    const sortOrder = cleanSortOrder(body.sortOrder);
    const category = await prisma.$transaction(async (tx) => {
      const item = await tx.checklistTemplateItem.create({ data: { categoryId: id, label, sortOrder } });
      await refreshTemplateMirror(tx, id);
      await appendAudit(tx, req.ctx, { entityType: 'ChecklistTemplateItem', entityId: item.id, action: 'CREATE', diff: { categoryId: id, label, sortOrder } });
      return categoryOrNotFound(tx, id);
    });
    return reply.status(201).send(category);
  });

  app.patch('/api/v1/checklist-categories/:id/items/:itemId', adminDirector, async (req) => {
    const { id, itemId } = req.params as { id: string; itemId: string };
    const body = (req.body ?? {}) as Record<string, unknown>;
    const item = await prisma.checklistTemplateItem.findFirst({ where: { id: itemId, categoryId: id } });
    if (!item) throw new AppError('NOT_FOUND');
    const data: Prisma.ChecklistTemplateItemUpdateInput = {};
    const diff: Record<string, string | number> = {};
    if ('label' in body) data.label = cleanName(body.label, 'label');
    if ('label' in body) diff.label = data.label as string;
    if ('sortOrder' in body) data.sortOrder = cleanSortOrder(body.sortOrder, item.sortOrder);
    if ('sortOrder' in body) diff.sortOrder = data.sortOrder as number;
    return prisma.$transaction(async (tx) => {
      await tx.checklistTemplateItem.update({ where: { id: itemId }, data });
      await refreshTemplateMirror(tx, id);
      await appendAudit(tx, req.ctx, { entityType: 'ChecklistTemplateItem', entityId: itemId, action: 'UPDATE', diff });
      return categoryOrNotFound(tx, id);
    });
  });

  app.delete('/api/v1/checklist-categories/:id/items/:itemId', adminDirector, async (req) => {
    const { id, itemId } = req.params as { id: string; itemId: string };
    const item = await prisma.checklistTemplateItem.findFirst({ where: { id: itemId, categoryId: id } });
    if (!item) throw new AppError('NOT_FOUND');
    return prisma.$transaction(async (tx) => {
      await tx.checklistTemplateItem.delete({ where: { id: itemId } });
      await refreshTemplateMirror(tx, id);
      await appendAudit(tx, req.ctx, { entityType: 'ChecklistTemplateItem', entityId: itemId, action: 'DELETE', diff: { categoryId: id } });
      return categoryOrNotFound(tx, id);
    });
  });
}
