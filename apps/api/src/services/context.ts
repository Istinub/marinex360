import type { Role } from '../domain/rbac.js';
// Derived from the verified access token ONLY. branch is never read from body/query (RBAC-SPOOF-1).
export interface RequestContext { userId: string; roles: Role[]; branch: string; }
