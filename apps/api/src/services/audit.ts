// Immutable audit log (P1-10, AUDIT-1/2/3, NFR-06). Written SYNCHRONOUSLY in the SAME transaction
// as the mutation — never via a queue — so an audit row can never be lost relative to its change.
// AuditEntry + JobStatusHistory are append-only and DB-immutable (Part-A migration REVOKEs
// UPDATE/DELETE from the app role).
import type { Prisma } from '@prisma/client';
import type { RequestContext } from './context.js';

export interface AuditInput {
  entityType: string;
  entityId: string;
  action: string;                 // CREATE | UPDATE | STATE_TRANSITION | ASSIGN | APPROVE | REJECT | ...
  diff?: Prisma.InputJsonValue;   // for side transitions this carries the mandatory `reason` (see JOSM note)
}

export async function appendAudit(tx: Prisma.TransactionClient, ctx: RequestContext, e: AuditInput): Promise<void> {
  await tx.auditEntry.create({
    data: { entityType: e.entityType, entityId: e.entityId, action: e.action, actorId: ctx.userId, diff: e.diff },
  });
}

/**
 * Run `work` and its audit row in ONE transaction. `work` returns the entityId + optional diff.
 * Usage keeps every mutating endpoint's audit guaranteed and colocated (AUDIT-2 reconciliation).
 */
export async function withAudit<T extends { entityId: string; diff?: Prisma.InputJsonValue }>(
  prisma: Prisma.TransactionClient extends never ? never : any,
  ctx: RequestContext,
  meta: { entityType: string; action: string },
  work: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const result = await work(tx);
    await appendAudit(tx, ctx, { entityType: meta.entityType, entityId: result.entityId, action: meta.action, diff: result.diff });
    return result;
  });
}
