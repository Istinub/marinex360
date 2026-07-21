import { describe, it, expect } from 'vitest';
import { assertTransition, canTransition, isHeaderLocked, resumeTarget, TERMINAL_STATES } from '../src/domain/josm.js';
import type { Actor } from '../src/domain/josm.js';

const owner: Actor = { userId: 'tech-1', roles: ['TECHNICIAN'] };
const otherTech: Actor = { userId: 'tech-2', roles: ['TECHNICIAN'] };
const sup: Actor = { userId: 'sup-1', roles: ['OPS_SUPERVISOR'] };
const fin: Actor = { userId: 'fin-1', roles: ['FINANCE'] };
const dir: Actor = { userId: 'dir-1', roles: ['DIRECTOR'] };

describe('JOSM legal path (JOSM-1)', () => {
  it('DRAFT->SCHEDULED by supervisor', () => {
    expect(assertTransition({ from: 'DRAFT', to: 'SCHEDULED', actor: sup }).to).toBe('SCHEDULED');
  });
  it('SCHEDULED->IN_PROGRESS by execution owner only', () => {
    expect(assertTransition({ from: 'SCHEDULED', to: 'IN_PROGRESS', actor: owner, executionOwnerId: 'tech-1' }).to).toBe('IN_PROGRESS');
  });
  it('IN_PROGRESS->PENDING_REVIEW by execution owner', () => {
    expect(assertTransition({ from: 'IN_PROGRESS', to: 'PENDING_REVIEW', actor: owner, executionOwnerId: 'tech-1' }).to).toBe('PENDING_REVIEW');
  });
  it('PENDING_REVIEW->COMPLETED by supervisor', () => {
    expect(assertTransition({ from: 'PENDING_REVIEW', to: 'COMPLETED', actor: sup }).to).toBe('COMPLETED');
  });
  it('COMPLETED->INVOICED->CLOSED by finance', () => {
    expect(assertTransition({ from: 'COMPLETED', to: 'INVOICED', actor: fin }).to).toBe('INVOICED');
    expect(assertTransition({ from: 'INVOICED', to: 'CLOSED', actor: fin }).to).toBe('CLOSED');
  });
});

describe('JOSM assignee gate (JOSM-5 / CC-03)', () => {
  it('non-owner cannot enter IN_PROGRESS', () => {
    expect(() => assertTransition({ from: 'SCHEDULED', to: 'IN_PROGRESS', actor: otherTech, executionOwnerId: 'tech-1' }))
      .toThrowError(/FORBIDDEN|may not/);
  });
  it('supervisor (not owner) cannot drive execution transition', () => {
    expect(() => assertTransition({ from: 'IN_PROGRESS', to: 'PENDING_REVIEW', actor: sup, executionOwnerId: 'tech-1' }))
      .toThrow();
  });
});

describe('JOSM skips & backward rejected (JOSM-2/3)', () => {
  it('DRAFT->IN_PROGRESS illegal', () => {
    expect(() => assertTransition({ from: 'DRAFT', to: 'IN_PROGRESS', actor: sup })).toThrowError(/illegal transition/);
  });
  it('SCHEDULED->COMPLETED illegal', () => {
    expect(() => assertTransition({ from: 'SCHEDULED', to: 'COMPLETED', actor: sup })).toThrow();
  });
  it('INVOICED->COMPLETED backward illegal', () => {
    expect(() => assertTransition({ from: 'INVOICED', to: 'COMPLETED', actor: fin })).toThrow();
  });
});

describe('JOSM terminal (JOSM-4)', () => {
  it('CLOSED and CANCELLED are terminal', () => {
    expect(TERMINAL_STATES.has('CLOSED')).toBe(true);
    expect(TERMINAL_STATES.has('CANCELLED')).toBe(true);
    expect(() => assertTransition({ from: 'CLOSED', to: 'INVOICED', actor: fin })).toThrowError(/terminal/);
    expect(() => assertTransition({ from: 'CANCELLED', to: 'SCHEDULED', actor: sup })).toThrowError(/terminal/);
  });
});

