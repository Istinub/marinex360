// Checklist routes (G-4, closed via TL ruling S0-8). Templates are admin-authored; instances
// are created against a Job Order and submitted by the assignee. Enforces the ratified
// ChecklistItemDef/ChecklistItemResult shapes at this layer — Json columns stay untyped in
// Prisma per TL's note (contract-type fix, not a schema change).
import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import { AppError } from '../lib/errors.js';
import { assertBranchAccess } from '../services/branchScope.js';
import { appendAudit } from '../services/audit.js';
import { validateItemDefs, validateResults } from '../domain/checklist.js';

const isAssignee = (jo: { executionOwnerId: string | null; assignedTechnicianIds: string[] }, uid: string) =>
  jo.executionOwnerId === uid || jo.assignedTechnicianIds.includes(uid);

export function checklistRoutes(app: FastifyInstance, prisma: PrismaClient): void {
  const authed = { preHandler: [app.authenticate, app.requireMfaEnrolled] };

  // ---- Templates (admin-authored; OPS_SUPERVISOR/SYSTEM_ADMIN via RBAC — reuse material:write
  // scope for now pending a dedicated 'checklistTemplate:write' action if TL wants one) ----
  app.post('/api/v1/checklist-templates', { preHandler: [app.authenticate, app.requireMfaEnrolled, app.requireAction('material:write')] }, async (req, reply) => {
    const b = (req.body ?? {}) as any;
    if (!b.name) throw new AppError('VALIDATION_ERROR', 'name required');
    const items = validateItemDefs(b.items);
    const tpl = await prisma.$transaction(async (tx) => {
      const t = await tx.checklistTemplate.create({ data: { name: b.name, serviceCategory: b.serviceCategory ?? null, jobType: b.jobType ?? null, items } });
      await appendAudit(tx, req.ctx, { entityType: 'ChecklistTemplate', entityId: t.id, action: 'CREATE' });
      return t;
    });
    return reply.status(201).send(tpl);
  });

  app.get('/api/v1/checklist-templates', authed, async () =>
    prisma.checklistTemplate.findMany({ where: { active: true }, orderBy: { name: 'asc' } }));

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
        data: { results: validated, completedById: req.ctx.userId, completedAt: new Date(), version: { increment: 1 } },
      });
      if (res.count === 0) throw new AppError('VERSION_CONFLICT');
      await appendAudit(tx, req.ctx, { entityType: 'ChecklistInstance', entityId: id, action: 'SUBMIT' });
      return tx.checklistInstance.findUnique({ where: { id } });
    });
    return reply.send(out);
  });
}
