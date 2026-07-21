// Job Order routes (P1-5) — create / read (scoped + IDOR) / header PATCH (locked) / assign /
// JOSM transition. Everything goes through the service layer; audit + version + scope live here.
import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import { AppError } from '../lib/errors.js';
import { assertBranchAccess, scopeWhere, branchForCreate } from '../services/branchScope.js';
import { appendAudit } from '../services/audit.js';
import { nextJoNumber } from '../services/numbering.js';
import { DEFAULT_LABOUR_RATE } from '../lib/money.js';
import { assertTransition, isHeaderLocked, type JoState } from '../domain/josm.js';

const HEADER_FIELDS = ['scopeSummary', 'port', 'serviceCategories', 'plannedStartDate', 'externalQuoteRef', 'externalRfqRef'];
const isTech = (roles: string[]) => roles.includes('TECHNICIAN') && roles.length === 1;
const assignedToMe = (jo: any, uid: string) => jo.executionOwnerId === uid || (jo.assignedTechnicianIds ?? []).includes(uid);

export function jobOrderRoutes(app: FastifyInstance, prisma: PrismaClient): void {
  const authed = { preHandler: [app.authenticate, app.requireMfaEnrolled] };

  // CREATE (OD-02 frozen baseline; D-004 labour rate default; CONV-ID-1 server-issued id)
  app.post('/api/v1/job-orders', { preHandler: [app.authenticate, app.requireMfaEnrolled, app.requireAction('jobOrder:create')] }, async (req, reply) => {
    const b = (req.body ?? {}) as any;
    if (!b.clientId || !b.vesselId || !b.scopeSummary || b.quotedAmountMinor == null || !b.quotedCurrency) {
      throw new AppError('VALIDATION_ERROR', 'clientId, vesselId, scopeSummary, quotedAmount required');
    }
    const branch = branchForCreate(req.ctx); // never from client (RBAC-SPOOF-1)
    const created = await prisma.$transaction(async (tx) => {
      const joNumber = await nextJoNumber(tx, branch);
      const jo = await tx.jobOrder.create({
        data: {
          joNumber, branch, clientId: b.clientId, vesselId: b.vesselId,
          serviceCategories: b.serviceCategories ?? [], port: b.port ?? null, scopeSummary: b.scopeSummary,
          origin: 'MANUAL', externalQuoteRef: b.externalQuoteRef ?? null, externalRfqRef: b.externalRfqRef ?? null,
          quotedAmountMinor: b.quotedAmountMinor, quotedCurrency: b.quotedCurrency,
          labourRateAmountMinor: b.labourRateAmountMinor ?? DEFAULT_LABOUR_RATE.amountMinor,
          labourRateCurrency: b.labourRateCurrency ?? DEFAULT_LABOUR_RATE.currency,
          state: 'DRAFT', createdBy: req.ctx.userId,
        },
      });
      await appendAudit(tx, req.ctx, { entityType: 'JobOrder', entityId: jo.id, action: 'CREATE' });
      return jo;
    });
    return reply.status(201).send(created);
  });

  // LIST (RBAC-SCOPE-1 service-layer scoping; technicians see only assigned)
  app.get('/api/v1/job-orders', { preHandler: [app.authenticate, app.requireMfaEnrolled, app.requireAction('jobOrder:read')] }, async (req) => {
    const where: any = { ...scopeWhere(req.ctx), deletedAt: null };
    if (isTech(req.ctx.roles)) where.assignedTechnicianIds = { has: req.ctx.userId };
    return prisma.jobOrder.findMany({ where, orderBy: { createdAt: 'desc' } });
  });

  // GET by id (cross-branch -> NOT_FOUND; technician IDOR -> NOT_FOUND, RBAC-IDOR-1)
  app.get('/api/v1/job-orders/:id', { preHandler: [app.authenticate, app.requireMfaEnrolled, app.requireAction('jobOrder:read')] }, async (req) => {
    const { id } = req.params as any;
    const jo = await prisma.jobOrder.findFirst({ where: { id, deletedAt: null } });
    if (!jo) throw new AppError('NOT_FOUND');
    assertBranchAccess(req.ctx, jo.branch);                 // scope BEFORE anything else (CC-05)
    if (isTech(req.ctx.roles) && !assignedToMe(jo, req.ctx.userId)) throw new AppError('NOT_FOUND');
    return jo;
  });

  // PATCH header (CC-02/JOSM-6 header lock; scope changes go via Variation)
  app.patch('/api/v1/job-orders/:id', { preHandler: [app.authenticate, app.requireMfaEnrolled, app.requireAction('jobOrder:updateHeader')] }, async (req) => {
    const { id } = req.params as any;
    const b = (req.body ?? {}) as any;
    if (typeof b.version !== 'number') throw new AppError('VALIDATION_ERROR', 'version required');
    return prisma.$transaction(async (tx) => {
      const jo = await tx.jobOrder.findFirst({ where: { id, deletedAt: null } });
      if (!jo) throw new AppError('NOT_FOUND');
      assertBranchAccess(req.ctx, jo.branch);
      if (isHeaderLocked(jo.state as JoState)) throw new AppError('FORBIDDEN', 'header locked; scope changes require a Variation');
      const data: any = {};
      for (const f of HEADER_FIELDS) if (f in b) data[f] = b[f];
      const res = await tx.jobOrder.updateMany({ where: { id, version: b.version }, data: { ...data, version: { increment: 1 } } });
      if (res.count === 0) throw new AppError('VERSION_CONFLICT');
      await appendAudit(tx, req.ctx, { entityType: 'JobOrder', entityId: id, action: 'UPDATE', diff: data });
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
      const jo = await tx.jobOrder.findFirst({ where: { id, deletedAt: null } });
      if (!jo) throw new AppError('NOT_FOUND');
      assertBranchAccess(req.ctx, jo.branch);
      if (['IN_PROGRESS', 'PENDING_REVIEW', 'COMPLETED', 'INVOICED', 'CLOSED'].includes(jo.state)) {
        throw new AppError('FORBIDDEN', 'assignment locked once execution has begun');
      }
      const res = await tx.jobOrder.updateMany({ where: { id, version }, data: { assignedTechnicianIds: technicianIds, executionOwnerId, version: { increment: 1 } } });
      if (res.count === 0) throw new AppError('VERSION_CONFLICT');
      await appendAudit(tx, req.ctx, { entityType: 'JobOrder', entityId: id, action: 'ASSIGN', diff: { technicianIds, executionOwnerId } });
      return tx.jobOrder.findUnique({ where: { id } });
    });
  });

  // TRANSITION (JOSM). Gating (role/exec-owner/reason) is enforced by assertTransition.
  app.post('/api/v1/job-orders/:id/transition', authed, async (req) => {
    const { id } = req.params as any;
    const { to, reason, version } = (req.body ?? {}) as any;
    if (!to || typeof version !== 'number') throw new AppError('VALIDATION_ERROR', 'to and version required');
    return prisma.$transaction(async (tx) => {
      const jo = await tx.jobOrder.findFirst({ where: { id, deletedAt: null } });
      if (!jo) throw new AppError('NOT_FOUND');
      assertBranchAccess(req.ctx, jo.branch);               // scope before version (CC-05)
      const history = await tx.jobStatusHistory.findMany({ where: { jobOrderId: id }, orderBy: { at: 'asc' }, select: { fromState: true, toState: true } });
      const { to: target } = assertTransition({
        from: jo.state as JoState, to, actor: { userId: req.ctx.userId, roles: req.ctx.roles }, reason,
        executionOwnerId: jo.executionOwnerId, history,
      });
      const res = await tx.jobOrder.updateMany({ where: { id, version }, data: { state: target, version: { increment: 1 } } });
      if (res.count === 0) throw new AppError('VERSION_CONFLICT'); // CC-04 concurrent transition loser
      await tx.jobStatusHistory.create({ data: { jobOrderId: id, fromState: jo.state, toState: target, actorId: req.ctx.userId } });
      // JOSM-8: mandatory reason for side transitions is preserved in the immutable audit diff
      // (JobStatusHistory has no reason column in canonical v1.1 — see HANDOFF contract note).
      await appendAudit(tx, req.ctx, { entityType: 'JobOrder', entityId: id, action: 'STATE_TRANSITION', diff: { from: jo.state, to: target, reason: reason ?? null } });
      return tx.jobOrder.findUnique({ where: { id } });
    });
  });
}
