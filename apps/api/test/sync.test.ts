import { describe, it, expect } from 'vitest';
import { isDispatched, resolveReviewState, snapshotLabourRate, parseChangeSeqCursor, WRITABLE_ENTITIES } from '../src/domain/sync.js';

describe('isDispatched / resolveReviewState (D-002/SYNC-13)', () => {
  const jo = { assignedTechnicianIds: ['tech-1', 'tech-2'], executionOwnerId: 'tech-1' };

  it('assigned technician is dispatched, not flagged', () => {
    expect(isDispatched(jo, 'tech-2')).toBe(true);
    expect(resolveReviewState(jo, 'tech-2')).toEqual({ flagged: false, reviewState: null });
  });

  it('execution owner counts as dispatched even if not in the array (defensive)', () => {
    expect(isDispatched({ assignedTechnicianIds: [], executionOwnerId: 'tech-9' }, 'tech-9')).toBe(true);
  });

  it('unassigned technician is NOT dispatched -> flagged for supervisor review, never dropped', () => {
    expect(isDispatched(jo, 'tech-3')).toBe(false);
    expect(resolveReviewState(jo, 'tech-3')).toEqual({ flagged: true, reviewState: 'PENDING_SUPERVISOR_REVIEW' });
  });
});

describe('snapshotLabourRate (CC-9)', () => {
  it('uses the JO rate when set', () => {
    expect(snapshotLabourRate({ labourRateAmountMinor: 12000, labourRateCurrency: 'MYR' }))
      .toEqual({ amountMinor: 12000, currency: 'MYR' });
  });
  it('falls back to D-004 default when unset', () => {
    expect(snapshotLabourRate({ labourRateAmountMinor: null, labourRateCurrency: null }))
      .toEqual({ amountMinor: 9000, currency: 'SGD' });
  });
  it('falls back if only one half is set (defensive)', () => {
    expect(snapshotLabourRate({ labourRateAmountMinor: 12000, labourRateCurrency: null }))
      .toEqual({ amountMinor: 9000, currency: 'SGD' });
  });
});

describe('parseChangeSeqCursor (D-012 monotonic cursor)', () => {
  it('parses a valid non-negative decimal string', () => {
    expect(parseChangeSeqCursor('12345678901234567890')).toBe(12345678901234567890n);
  });
  it('defaults to zero for zero, missing, malformed, or negative input', () => {
    expect(parseChangeSeqCursor('0')).toBe(0n);
    expect(parseChangeSeqCursor(undefined)).toBe(0n);
    expect(parseChangeSeqCursor('not-a-number')).toBe(0n);
    expect(parseChangeSeqCursor('-1')).toBe(0n);
  });
});

describe('WRITABLE_ENTITIES', () => {
  it('matches the six offline-writable execution entities from the contract', () => {
    expect([...WRITABLE_ENTITIES].sort()).toEqual(
      ['ChecklistInstance', 'ESignature', 'MaterialLine', 'Observation', 'Photo', 'WorkLog'].sort()
    );
  });
});
