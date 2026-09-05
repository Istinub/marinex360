import type { PrismaClient } from '@prisma/client';
import { AppError } from '../lib/errors.js';
import { appendAudit } from './audit.js';
import { branchForCreate, assertBranchAccess } from './branchScope.js';
import { DEFAULT_LABOUR_RATE } from '../lib/money.js';
import { nextJoNumber } from './numbering.js';

export interface PublicJobRequestInput {
  guestName: string;
  guestEmail: string;
  guestCompany?: string;
  vesselDescription: string;
  scopeSummary: string;
  requestedDate?: string;
  branch: string;
}

export interface AuthenticatedJobRequestInput {
  vesselDescription: string;
  scopeSummary: string;
  requestedDate?: string;
  clientId?: string;
}

function requestedDateValue(value?: string): Date | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new AppError('VALIDATION_ERROR', 'requestedDate must be a valid date');
  return date;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw new AppError('VALIDATION_ERROR', `${field} required`);
  return value.trim();
}

export async function createPublicJobRequest(prisma: PrismaClient, input: PublicJobRequestInput) {
  const guestName = requiredString(input.guestName, 'guestName');
  const guestEmail = requiredString(input.guestEmail, 'guestEmail');
  const vesselDescription = requiredString(input.vesselDescription, 'vesselDescription');
  const scopeSummary = requiredString(input.scopeSummary, 'scopeSummary');
  const branch = requiredString(input.branch, 'branch');
  const request = await prisma.jobRequest.create({
    data: {
      guestName,
      guestEmail,
      guestCompany: input.guestCompany?.trim() || null,
      vesselDescription,
      scopeSummary,
      requestedDate: requestedDateValue(input.requestedDate),
      branch,
      status: 'PENDING',
    },
    select: { id: true, status: true, branch: true, createdAt: true },
  });
  return request;
}

export async function createAuthenticatedJobRequest(
  prisma: PrismaClient,
  ctx: { userId: string; roles: string[]; branch: string },
  input: AuthenticatedJobRequestInput,
) {
  const vesselDescription = requiredString(input.vesselDescription, 'vesselDescription');
  const scopeSummary = requiredString(input.scopeSummary, 'scopeSummary');
  const isClient = ctx.roles.includes('CLIENT');
  const user = await prisma.user.findUnique({ where: { id: ctx.userId }, select: { clientId: true } });
  const clientId = isClient ? user?.clientId : input.clientId;
  if (isClient && !clientId) throw new AppError('FORBIDDEN', 'client account is not linked to a company');
  if (clientId) {
    const client = await prisma.client.findFirst({ where: { id: clientId, deletedAt: null } });
    if (!client) throw new AppError('NOT_FOUND');
    if (isClient && !clientId) throw new AppError('NOT_FOUND');
    assertBranchAccess(ctx as any, client.branch);
  }
  return prisma.jobRequest.create({
    data: {
      clientId: clientId ?? null,
      vesselDescription,
      scopeSummary,
      requestedDate: requestedDateValue(input.requestedDate),
      branch: clientId ? (await prisma.client.findUniqueOrThrow({ where: { id: clientId }, select: { branch: true } })).branch : branchForCreate(ctx as any),
      status: 'PENDING',
    },
  });
}

function guestClientName(request: { guestCompany: string | null; guestName: string | null }): string {
  return request.guestCompany?.trim() || request.guestName?.trim() || 'Guest client';
}

function guestVesselName(request: { vesselDescription: string }): string {
  return request.vesselDescription.trim().slice(0, 120) || 'Requested vessel';
}

export async function convertJobRequest(prisma: PrismaClient, ctx: { userId: string; roles: string[]; branch: string }, id: string, body: { clientId?: string; vesselId?: string; quotedAmountMinor?: number; quotedCurrency?: string }) {
  return prisma.$transaction(async (tx) => {
    const request = await tx.jobRequest.findUnique({ where: { id } });
    if (!request) throw new AppError('NOT_FOUND');
    assertBranchAccess(ctx as any, request.branch);
    if (request.status !== 'PENDING') throw new AppError('STATE_TRANSITION_INVALID', 'job request is no longer pending');
    let clientId = request.clientId ?? body.clientId;
    let client = clientId ? await tx.client.findFirst({ where: { id: clientId, deletedAt: null } }) : null;
    if (!client && request.clientId) throw new AppError('NOT_FOUND');
    if (!client && body.clientId) throw new AppError('NOT_FOUND');
    if (!client) {
      const name = guestClientName(request);
      client = await tx.client.findFirst({ where: { branch: request.branch, name, deletedAt: null } });
      if (!client) {
        const contact = await tx.contact.create({ data: { name: request.guestName ?? name, email: request.guestEmail ?? null } });
        client = await tx.client.create({
          data: {
            branch: request.branch,
            name,
            primaryContactId: contact.id,
          },
        });
      }
      clientId = client.id;
    }
    assertBranchAccess(ctx as any, client.branch);
    const resolvedClientId = client.id;
    const shouldCreateGuestVessel = !request.clientId && !body.clientId && !body.vesselId;
    let vessel = shouldCreateGuestVessel
      ? null
      : body.vesselId
      ? await tx.vessel.findFirst({ where: { id: body.vesselId, clientId: resolvedClientId, deletedAt: null } })
      : await tx.vessel.findFirst({ where: { clientId: resolvedClientId, deletedAt: null }, orderBy: { name: 'asc' } });
    if (!vessel && body.vesselId) throw new AppError('VALIDATION_ERROR', 'vesselId required and must belong to client');
    if (!vessel) {
      vessel = await tx.vessel.create({
        data: {
          clientId: resolvedClientId,
          imoNumber: `REQ-${request.id.slice(0, 32)}`,
          name: guestVesselName(request),
        },
      });
    }
    const jo = await tx.jobOrder.create({
      data: {
        joNumber: await nextJoNumber(tx, client.branch),
        branch: client.branch,
        clientId: resolvedClientId,
        vesselId: vessel.id,
        serviceCategories: [],
        scopeSummary: request.scopeSummary,
        origin: 'MANUAL',
        quotedAmountMinor: body.quotedAmountMinor ?? 0,
        quotedCurrency: body.quotedCurrency ?? 'SGD',
        labourRateAmountMinor: DEFAULT_LABOUR_RATE.amountMinor,
        labourRateCurrency: DEFAULT_LABOUR_RATE.currency,
        state: 'DRAFT',
        createdBy: ctx.userId,
      },
    });
    await tx.jobRequest.update({ where: { id }, data: { status: 'CONVERTED', convertedJobOrderId: jo.id } });
    await appendAudit(tx, ctx as any, { entityType: 'JobRequest', entityId: id, action: 'CONVERT', diff: { convertedJobOrderId: jo.id } });
    return jo;
  });
}

export async function declineJobRequest(prisma: PrismaClient, ctx: { userId: string; roles: string[]; branch: string }, id: string, reason: string) {
  const declineReason = requiredString(reason, 'declineReason');
  const request = await prisma.jobRequest.findUnique({ where: { id } });
  if (!request) throw new AppError('NOT_FOUND');
  assertBranchAccess(ctx as any, request.branch);
  if (request.status !== 'PENDING') throw new AppError('STATE_TRANSITION_INVALID', 'job request is no longer pending');
  const updated = await prisma.jobRequest.update({ where: { id }, data: { status: 'DECLINED', declineReason } });
  await appendAudit(prisma as any, ctx as any, { entityType: 'JobRequest', entityId: id, action: 'DECLINE', diff: { declineReason } });
  return updated;
}
