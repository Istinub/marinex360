import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import { createAuthenticatedJobRequest, createPublicJobRequest, convertJobRequest, declineJobRequest } from '../services/jobRequests.js';
import { scopeWhere } from '../services/branchScope.js';
import { createPublicJobRequestRateLimiter } from '../services/publicJobRequestRateLimit.js';
import { AppError } from '../lib/errors.js';

export function jobRequestRoutes(app: FastifyInstance, prisma: PrismaClient): void {
  const publicJobRequestRateLimiter = createPublicJobRequestRateLimiter();
  app.addHook('onClose', async () => {
    await publicJobRequestRateLimiter.close();
  });

  app.post('/api/v1/job-requests/public', { preHandler: [publicJobRequestRateLimiter.preHandler] }, async (req, reply) => {
    const request = await createPublicJobRequest(prisma, (req.body ?? {}) as any);
    return reply.status(201).send(request);
  });

  app.post('/api/v1/job-requests', { preHandler: [app.authenticate, app.requireMfaEnrolled, app.requireAction('jobRequest:create')] }, async (req, reply) => {
    const request = await createAuthenticatedJobRequest(prisma, req.ctx, (req.body ?? {}) as any);
    return reply.status(201).send(request);
  });

  app.get('/api/v1/job-requests', { preHandler: [app.authenticate, app.requireMfaEnrolled, app.requireAction('jobRequest:read')] }, async (req) => {
    return prisma.jobRequest.findMany({
      where: { ...scopeWhere(req.ctx), status: 'PENDING' },
      include: { client: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'asc' },
    });
  });

  app.get('/api/v1/job-requests/:id', { preHandler: [app.authenticate, app.requireMfaEnrolled, app.requireAction('jobRequest:read')] }, async (req) => {
    const { id } = req.params as any;
    const request = await prisma.jobRequest.findFirst({
      where: { id, ...scopeWhere(req.ctx) },
      include: { client: { select: { id: true, name: true } } },
    });
    if (!request) {
      throw new AppError('NOT_FOUND');
    }
    return request;
  });

  app.post('/api/v1/job-requests/:id/convert', { preHandler: [app.authenticate, app.requireMfaEnrolled, app.requireAction('jobRequest:convert')] }, async (req) => {
    const { id } = req.params as any;
    return convertJobRequest(prisma, req.ctx, id, (req.body ?? {}) as any);
  });

  app.post('/api/v1/job-requests/:id/decline', { preHandler: [app.authenticate, app.requireMfaEnrolled, app.requireAction('jobRequest:decline')] }, async (req) => {
    const { id } = req.params as any;
    const { declineReason } = (req.body ?? {}) as any;
    return declineJobRequest(prisma, req.ctx, id, declineReason);
  });
}
