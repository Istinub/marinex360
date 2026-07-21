// JWT (HS256) access tokens + rotating refresh tokens with reuse-detection families.
// Access token is a signed JWT (self-contained). Refresh tokens are opaque random strings whose
// HASH is stored (schema RefreshToken.tokenHash); rotation replaces one row with the next in the
// same `family`. Replay of a rotated (already-revoked) refresh -> revoke the WHOLE family
// (RBAC-JWT-2). Mobile long-lived family flagged `longLived` (OD-04).
import { createHmac, randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { AppError } from '../lib/errors.js';
import type { Role } from '../domain/rbac.js';

const b64url = (b: Buffer) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64urlJson = (o: unknown) => b64url(Buffer.from(JSON.stringify(o)));

export interface AccessClaims { sub: string; roles: Role[]; branch: string; mfaComplete?: boolean; iat: number; exp: number; }

export function signAccessToken(
  payload: { sub: string; roles: Role[]; branch: string; mfaComplete?: boolean },
  secret: string,
  ttlSeconds = 15 * 60, // ~15 min (work order)
  now = Date.now(),
): string {
  const iat = Math.floor(now / 1000);
  const claims: AccessClaims = { ...payload, iat, exp: iat + ttlSeconds };
  const head = b64urlJson({ alg: 'HS256', typ: 'JWT' });
  const body = b64urlJson(claims);
  const sig = b64url(createHmac('sha256', secret).update(`${head}.${body}`).digest());
  return `${head}.${body}.${sig}`;
}

export function verifyAccessToken(token: string, secret: string, now = Date.now()): AccessClaims {
  const parts = token.split('.');
  if (parts.length !== 3) throw new AppError('UNAUTHORIZED', 'malformed token');
  const [head, body, sig] = parts;
  const expected = b64url(createHmac('sha256', secret).update(`${head}.${body}`).digest());
  const a = Buffer.from(sig), b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw new AppError('UNAUTHORIZED', 'bad signature');
  const claims = JSON.parse(Buffer.from(body.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString()) as AccessClaims;
  if (claims.exp * 1000 <= now) throw new AppError('UNAUTHORIZED', 'token expired'); // RBAC-JWT-1
  return claims;
}

// ---- Refresh tokens ----
export const newRefreshSecret = () => randomBytes(32).toString('base64url');
export const hashRefresh = (raw: string) => createHash('sha256').update(raw).digest('hex');
export const newFamilyId = () => randomBytes(16).toString('hex');

export const REFRESH_TTL = {
  web: 30 * 24 * 3600,   // [INFERRED default] PM/TL to ratify exact web refresh TTL
  mobile: 90 * 24 * 3600 // [INFERRED default] OD-04 long-lived; PM/TL to ratify
} as const;

// Pure state machine for rotation, independent of Prisma. The route wires it to RefreshToken rows.
export interface StoredRefresh { tokenHash: string; family: string; revokedAt: Date | null; expiresAt: Date; }

export interface RotationDecision {
  action: 'ROTATE' | 'REVOKE_FAMILY';
  reason?: string;
  revokeFamily?: string;
}

/**
 * Decide what to do when a refresh token is presented.
 *  - unknown hash        -> UNAUTHORIZED (not our token)
 *  - known but revoked   -> REUSE DETECTED: revoke the whole family (RBAC-JWT-2)
 *  - known & expired      -> UNAUTHORIZED
 *  - known, active        -> ROTATE (caller revokes this row, issues a fresh one in same family)
 */
export function decideRotation(presentedHash: string, row: StoredRefresh | null, now = new Date()): RotationDecision {
  if (!row) throw new AppError('UNAUTHORIZED', 'unknown refresh token');
  if (row.revokedAt) return { action: 'REVOKE_FAMILY', reason: 'refresh reuse detected', revokeFamily: row.family };
  if (row.expiresAt.getTime() <= now.getTime()) throw new AppError('UNAUTHORIZED', 'refresh expired');
  return { action: 'ROTATE' };
}
