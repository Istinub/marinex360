// RBAC — role -> action matrix enforced at the SERVICE LAYER (RBAC-SCOPE-1: not the UI).
// LEGEND in comments:  [CONTRACT] = explicitly fixed by INTERFACE_CONTRACT v1.1 / QA criteria.
//                      [INFERRED] = reasonable Phase-1 default; PM/TL to confirm (flagged in HANDOFF).
import { AppError } from '../lib/errors.js';

export type Role = 'SYSTEM_ADMIN' | 'DIRECTOR' | 'FINANCE' | 'OPS_SUPERVISOR' | 'TECHNICIAN';
export const ALL_ROLES: Role[] = ['SYSTEM_ADMIN', 'DIRECTOR', 'FINANCE', 'OPS_SUPERVISOR', 'TECHNICIAN'];

export type Action =
  | 'client:read' | 'client:write'
  | 'contact:read' | 'contact:write'
  | 'vessel:read' | 'vessel:write'
  | 'jobOrder:read' | 'jobOrder:create' | 'jobOrder:updateHeader' | 'jobOrder:assign' | 'jobOrder:selfAssign'
  | 'variation:create' | 'variation:approve' | 'variation:reject'
  | 'review:read' | 'review:resolve'
  | 'invoice:read' | 'invoice:create' | 'invoice:issue' | 'invoice:recordPayment'
  | 'document:read' | 'document:write'
  | 'certificate:read' | 'certificate:write'
  | 'material:write'
  | 'audit:read'
  | 'user:admin';

// Roles that MAY reach across branches (RBAC-CROSS-1). Everyone else is branch-pinned.
export const CROSS_BRANCH_ROLES: ReadonlySet<Role> = new Set<Role>(['SYSTEM_ADMIN', 'DIRECTOR']); // [CONTRACT]

// Roles that MUST complete TOTP at login (NFR-07; work order "role ∈ {Admin, Finance}"). [CONTRACT]
export const MFA_REQUIRED_ROLES: ReadonlySet<Role> = new Set<Role>(['SYSTEM_ADMIN', 'FINANCE']);

const MATRIX: Record<Role, ReadonlySet<Action>> = {
  // [INFERRED] admin superset (routine ownership); PM confirm scope of SYSTEM_ADMIN.
  SYSTEM_ADMIN: new Set<Action>([
    'client:read', 'client:write', 'contact:read', 'contact:write', 'vessel:read', 'vessel:write',
    'jobOrder:read', 'jobOrder:create', 'jobOrder:updateHeader', 'jobOrder:assign',
    'variation:create', 'variation:approve', 'variation:reject',
    'review:read', 'review:resolve', 'invoice:read', 'invoice:create', 'invoice:issue', 'invoice:recordPayment',
    'document:read', 'document:write', 'certificate:read', 'certificate:write',
    'material:write', 'audit:read', 'user:admin',
  ]),
  // Director: approves/rejects EVERY variation (D-003) [CONTRACT]; consolidated cross-branch
  // READ (RBAC-CROSS-1) [CONTRACT]. Not wired for routine CRUD [INFERRED].
  DIRECTOR: new Set<Action>([
    'client:read', 'contact:read', 'vessel:read', 'jobOrder:read',
    'variation:approve', 'variation:reject', 'review:read', 'invoice:read', 'invoice:recordPayment', 'audit:read',
    'document:read', 'document:write', 'certificate:read', 'certificate:write',
  ]),
  // Finance: invoicing only; MUST NOT edit job scope (RBAC-FIN-1) [CONTRACT] -> no jobOrder
  // header/assign, no variation:create/approve.
  FINANCE: new Set<Action>([
    'client:read', 'vessel:read', 'jobOrder:read',
    'invoice:read', 'invoice:create', 'invoice:issue', 'invoice:recordPayment', 'audit:read',
    'document:read', 'certificate:read',
  ]),
  // Ops supervisor: office CRUD + JO lifecycle + variation PROPOSE + review queue [INFERRED,
  // consistent with JOSM gating in contract]. NOT variation:approve (Director/System Admin only) [CONTRACT].
  OPS_SUPERVISOR: new Set<Action>([
    'client:read', 'client:write', 'contact:read', 'contact:write', 'vessel:read', 'vessel:write',
    'jobOrder:read', 'jobOrder:create', 'jobOrder:updateHeader', 'jobOrder:assign',
    'variation:create', 'review:read', 'review:resolve', 'material:write', 'invoice:read',
    'document:read', 'document:write', 'certificate:read', 'certificate:write',
  ]),
  // Technician: reads ONLY their assigned jobs (row-level IDOR check is separate, RBAC-IDOR-1);
  // adds field materials (OD-01). Execution-state transitions are execution-owner-gated in JOSM,
  // not role-gated here. [INFERRED where not covered by contract]
  TECHNICIAN: new Set<Action>(['jobOrder:read', 'jobOrder:selfAssign', 'material:write']),
};

export function can(roles: Role[], action: Action): boolean {
  return roles.some((r) => MATRIX[r]?.has(action));
}

export function assertCan(roles: Role[], action: Action): void {
  if (!can(roles, action)) throw new AppError('FORBIDDEN', `role(s) [${roles.join(',')}] may not ${action}`);
}

export const isCrossBranch = (roles: Role[]) => roles.some((r) => CROSS_BRANCH_ROLES.has(r));
export const requiresMfaAtLogin = (roles: Role[]) => roles.some((r) => MFA_REQUIRED_ROLES.has(r));
