import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword } from '../src/auth/password.js';
import { generateBase32Secret, totpAt, verifyTotp, provisioningUri, generateRecoveryCodes } from '../src/auth/totp.js';
import { signAccessToken, verifyAccessToken, hashRefresh, newFamilyId, decideRotation } from '../src/auth/tokens.js';

const SECRET = 'test-hs256-secret';

describe('password scrypt', () => {
  it('verifies a correct password and rejects a wrong one', async () => {
    const h = await hashPassword('Correct-Horse-9');
    expect(await verifyPassword('Correct-Horse-9', h)).toBe(true);
    expect(await verifyPassword('wrong', h)).toBe(false);
  });
});

describe('TOTP (G-2)', () => {
  it('accepts a freshly generated code and rejects a stale one', () => {
    const secret = generateBase32Secret();
    const now = Date.now();
    const code = totpAt(secret, now);
    expect(verifyTotp(secret, code, now)).toBe(true);
    // a code from 5 minutes ago is outside the +/-1 step window
    expect(verifyTotp(secret, totpAt(secret, now - 5 * 60_000), now)).toBe(false);
  });
  it('tolerates +/-1 step drift', () => {
    const secret = generateBase32Secret();
    const now = Date.now();
    expect(verifyTotp(secret, totpAt(secret, now - 30_000), now)).toBe(true);
    expect(verifyTotp(secret, totpAt(secret, now + 30_000), now)).toBe(true);
  });
  it('rejects malformed tokens', () => {
    const secret = generateBase32Secret();
    expect(verifyTotp(secret, 'abcdef')).toBe(false);
    expect(verifyTotp(secret, '12345')).toBe(false);
  });
  it('provisioning URI is otpauth and recovery codes are unique', () => {
    const uri = provisioningUri('JBSWY3DPEHPK3PXP', 'admin@tkmr.example', 'MarineX360');
    expect(uri).toMatch(/^otpauth:\/\/totp\//);
    const { plaintext } = generateRecoveryCodes(10);
    expect(new Set(plaintext).size).toBe(10);
  });
});

describe('access token (RBAC-JWT-1)', () => {
  it('signs and verifies', () => {
    const t = signAccessToken({ sub: 'u1', roles: ['FINANCE'], branch: 'SG' }, SECRET);
    const claims = verifyAccessToken(t, SECRET);
    expect(claims.sub).toBe('u1');
    expect(claims.branch).toBe('SG');
  });
  it('rejects expired token', () => {
    const past = Date.now() - 3600_000;
    const t = signAccessToken({ sub: 'u1', roles: ['FINANCE'], branch: 'SG' }, SECRET, 900, past);
    expect(() => verifyAccessToken(t, SECRET)).toThrowError(/expired/);
  });
  it('rejects tampered signature', () => {
    const t = signAccessToken({ sub: 'u1', roles: ['FINANCE'], branch: 'SG' }, SECRET);
    expect(() => verifyAccessToken(t + 'x', SECRET)).toThrow();
    expect(() => verifyAccessToken(t, 'other-secret')).toThrow();
  });
});

describe('refresh rotation family (RBAC-JWT-2)', () => {
  const fam = newFamilyId();
  const future = new Date(Date.now() + 86_400_000);
  it('active token rotates', () => {
    const raw = 'raw-refresh-1';
    const row = { tokenHash: hashRefresh(raw), family: fam, revokedAt: null, expiresAt: future };
    expect(decideRotation(hashRefresh(raw), row).action).toBe('ROTATE');
  });
  it('replay of a revoked token revokes the whole family', () => {
    const raw = 'raw-refresh-old';
    const row = { tokenHash: hashRefresh(raw), family: fam, revokedAt: new Date(), expiresAt: future };
    const d = decideRotation(hashRefresh(raw), row);
    expect(d.action).toBe('REVOKE_FAMILY');
    expect(d.revokeFamily).toBe(fam);
  });
  it('unknown token is UNAUTHORIZED', () => {
    expect(() => decideRotation('nope', null)).toThrowError(/UNAUTHORIZED|unknown/);
  });
  it('expired refresh is UNAUTHORIZED', () => {
    const raw = 'raw-refresh-exp';
    const row = { tokenHash: hashRefresh(raw), family: fam, revokedAt: null, expiresAt: new Date(Date.now() - 1000) };
    expect(() => decideRotation(hashRefresh(raw), row)).toThrowError(/expired/);
  });
});
