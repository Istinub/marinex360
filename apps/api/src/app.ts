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
import { certificateRoutes } from './routes/certificates.js';
import { syncRoutes } from './routes/sync.js';
import { jobRequestRoutes } from './routes/jobRequests.js';

export interface AppDeps { prisma: PrismaClient; accessSecret: string; presignPut: PresignPut; }

function serializeChangeSeq(payload: unknown, expose: boolean): unknown {
  if (Array.isArray(payload)) return payload.map((item) => serializeChangeSeq(item, expose));
  if (payload == null || typeof payload !== 'object' || payload instanceof Date) return payload;

  return Object.fromEntries(Object.entries(payload).flatMap(([key, value]) => {
    if (key === 'changeSeq') return expose ? [[key, typeof value === 'bigint' ? value.toString() : value]] : [];
    return [[key, serializeChangeSeq(value, expose)]];
  }));
}

export function buildApp(deps: AppDeps): FastifyInstance {
  const app = Fastify({ logger: true });
  registerErrorHandler(app);
  registerAuthn(app, { accessSecret: deps.accessSecret });

  // changeSeq is an internal sync cursor field. JSON has no bigint representation, so expose it
  // only on the sync delta endpoint as a decimal string and keep every existing REST DTO stable.
  app.addHook('preSerialization', async (req, _reply, payload) =>
    serializeChangeSeq(payload, req.routeOptions.url === '/api/v1/sync/assigned'));

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
  certificateRoutes(app, deps.prisma);
  syncRoutes(app, deps.prisma);
  jobRequestRoutes(app, deps.prisma);

  return app;
}
