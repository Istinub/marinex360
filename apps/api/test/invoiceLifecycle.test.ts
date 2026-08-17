import { describe, it, expect } from 'vitest';
import {
  parseCreditTermsDays,
  computeDueAt,
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
