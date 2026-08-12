// Invoice lifecycle logic (FR-42, D-034/CC-11). Kept DB-free and unit-testable.
import { AppError } from '../lib/errors.js';

const DEFAULT_DUE_DAYS = 30;

/**
 * Parse a free-text Client.creditTerms value (e.g. "NET30", "Net 45", "net-60") into a day
 * count. D-034: never block issuing on unparseable text — fall back to the 30-day default.
 */
export function parseCreditTermsDays(creditTerms: string | null | undefined): number {
  if (!creditTerms) return DEFAULT_DUE_DAYS;
  const match = creditTerms.match(/(\d+)/);
  if (!match) return DEFAULT_DUE_DAYS;
  const days = parseInt(match[1], 10);
  return Number.isFinite(days) && days > 0 ? days : DEFAULT_DUE_DAYS;
}

export function computeDueAt(issuedAt: Date, creditTerms: string | null | undefined): Date {
  const days = parseCreditTermsDays(creditTerms);
  const due = new Date(issuedAt);
  due.setDate(due.getDate() + days);
  return due;
}

/**
 * D-034: OVERDUE is computed-on-read for immediate correctness — the STORED status may still
 * say SENT/PARTIAL until the BullMQ reconciliation job catches up and persists OVERDUE. This
 * function is what read endpoints call to report the CURRENT effective status, without
 * mutating the row. OVERDUE is automatic-only — never a manual transition target.
 */
export function effectiveStatus(stored: { status: string; dueAt: Date | null }, now: Date = new Date()): string {
  if ((stored.status === 'SENT' || stored.status === 'PARTIAL') && stored.dueAt && stored.dueAt < now) {
    return 'OVERDUE';
  }
  return stored.status;
}

/**
 * DRAFT -> SENT is the only manual lifecycle transition this module knows about right now
 * (PARTIAL/PAID are explicitly D-035/Payment-model scope, not yet ratified).
 */
export function assertCanIssue(status: string): void {
  if (status !== 'DRAFT') {
    throw new AppError('STATE_TRANSITION_INVALID', `invoice must be DRAFT to issue, was ${status}`);
  }
}
