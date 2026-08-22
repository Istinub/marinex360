import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { AppError } from '../lib/errors.js';
import { assertBranchAccess, resolveOwnerBranch, type BranchScopedOwnerType } from '../services/branchScope.js';
import type { RequestContext } from '../services/context.js';
import type { PresignPut } from './uploads.js';

const DOCUMENT_OWNER_TYPES = ['CLIENT', 'VESSEL', 'JOB'] as const;
type DocumentOwnerType = (typeof DOCUMENT_OWNER_TYPES)[number];

function requireString(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw new AppError('VALIDATION_ERROR', `${name} required`);
  return value;
}

function parseDocumentOwner(ownerType: unknown): DocumentOwnerType {
  if (!DOCUMENT_OWNER_TYPES.includes(ownerType as DocumentOwnerType)) {
    throw new AppError('VALIDATION_ERROR', "ownerType must be 'CLIENT', 'VESSEL', or 'JOB'");
  }
  return ownerType as DocumentOwnerType;
}

async function assertOwnerAccess(prisma: PrismaClient, ctx: RequestContext, ownerType: BranchScopedOwnerType, ownerId: string): Promise<string> {
  const branch = await resolveOwnerBranch(prisma, ownerType, ownerId);
  if (!branch) throw new AppError('NOT_FOUND');
  assertBranchAccess(ctx, branch);
  return branch;
}

export function documentRoutes(app: FastifyInstance, prisma: PrismaClient, presignPut: PresignPut): void {
  app.post('/api/v1/documents/presign', { preHandler: [app.authenticate, app.requireMfaEnrolled, app.requireAction('document:write')] }, async (req, reply) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const ownerType = parseDocumentOwner(body.ownerType);
    const ownerId = requireString(body.ownerId, 'ownerId');
    const filename = requireString(body.filename, 'filename');
    const mimeType = requireString(body.mimeType, 'mimeType');
    const byteSize = body.byteSize;
    if (byteSize != null && Number(byteSize) > 25 * 1024 * 1024) throw new AppError('VALIDATION_ERROR', 'file exceeds 25MB');

    const branch = await assertOwnerAccess(prisma, req.ctx, ownerType, ownerId);
    const s3Key = `${branch}/documents/${ownerType.toLowerCase()}/${ownerId}/${randomUUID()}/${filename}`;
    const { uploadUrl, headers } = await presignPut({ key: s3Key, contentType: mimeType });
    return reply.send({ uploadUrl, s3Key, method: 'PUT', headers: headers ?? { 'Content-Type': mimeType } });
  });

  app.post('/api/v1/documents', { preHandler: [app.authenticate, app.requireMfaEnrolled, app.requireAction('document:write')] }, async (req, reply) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const ownerType = parseDocumentOwner(body.ownerType);
    const ownerId = requireString(body.ownerId, 'ownerId');
    const filename = requireString(body.filename, 'filename');
    const mimeType = requireString(body.mimeType, 'mimeType');
    const s3Key = requireString(body.s3Key, 's3Key');
    await assertOwnerAccess(prisma, req.ctx, ownerType, ownerId);

    const document = await prisma.document.create({
      data: { ownerType, ownerId, filename, mimeType, s3Key, uploadedById: req.ctx.userId },
    });
    return reply.code(201).send(document);
  });

  app.get('/api/v1/documents', { preHandler: [app.authenticate, app.requireMfaEnrolled, app.requireAction('document:read')] }, async (req) => {
    const query = (req.query ?? {}) as Record<string, unknown>;
    const ownerType = parseDocumentOwner(query.ownerType);
    const ownerId = requireString(query.ownerId, 'ownerId');
    await assertOwnerAccess(prisma, req.ctx, ownerType, ownerId);
    return prisma.document.findMany({ where: { ownerType, ownerId, deletedAt: null }, orderBy: { createdAt: 'desc' } });
  });

  app.delete('/api/v1/documents/:id', { preHandler: [app.authenticate, app.requireMfaEnrolled, app.requireAction('document:write')] }, async (req) => {
    const { id } = req.params as { id: string };
    const document = await prisma.document.findFirst({ where: { id, deletedAt: null } });
    if (!document) throw new AppError('NOT_FOUND');
    await assertOwnerAccess(prisma, req.ctx, parseDocumentOwner(document.ownerType), document.ownerId);
    await prisma.document.update({ where: { id }, data: { deletedAt: new Date() } });
    return { id, deleted: true };
  });

  app.post('/api/v1/documents/:id/replace', { preHandler: [app.authenticate, app.requireMfaEnrolled, app.requireAction('document:write')] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = (req.body ?? {}) as Record<string, unknown>;
    const filename = requireString(body.filename, 'filename');
    const mimeType = requireString(body.mimeType, 'mimeType');
    const s3Key = requireString(body.s3Key, 's3Key');
    const existing = await prisma.document.findFirst({ where: { id, deletedAt: null } });
    if (!existing) throw new AppError('NOT_FOUND');
    await assertOwnerAccess(prisma, req.ctx, parseDocumentOwner(existing.ownerType), existing.ownerId);

    const replacement = await prisma.$transaction(async (tx) => {
      await tx.document.update({ where: { id }, data: { deletedAt: new Date() } });
      return tx.document.create({
        data: {
          ownerType: existing.ownerType,
          ownerId: existing.ownerId,
          filename,
          mimeType,
          s3Key,
          uploadedById: req.ctx.userId,
        },
      });
    });
    return reply.code(201).send(replacement);
  });
}
