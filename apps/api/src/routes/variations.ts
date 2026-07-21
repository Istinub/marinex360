// Variation routes (D-003) — EVERY variation routes to a Director; no threshold. PROPOSED on
// create; approve/reject are Director-only (enforced by the RBAC matrix: only DIRECTOR/ADMIN
// hold variation:approve|reject). CC-02: approved variations feed the invoice alongside baseline.
import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import { AppError } from '../lib/errors.js';
import { assertBranchAccess } from '../services/branchScope.js';
import { appendAudit } from '../services/audit.js';

export function variationRoutes(app: FastifyInstance, prisma: PrismaClient): void {
  app.post('/api/v1/job-orders/:id/variations', { preHandler: [app.authenticate, app.requireMfaEnrolled, app.requireAction('variation:create')] }, async (req, reply) => {
    const { id } = req.params as any;
    const { reason, amountMinor, amountCurrency } = (req.body ?? {}) as any;
    if (!reason || amountMinor == null || !amountCurrency) throw new AppError('VALIDATION_ERROR', 'reason and amount required');
    if (!Number.isInteger(amountMinor)) throw new AppError('VALIDATION_ERROR', 'amountMinor must be integer minor units');
    const v = await prisma.$transaction(async (tx) => {
      const jo = await tx.jobOrder.findFirst({ where: { id, deletedAt: null } });
      if (!jo) throw new AppError('NOT_FOUND');
      assertBranchAccess(req.ctx, jo.branch);
      const variation = await tx.variation.create({ data: { jobOrderId: id, reason, amountMinor, amountCurrency, status: 'PROPOSED' } });
      await appendAudit(tx, req.ctx, { entityType: 'Variation', entityId: variation.id, action: 'CREATE', diff: { jobOrderId: id, amountMinor, amountCurrency } });
      return variation;
    });
    return reply.status(201).send(v);
  });

  const resolve = (status: 'APPROVED' | 'REJECTED', action: 'variation:approve' | 'variation:reject') =>
    async (req: any, reply: any) => {
      const { id } = req.params;
      const { version, reason } = req.body ?? {};
      if (typeof version !== 'number') throw new AppError('VALIDATION_ERROR', 'version required');
      const out = await prisma.$transaction(async (tx) => {
        const variation = await tx.variation.findUnique({ where: { id }, include: { jobOrder: true } });
        if (!variation) throw new AppError('NOT_FOUND');
        assertBranchAccess(req.ctx, variation.jobOrder.branch);
        if (variation.status !== 'PROPOSED') throw new AppError('VALIDATION_ERROR', `variation already ${variation.status}`);
        const res = await tx.variation.updateMany({ where: { id, version }, data: { status, approverId: req.ctx.userId, version: { increment: 1 } } });
        if (res.count === 0) throw new AppError('VERSION_CONFLICT');
        await appendAudit(tx, req.ctx, { entityType: 'Variation', entityId: id, action: status === 'APPROVED' ? 'APPROVE' : 'REJECT', diff: { reason: reason ?? null } });
        return tx.variation.findUnique({ where: { id } });
      });
      return reply.send(out);
    };

  app.post('/api/v1/variations/:id/approve', { preHandler: [app.authenticate, app.requireMfaEnrolled, app.requireAction('variation:approve')] }, resolve('APPROVED', 'variation:approve'));
  app.post('/api/v1/variations/:id/reject', { preHandler: [app.authenticate, app.requireMfaEnrolled, app.requireAction('variation:reject')] }, resolve('REJECTED', 'variation:reject'));
}
