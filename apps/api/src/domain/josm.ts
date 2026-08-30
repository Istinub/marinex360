// Job Order State Machine (JOSM) — INTERFACE_CONTRACT v1.1 ADR-2 adjacency + QA B3.
// Encodes ONLY the legal transitions and their gating. Illegal -> STATE_TRANSITION_INVALID;
// wrong actor -> FORBIDDEN; missing mandatory reason -> VALIDATION_ERROR.
import { AppError } from '../lib/errors.js';
import type { Role } from './rbac.js';

export type JoState =
  | 'DRAFT' | 'SCHEDULED' | 'IN_PROGRESS' | 'PENDING_REVIEW'
  | 'COMPLETED' | 'INVOICED' | 'CLOSED' | 'ON_HOLD' | 'CANCELLED';

export const TERMINAL_STATES: ReadonlySet<JoState> = new Set<JoState>(['CLOSED', 'CANCELLED']);

// Header edits allowed only before execution begins (OD-05 "header locks once In Progress").
// Scope changes after this go via Variation, not header edit (CC-02/JOSM-6).
// [INFERRED] ON_HOLD is treated as locked (conservative). PM/TL: confirm hold-from-SCHEDULED editability.
const HEADER_EDITABLE: ReadonlySet<JoState> = new Set<JoState>(['DRAFT', 'SCHEDULED']);
export const isHeaderLocked = (state: JoState) => !HEADER_EDITABLE.has(state);

type Gate = { execOwner: true } | { roles: Role[] };
type Kind = 'FORWARD' | 'SIDE' | 'RESUME' | 'REJECT';

interface Rule { from: JoState; to: JoState; gate: Gate; requiresReason: boolean; kind: Kind; }

// Office/supervisor roles that drive scheduling and side-controls.
const OFFICE: Role[] = ['OPS_SUPERVISOR', 'SYSTEM_ADMIN', 'DIRECTOR'];
const CANCEL_ROLES: Role[] = ['OPS_SUPERVISOR', 'SYSTEM_ADMIN', 'DIRECTOR']; // [INFERRED] who may cancel

export const RULES: Rule[] = [
  // Forward pipeline
  { from: 'DRAFT',          to: 'SCHEDULED',      gate: { roles: OFFICE },            requiresReason: false, kind: 'FORWARD' },
  { from: 'SCHEDULED',      to: 'IN_PROGRESS',    gate: { execOwner: true },          requiresReason: false, kind: 'FORWARD' }, // assignee-gated
  { from: 'IN_PROGRESS',    to: 'PENDING_REVIEW', gate: { execOwner: true },          requiresReason: false, kind: 'FORWARD' }, // assignee-gated
  { from: 'PENDING_REVIEW', to: 'COMPLETED',      gate: { roles: OFFICE },            requiresReason: false, kind: 'FORWARD' }, // supervisor verify (FR-30)
  { from: 'COMPLETED',      to: 'INVOICED',       gate: { roles: ['FINANCE', 'SYSTEM_ADMIN'] }, requiresReason: false, kind: 'FORWARD' },
  { from: 'INVOICED',       to: 'CLOSED',         gate: { roles: ['FINANCE', 'SYSTEM_ADMIN'] }, requiresReason: false, kind: 'FORWARD' },
  // Supervisor rejection (ADR-2 "rejection arrow -> IN_PROGRESS, tech data retained"). Resolves JOSM-7.
  { from: 'PENDING_REVIEW', to: 'IN_PROGRESS',    gate: { roles: OFFICE },            requiresReason: true,  kind: 'REJECT' },
  // ON_HOLD (from SCHEDULED / IN_PROGRESS only)
  { from: 'SCHEDULED',      to: 'ON_HOLD',        gate: { roles: OFFICE },            requiresReason: true,  kind: 'SIDE' },
  { from: 'IN_PROGRESS',    to: 'ON_HOLD',        gate: { roles: OFFICE },            requiresReason: true,  kind: 'SIDE' },
  // CANCELLED (from DRAFT / SCHEDULED / IN_PROGRESS / PENDING_REVIEW — ADR-2). NOT from COMPLETED+.
  { from: 'DRAFT',          to: 'CANCELLED',      gate: { roles: CANCEL_ROLES },      requiresReason: true,  kind: 'SIDE' },
  { from: 'SCHEDULED',      to: 'CANCELLED',      gate: { roles: CANCEL_ROLES },      requiresReason: true,  kind: 'SIDE' },
  { from: 'IN_PROGRESS',    to: 'CANCELLED',      gate: { roles: CANCEL_ROLES },      requiresReason: true,  kind: 'SIDE' },
  { from: 'PENDING_REVIEW', to: 'CANCELLED',      gate: { roles: CANCEL_ROLES },      requiresReason: true,  kind: 'SIDE' },
  // RESUME is handled specially (target computed from history); see resumeTarget().
  { from: 'ON_HOLD',        to: 'IN_PROGRESS',    gate: { roles: OFFICE },            requiresReason: true,  kind: 'RESUME' },
  { from: 'ON_HOLD',        to: 'SCHEDULED',      gate: { roles: OFFICE },            requiresReason: true,  kind: 'RESUME' },
];

