// Pure sync-apply decision logic (D-002/SYNC-13 flag resolution, CC-9 labourRate snapshot,
// change-sequence cursor parsing). Kept separate from routes/sync.ts so it's unit-testable
// without a DB.
import type { Money } from '../lib/money.js';
import { DEFAULT_LABOUR_RATE } from '../lib/money.js';

export type WritableEntity = 'WorkLog' | 'Photo' | 'Observation' | 'ChecklistInstance' | 'MaterialLine' | 'ESignature';
export const WRITABLE_ENTITIES: ReadonlySet<WritableEntity> =
  new Set(['WorkLog', 'Photo', 'Observation', 'ChecklistInstance', 'MaterialLine', 'ESignature']);

export interface DispatchInput {
  assignedTechnicianIds: string[];
  executionOwnerId: string | null;
}

/**
 * D-002/SYNC-13: is the caller CURRENTLY dispatched to this JO? If not, the op is still
 * accepted and applied — just flagged for supervisor review (reviewState=PENDING_SUPERVISOR_REVIEW),
 * never rejected and never silently APPLIED as if nothing happened.
 */
export function isDispatched(jo: DispatchInput, userId: string): boolean {
  return jo.assignedTechnicianIds.includes(userId) || jo.executionOwnerId === userId;
}

export function resolveReviewState(jo: DispatchInput, userId: string): { flagged: boolean; reviewState: string | null } {
  const flagged = !isDispatched(jo, userId);
  return { flagged, reviewState: flagged ? 'PENDING_SUPERVISOR_REVIEW' : null };
}

/** CC-9: snapshot the JO's labourRate onto a new WorkLog at CREATE time. Never re-resolved later. */
export function snapshotLabourRate(jo: { labourRateAmountMinor: number | null; labourRateCurrency: string | null }): Money {
  if (jo.labourRateAmountMinor != null && jo.labourRateCurrency) {
    return { amountMinor: jo.labourRateAmountMinor, currency: jo.labourRateCurrency };
  }
  return DEFAULT_LABOUR_RATE; // D-004 default SGD 90.00/hr
}

/**
 * D-012 (closed): monotonic changeSeq cursor. A DB-autoincrement bigint makes the old
 * same-millisecond tie problem structurally impossible -- every INSERT gets a strictly
 * distinct value regardless of wall-clock resolution, unlike `updatedAt`.
 */
export function parseChangeSeqCursor(since: unknown): bigint {
  if (since == null || since === '') return 0n;
  try {
    const n = BigInt(since as any);
    return n >= 0n ? n : 0n;
  } catch {
    return 0n;
  }
}
