// Offline-write idempotency registry (OD-04 / SYNC-02). Keyed on opId (ProcessedOp.opId PK).
// Online REST creates DON'T use this (server issues the id, CONV-ID-1). It is the /sync/batch path's
// replay guard: a repeated opId returns the ORIGINAL result (IDEMPOTENT_REPLAY), no second row.
// resultRef == the created row id (== client-supplied id for offline creates, CC-MOB-1).
import type { Prisma } from '@prisma/client';

export type OpApplyStatus = 'APPLIED' | 'APPLIED_FLAGGED';

export async function findProcessedOp(tx: Prisma.TransactionClient, opId: string) {
  return tx.processedOp.findUnique({ where: { opId } });
}

export async function recordProcessedOp(
  tx: Prisma.TransactionClient,
  p: { opId: string; entity: string; action: string; resultRef?: string; status: OpApplyStatus },
): Promise<void> {
  await tx.processedOp.create({ data: p });
}
