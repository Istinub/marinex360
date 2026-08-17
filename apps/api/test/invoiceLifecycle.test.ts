import { describe, it, expect } from 'vitest';
import {
  parseCreditTermsDays,
  computeDueAt,
  effectiveStatus,
  assertCanIssue,
  deriveStatusFromSum,
} from '../src/domain/invoiceLifecycle.js';

describe('parseCreditTermsDays (D-034)', () => {
  it('parses common formats', () => {
    expect(parseCreditTermsDays('NET30')).toBe(30);
    expect(parseCreditTermsDays('Net 45')).toBe(45);
    expect(parseCreditTermsDays('net-60')).toBe(60);
  });

  it('falls back to 30 for null/unparseable text, never throws', () => {
    expect(parseCreditTermsDays(null)).toBe(30);
    expect(parseCreditTermsDays(undefined)).toBe(30);
    expect(parseCreditTermsDays('Payment on delivery')).toBe(30);
    expect(parseCreditTermsDays('')).toBe(30);
  });
});

describe('computeDueAt', () => {
  it('adds the parsed day count to issuedAt', () => {
    const due = computeDueAt(new Date('2026-08-01T00:00:00Z'), 'NET30');
    expect(due.toISOString().slice(0, 10)).toBe('2026-08-31');
  });
});

describe('effectiveStatus (computed-on-read OVERDUE)', () => {
  it('reports OVERDUE when dueAt has passed and status is SENT or PARTIAL, without mutating storage', () => {
    const past = new Date('2020-01-01');
    expect(effectiveStatus({ status: 'SENT', dueAt: past })).toBe('OVERDUE');
    expect(effectiveStatus({ status: 'PARTIAL', dueAt: past })).toBe('OVERDUE');
  });

  it('does NOT report OVERDUE for DRAFT or PAID regardless of dueAt', () => {
    const past = new Date('2020-01-01');
    expect(effectiveStatus({ status: 'DRAFT', dueAt: past })).toBe('DRAFT');
    expect(effectiveStatus({ status: 'PAID', dueAt: past })).toBe('PAID');
  });

  it('reports the stored status when dueAt has not passed yet, or is null', () => {
    const future = new Date(Date.now() + 86_400_000);
    expect(effectiveStatus({ status: 'SENT', dueAt: future })).toBe('SENT');
    expect(effectiveStatus({ status: 'SENT', dueAt: null })).toBe('SENT');
  });
});

describe('assertCanIssue', () => {
  it('allows DRAFT, rejects everything else with STATE_TRANSITION_INVALID', () => {
    expect(() => assertCanIssue('DRAFT')).not.toThrow();
    expect(() => assertCanIssue('SENT')).toThrowError(/STATE_TRANSITION_INVALID|must be DRAFT/);
  });
});

describe('deriveStatusFromSum (D-035)', () => {
  it('sum=0 -> SENT', () => {
    expect(deriveStatusFromSum(0, 100000)).toBe('SENT');
  });

  it('negative sum (reversal exceeds prior payments) -> SENT, not an error', () => {
    expect(deriveStatusFromSum(-500, 100000)).toBe('SENT');
  });

  it('0<sum<total -> PARTIAL', () => {
    expect(deriveStatusFromSum(50000, 100000)).toBe('PARTIAL');
  });

  it('sum>=total -> PAID (SENT can jump straight to PAID)', () => {
    expect(deriveStatusFromSum(100000, 100000)).toBe('PAID');
    expect(deriveStatusFromSum(150000, 100000)).toBe('PAID');
  });
});