describe('JOSM side transitions need reason (JOSM-8)', () => {
  it('ON_HOLD without reason rejected', () => {
    expect(() => assertTransition({ from: 'IN_PROGRESS', to: 'ON_HOLD', actor: sup })).toThrowError(/requires a reason/);
  });
  it('ON_HOLD with reason ok', () => {
    expect(assertTransition({ from: 'IN_PROGRESS', to: 'ON_HOLD', actor: sup, reason: 'awaiting parts' }).to).toBe('ON_HOLD');
  });
  it('CANCELLED legal from DRAFT/SCHEDULED/IN_PROGRESS/PENDING_REVIEW (ADR-2)', () => {
    for (const from of ['DRAFT', 'SCHEDULED', 'IN_PROGRESS', 'PENDING_REVIEW'] as const) {
      expect(assertTransition({ from, to: 'CANCELLED', actor: dir, reason: 'client cancelled' }).to).toBe('CANCELLED');
    }
  });
  it('CANCELLED illegal from COMPLETED/INVOICED (financial path immutable)', () => {
    expect(() => assertTransition({ from: 'COMPLETED', to: 'CANCELLED', actor: dir, reason: 'x' })).toThrow();
    expect(() => assertTransition({ from: 'INVOICED', to: 'CANCELLED', actor: dir, reason: 'x' })).toThrow();
  });
  it('ON_HOLD illegal from PENDING_REVIEW (only SCHEDULED/IN_PROGRESS)', () => {
    expect(() => assertTransition({ from: 'PENDING_REVIEW', to: 'ON_HOLD', actor: sup, reason: 'x' })).toThrow();
  });
});

describe('JOSM resume to prior state (JOSM-9 / JOSM-AMB-2 / ADR-2)', () => {
  it('held from IN_PROGRESS resumes to IN_PROGRESS', () => {
    const history = [{ fromState: 'IN_PROGRESS', toState: 'ON_HOLD' }];
    expect(resumeTarget(history)).toBe('IN_PROGRESS');
    expect(assertTransition({ from: 'ON_HOLD', to: 'IN_PROGRESS', actor: sup, reason: 'resume', history }).to).toBe('IN_PROGRESS');
  });
  it('held from SCHEDULED resumes to SCHEDULED, not IN_PROGRESS', () => {
    const history = [{ fromState: 'SCHEDULED', toState: 'ON_HOLD' }];
    expect(resumeTarget(history)).toBe('SCHEDULED');
    // caller may pass any `to`; engine overrides with the computed prior:
    expect(assertTransition({ from: 'ON_HOLD', to: 'IN_PROGRESS', actor: sup, reason: 'resume', history }).to).toBe('SCHEDULED');
  });
});

describe('JOSM supervisor rejection (JOSM-7)', () => {
  it('PENDING_REVIEW->IN_PROGRESS by supervisor with reason', () => {
    const r = assertTransition({ from: 'PENDING_REVIEW', to: 'IN_PROGRESS', actor: sup, reason: 'redo weld inspection' });
    expect(r.to).toBe('IN_PROGRESS');
    expect(r.kind).toBe('REJECT');
  });
  it('rejection requires a reason', () => {
    expect(() => assertTransition({ from: 'PENDING_REVIEW', to: 'IN_PROGRESS', actor: sup })).toThrowError(/requires a reason/);
  });
});

describe('JOSM header lock (JOSM-6 / CC-02)', () => {
  it('editable only in DRAFT/SCHEDULED', () => {
    expect(isHeaderLocked('DRAFT')).toBe(false);
    expect(isHeaderLocked('SCHEDULED')).toBe(false);
    for (const s of ['IN_PROGRESS', 'PENDING_REVIEW', 'COMPLETED', 'INVOICED', 'CLOSED', 'ON_HOLD'] as const) {
      expect(isHeaderLocked(s)).toBe(true);
    }
  });
});

describe('canTransition helper', () => {
  it('agrees with rules', () => {
    expect(canTransition('DRAFT', 'SCHEDULED')).toBe(true);
    expect(canTransition('DRAFT', 'INVOICED')).toBe(false);
  });
});
