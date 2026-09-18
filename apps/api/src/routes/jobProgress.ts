// Public "client progress link" (P?-?): Ops/Director/Admin generate a per-job shareToken; anyone
// holding the resulting URL can view a read-only status/commercial summary, no login required.
import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import { AppError } from '../lib/errors.js';
import { assertBranchAccess } from '../services/branchScope.js';
import { appendAudit } from '../services/audit.js';
import { newShareToken, getPublicJobProgress } from '../services/jobProgress.js';
import { createPublicJobProgressRateLimiter } from '../services/publicJobProgressRateLimit.js';

const webAppUrl = () => (process.env.WEB_APP_URL ?? 'http://localhost:5173').replace(/\/+$/, '');

export function jobProgressRoutes(app: FastifyInstance, prisma: PrismaClient): void {
  const publicJobProgressRateLimiter = createPublicJobProgressRateLimiter();
  app.addHook('onClose', async () => {
    await publicJobProgressRateLimiter.close();
  });

  app.post('/api/v1/job-orders/:id/share-link', { preHandler: [app.authenticate, app.requireMfaEnrolled, app.requireAction('jobOrder:share')] }, async (req) => {
    const { id } = req.params as any;
    const jo = await prisma.jobOrder.findFirst({ where: { id, deletedAt: null, archivedAt: null, purgedAt: null } });
    if (!jo) throw new AppError('NOT_FOUND');
    assertBranchAccess(req.ctx, jo.branch);

    const token = newShareToken();
    await prisma.$transaction(async (tx) => {
      await tx.jobOrder.update({ where: { id: jo.id }, data: { shareToken: token } });
      await appendAudit(tx, req.ctx, { entityType: 'JobOrder', entityId: jo.id, action: 'SHARE_LINK_REGENERATE' });
    });

    return { url: `${webAppUrl()}/track/${token}` };
  });

  app.get('/api/v1/public/job-progress/:token', { preHandler: [publicJobProgressRateLimiter.preHandler] }, async (req) => {
    const { token } = req.params as any;
    return getPublicJobProgress(prisma, token);
  });
}