export interface Actor { userId: string; roles: Role[]; }
export interface TransitionInput {
  from: JoState;
  to: JoState;
  actor: Actor;
  reason?: string;
  executionOwnerId?: string | null;
  /** Ordered status history (oldest->newest) of {fromState,toState}; used to compute resume target. */
  history?: { fromState: string; toState: string }[];
}

// ADR-2: "Resume returns to the PRIOR state (stored)." We derive the prior state from the
// append-only JobStatusHistory (fromState of the most recent transition that entered ON_HOLD),
// so no non-canonical column is added to JobOrder. Resolves JOSM-AMB-2.
export function resumeTarget(history: { fromState: string; toState: string }[] | undefined): JoState {
  const holds = (history ?? []).filter((h) => h.toState === 'ON_HOLD');
  const prior = holds.length ? holds[holds.length - 1].fromState : undefined;
  if (prior !== 'SCHEDULED' && prior !== 'IN_PROGRESS') {
    throw new AppError('STATE_TRANSITION_INVALID', 'cannot resume: no recorded prior state');
  }
  return prior as JoState;
}

function gateAllows(gate: Gate, actor: Actor, execOwnerId?: string | null): boolean {
  if ('execOwner' in gate) return !!execOwnerId && actor.userId === execOwnerId;
  return actor.roles.some((r) => gate.roles.includes(r));
}

export function canTransition(from: JoState, to: JoState): boolean {
  return RULES.some((r) => r.from === from && r.to === to);
}

/**
 * Validate a requested transition. Returns the effective target state (for RESUME this is the
 * computed prior state). Throws AppError with the correct contract code on any violation.
 * Ordering of checks matters: terminal/illegal first, then reason, then actor gate.
 */
export function assertTransition(input: TransitionInput): { to: JoState; kind: Kind } {
  const { from, actor, executionOwnerId, history } = input;
  let to = input.to;

  if (TERMINAL_STATES.has(from)) {
    throw new AppError('STATE_TRANSITION_INVALID', `${from} is terminal; no transitions allowed`);
  }

  // Resolve resume target from history so callers can pass to:'IN_PROGRESS' OR the real prior.
  if (from === 'ON_HOLD') to = resumeTarget(history);

  const rule = RULES.find((r) => r.from === from && r.to === to);
  if (!rule) {
    throw new AppError('STATE_TRANSITION_INVALID', `illegal transition ${from} -> ${input.to}`);
  }
  if (rule.requiresReason && !input.reason?.trim()) {
    throw new AppError('VALIDATION_ERROR', `transition ${from} -> ${to} requires a reason`);
  }
  if (!gateAllows(rule.gate, actor, executionOwnerId)) {
    throw new AppError('FORBIDDEN', `actor may not perform ${from} -> ${to}`);
  }
  return { to, kind: rule.kind };
}
