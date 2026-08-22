// Branch scoping at the SERVICE LAYER (RBAC-SCOPE-1). Contract v1.1 resolutions:
//  - scope is checked BEFORE the version check (no version oracle leaks cross-branch state, CC-05).
//  - cross-branch direct-ID access returns NOT_FOUND, never enumerates existence (RBAC-SCOPE-2/ADR-7).
//  - BRANCH_SCOPE_DENIED is reserved for EXPLICIT cross-branch operations a role may not perform.
import { AppError } from '../lib/errors.js';
import { isCrossBranch } from '../domain/rbac.js';
import type { RequestContext } from './context.js';
import type { PrismaClient } from '@prisma/client';

/** For a direct-ID read/write of a row whose branch is `rowBranch`. */
export function assertBranchAccess(ctx: RequestContext, rowBranch: string): void {
  if (rowBranch === ctx.branch) return;
  if (isCrossBranch(ctx.roles)) return;           // Director/Admin may reach across (RBAC-CROSS-1)
  throw new AppError('NOT_FOUND');                 // never reveal that the row exists in another branch
}

/** WHERE fragment for LIST queries. Branch is derived from the token, not the client. */
export function scopeWhere(ctx: RequestContext): Record<string, unknown> {
  return isCrossBranch(ctx.roles) ? {} : { branch: ctx.branch };
}

/** The branch a newly created row MUST carry (never client-supplied). */
export const branchForCreate = (ctx: RequestContext) => ctx.branch;

export type BranchScopedOwnerType = 'CLIENT' | 'VESSEL' | 'JOB' | 'TECHNICIAN';

export async function resolveOwnerBranch(
  prisma: PrismaClient,
  ownerType: BranchScopedOwnerType,
  ownerId: string,
): Promise<string | null> {
  if (ownerType === 'CLIENT') {
    const client = await prisma.client.findFirst({ where: { id: ownerId, deletedAt: null }, select: { branch: true } });
    return client?.branch ?? null;
  }
  if (ownerType === 'VESSEL') {
    const vessel = await prisma.vessel.findFirst({
      where: { id: ownerId, deletedAt: null },
      select: { client: { select: { branch: true, deletedAt: true } } },
    });
    return vessel?.client.deletedAt == null ? vessel?.client.branch ?? null : null;
  }
  if (ownerType === 'JOB') {
    const jo = await prisma.jobOrder.findFirst({ where: { id: ownerId, deletedAt: null }, select: { branch: true } });
    return jo?.branch ?? null;
  }

  const user = await prisma.user.findFirst({ where: { id: ownerId, active: true }, select: { branch: true } });
  return user?.branch ?? null;
}
