import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import { AppError } from '../lib/errors.js';
import { assertBranchAccess, resolveOwnerBranch, type BranchScopedOwnerType } from '../services/branchScope.js';
import type { RequestContext } from '../services/context.js';

const CERTIFICATE_OWNER_TYPES = ['TECHNICIAN', 'VESSEL', 'COMPANY'] as const;
type CertificateOwnerType = (typeof CERTIFICATE_OWNER_TYPES)[number];

function requireString(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw new AppError('VALIDATION_ERROR', `${name} required`);
  return value;
}

function optionalString(value: unknown, name: string): string | undefined {
  if (value == null) return undefined;
  if (typeof value !== 'string') throw new AppError('VALIDATION_ERROR', `${name} must be a string`);
  return value;
}

function optionalDate(value: unknown, name: string): Date | undefined {
  if (value == null) return undefined;
  const date = new Date(requireString(value, name));
  if (Number.isNaN(date.getTime())) throw new AppError('VALIDATION_ERROR', `${name} must be a valid date`);
  return date;
}

function requiredDate(value: unknown, name: string): Date {
  const date = new Date(requireString(value, name));
  if (Number.isNaN(date.getTime())) throw new AppError('VALIDATION_ERROR', `${name} must be a valid date`);
  return date;
}

function parseCertificateOwner(ownerType: unknown): CertificateOwnerType {
  if (!CERTIFICATE_OWNER_TYPES.includes(ownerType as CertificateOwnerType)) {
    throw new AppError('VALIDATION_ERROR', "ownerType must be 'TECHNICIAN', 'VESSEL', or 'COMPANY'");
  }
  return ownerType as CertificateOwnerType;
}

async function assertCertificateOwnerAccess(
  prisma: PrismaClient,
  ctx: RequestContext,
  ownerType: CertificateOwnerType,
  ownerId: string,
): Promise<void> {
  if (ownerType === 'COMPANY') return;
  const branch = await resolveOwnerBranch(prisma, ownerType as BranchScopedOwnerType, ownerId);
  if (!branch) throw new AppError('NOT_FOUND');
  assertBranchAccess(ctx, branch);
}

export function certificateRoutes(app: FastifyInstance, prisma: PrismaClient): void {
  app.post('/api/v1/certificates', { preHandler: [app.authenticate, app.requireMfaEnrolled, app.requireAction('certificate:write')] }, async (req, reply) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const ownerType = parseCertificateOwner(body.ownerType);
    const ownerId = requireString(body.ownerId, 'ownerId');
    await assertCertificateOwnerAccess(prisma, req.ctx, ownerType, ownerId);

    const certificate = await prisma.certificate.create({
      data: {
        ownerType,
        ownerId,
        certType: requireString(body.certType, 'certType'),
        identifier: optionalString(body.identifier, 'identifier'),
        issuedAt: optionalDate(body.issuedAt, 'issuedAt'),
        expiresAt: requiredDate(body.expiresAt, 'expiresAt'),
        s3Key: optionalString(body.s3Key, 's3Key'),
      },
    });
    return reply.code(201).send(certificate);
  });

  app.get('/api/v1/certificates', { preHandler: [app.authenticate, app.requireMfaEnrolled, app.requireAction('certificate:read')] }, async (req) => {
    const query = (req.query ?? {}) as Record<string, unknown>;
    const ownerType = parseCertificateOwner(query.ownerType);
    const ownerId = requireString(query.ownerId, 'ownerId');
    await assertCertificateOwnerAccess(prisma, req.ctx, ownerType, ownerId);

    return prisma.certificate.findMany({
      where: { ownerType, ownerId, deletedAt: null },
      orderBy: { expiresAt: 'asc' },
    });
  });

  app.delete('/api/v1/certificates/:id', { preHandler: [app.authenticate, app.requireMfaEnrolled, app.requireAction('certificate:write')] }, async (req) => {
    const { id } = req.params as { id: string };
    const certificate = await prisma.certificate.findFirst({ where: { id, deletedAt: null } });
    if (!certificate) throw new AppError('NOT_FOUND');
    const ownerType = parseCertificateOwner(certificate.ownerType);
    await assertCertificateOwnerAccess(prisma, req.ctx, ownerType, certificate.ownerId);
    await prisma.certificate.update({ where: { id }, data: { deletedAt: new Date() } });
    return { id, deleted: true };
  });
}
