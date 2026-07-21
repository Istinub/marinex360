// Supervisor review queue (SYNC-13 / D-002). Offline ops from an unassigned technician land with
// reviewState=PENDING_SUPERVISOR_REVIEW; a supervisor accepts/rejects. Endpoints built now so the
// shape is real even though rows only get flagged once offline sync lands (Phase 2).
import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import { AppError } from '../lib/errors.js';
import { scopeWhere, assertBranchAccess } from '../services/branchScope.js';
import { appendAudit } from '../services/audit.js';

// Only offline-writable execution entities carry reviewState.
const ENTITY = {
  worklog: 'workLog', photo: 'photo', observation: 'observation',
  checklist: 'checklistInstance', material: 'materialLine', esignature: 'eSignature',
} as const;
type EntityKey = keyof typeof ENTITY;

export function reviewQueueRoutes(app: FastifyInstance, prisma: PrismaClient): void {
  app.get('/api/v1/review-queue', { preHandler: [app.authenticate, app.requireMfaEnrolled, app.requireAction('review:read')] }, async (req) => {
    const state = ((req.query as any)?.state ?? 'PENDING_SUPERVISOR_REVIEW') as string;
    const joWhere = scopeWhere(req.ctx); // branch-scoped via the parent JO
    const out: Record<string, unknown[]> = {};
    for (const [key, delegate] of Object.entries(ENTITY)) {
      out[key] = await (prisma as any)[delegate].findMany({ where: { reviewState: state, jobOrder: joWhere }, take: 200 });
    }
    return out;
  });

  const resolve = (reviewState: 'ACCEPTED' | 'REJECTED') => async (req: any, reply: any) => {
    const { entity, id } = req.params as { entity: EntityKey; id: string };
    const delegate = ENTITY[entity];
    if (!delegate) throw new AppError('VALIDATION_ERROR', `unknown review entity ${entity}`);
    const out = await prisma.$transaction(async (tx) => {
      const row = await (tx as any)[delegate].findUnique({ where: { id }, include: { jobOrder: true } });
      if (!row) throw new AppError('NOT_FOUND');
      assertBranchAccess(req.ctx, row.jobOrder.branch);
      await (tx as any)[delegate].update({ where: { id }, data: { reviewState } });
      await appendAudit(tx, req.ctx, { entityType: delegate, entityId: id, action: `REVIEW_${reviewState}`, diff: { reason: req.body?.reason ?? null } });
      return { id, entity, reviewState };
    });
    return reply.send(out);
  };

  app.post('/api/v1/review/:entity/:id/accept', { preHandler: [app.authenticate, app.requireMfaEnrolled, app.requireAction('review:resolve')] }, resolve('ACCEPTED'));
  app.post('/api/v1/review/:entity/:id/reject', { preHandler: [app.authenticate, app.requireMfaEnrolled, app.requireAction('review:resolve')] }, resolve('REJECTED'));
}
