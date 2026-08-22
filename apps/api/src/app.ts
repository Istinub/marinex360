// Fastify app assembly. Dependencies are injected so tests can pass a mock Prisma / presigner.
import Fastify, { type FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import { registerErrorHandler } from './plugins/errorHandler.js';
import { registerAuthn } from './plugins/authn.js';
import { authRoutes } from './routes/auth.js';
import { crmRoutes } from './routes/crm.js';
import { jobOrderRoutes } from './routes/jobOrders.js';
import { variationRoutes } from './routes/variations.js';
import { invoiceRoutes } from './routes/invoices.js';
import { reviewQueueRoutes } from './routes/reviewQueue.js';
import { checklistRoutes } from './routes/checklists.js';
import { uploadRoutes, type PresignPut } from './routes/uploads.js';
import { documentRoutes } from './routes/documents.js';
import { syncRoutes } from './routes/sync.js';

export interface AppDeps { prisma: PrismaClient; accessSecret: string; presignPut: PresignPut; }

export function buildApp(deps: AppDeps): FastifyInstance {
  const app = Fastify({ logger: true });
  registerErrorHandler(app);
  registerAuthn(app, { accessSecret: deps.accessSecret });

  // Contract with DevOps (apps/api Dockerfile HEALTHCHECK + Uptime Robot): keep this path/shape.
  app.get('/api/v1/health', async () => ({ status: 'ok', service: 'marinex360-api', time: new Date().toISOString() }));

  authRoutes(app, deps.prisma, deps.accessSecret);
  crmRoutes(app, deps.prisma);
  jobOrderRoutes(app, deps.prisma);
  variationRoutes(app, deps.prisma);
  invoiceRoutes(app, deps.prisma);
  reviewQueueRoutes(app, deps.prisma);
  checklistRoutes(app, deps.prisma);
  uploadRoutes(app, deps.prisma, deps.presignPut);
  documentRoutes(app, deps.prisma, deps.presignPut);
  syncRoutes(app, deps.prisma);

  return app;
}
