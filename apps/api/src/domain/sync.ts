// Pure sync-apply decision logic (D-002/SYNC-13 flag resolution, CC-9 labourRate snapshot,
// cursor parsing). Kept separate from routes/sync.ts so it's unit-testable without a DB.
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
 * Cursor for GET /sync/assigned?since=. STOPGAP: an ISO timestamp, not a monotonic sequence.
 * Known limitation (flagged in BE's original S0-7 readiness review, still unratified): two rows
 * updated within the same millisecond, or a row updated exactly AT the cursor boundary, can be
 * missed or double-delivered under concurrent writes. Acceptable for the S0-6 real-backend
 * milestone; a dedicated change-sequence table is the proposed real fix (see HANDOFF).
 */
export function parseCursor(since: unknown): Date {
  if (typeof since !== 'string' || !since) return new Date(0);
  const d = new Date(since);
  return Number.isNaN(d.getTime()) ? new Date(0) : d;
}
