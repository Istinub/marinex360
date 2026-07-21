// Two-phase binary upload (ADR-6, Mobile R-3). Client PUTs bytes straight to S3/MinIO via a
// presigned URL, then the metadata op carries the returned s3Key. Keeps /sync/batch JSON-only and
// avoids proxying large photo/signature bytes through Fastify.
import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { AppError } from '../lib/errors.js';
import { assertBranchAccess } from '../services/branchScope.js';

// Storage adapter is injected (packages/storage — the config seam). Signature kept minimal.
export interface PresignPut { (args: { key: string; contentType: string }): Promise<{ uploadUrl: string; headers?: Record<string, string> }>; }

export function uploadRoutes(app: FastifyInstance, prisma: PrismaClient, presignPut: PresignPut): void {
  app.post('/api/v1/uploads/presign', { preHandler: [app.authenticate, app.requireMfaEnrolled] }, async (req, reply) => {
    const { entity, jobOrderId, contentType, byteSize } = (req.body ?? {}) as any;
    if (!['Photo', 'ESignature'].includes(entity)) throw new AppError('VALIDATION_ERROR', "entity must be 'Photo' or 'ESignature'");
    if (!jobOrderId || !contentType) throw new AppError('VALIDATION_ERROR', 'jobOrderId and contentType required');
    if (byteSize != null && byteSize > 25 * 1024 * 1024) throw new AppError('VALIDATION_ERROR', 'file exceeds 25MB');
    const jo = await prisma.jobOrder.findFirst({ where: { id: jobOrderId, deletedAt: null } });
    if (!jo) throw new AppError('NOT_FOUND');
    assertBranchAccess(req.ctx, jo.branch);
    const s3Key = `${jo.branch}/${jobOrderId}/${entity.toLowerCase()}/${randomUUID()}`;
    const { uploadUrl, headers } = await presignPut({ key: s3Key, contentType });
    return reply.send({ uploadUrl, s3Key, method: 'PUT', headers: headers ?? { 'Content-Type': contentType } });
  });
}
