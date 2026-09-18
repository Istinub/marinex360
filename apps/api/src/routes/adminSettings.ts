import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import { AppError } from '../lib/errors.js';
import { appendAudit } from '../services/audit.js';

export function adminSettingsRoutes(app: FastifyInstance, prisma: PrismaClient): void {
  const w = { preHandler: [app.authenticate, app.requireMfaEnrolled, app.requireAction('admin:devTools')] };

  app.get('/api/v1/admin/settings/flags', w, async () => {
    return prisma.featureFlag.findMany({ orderBy: { key: 'asc' } });
  });

  app.patch('/api/v1/admin/settings/flags/:key', w, async (req) => {
    const { key } = req.params as any;
    const { enabled } = (req.body ?? {}) as any;
    if (typeof enabled !== 'boolean') throw new AppError('VALIDATION_ERROR', 'enabled (boolean) required');
    const before = await prisma.featureFlag.findUnique({ where: { key } });
    if (!before) throw new AppError('NOT_FOUND');
    const updated = await prisma.featureFlag.update({ where: { key }, data: { enabled, updatedBy: req.ctx.userId } });
    await appendAudit(prisma as any, req.ctx, { entityType: 'FeatureFlag', entityId: key, action: 'UPDATE', diff: { from: before.enabled, to: enabled } });
    return updated;
  });
}
