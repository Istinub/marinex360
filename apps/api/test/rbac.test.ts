import { describe, it, expect } from 'vitest';
import { can, assertCan, isCrossBranch, requiresMfaAtLogin } from '../src/domain/rbac.js';

describe('RBAC — Director variation approval (D-003)', () => {
  it('Director may approve/reject variations', () => {
    expect(can(['DIRECTOR'], 'variation:approve')).toBe(true);
    expect(can(['DIRECTOR'], 'variation:reject')).toBe(true);
  });
  it('Supervisor may propose but NOT approve variations', () => {
    expect(can(['OPS_SUPERVISOR'], 'variation:create')).toBe(true);
    expect(can(['OPS_SUPERVISOR'], 'variation:approve')).toBe(false);
  });
});

describe('RBAC — Finance cannot edit job scope (RBAC-FIN-1)', () => {
  it('Finance blocked from JO header edits and variation create', () => {
    expect(can(['FINANCE'], 'jobOrder:updateHeader')).toBe(false);
    expect(can(['FINANCE'], 'variation:create')).toBe(false);
    expect(can(['FINANCE'], 'jobOrder:assign')).toBe(false);
  });
  it('Finance may create/issue invoices', () => {
    expect(can(['FINANCE'], 'invoice:create')).toBe(true);
    expect(can(['FINANCE'], 'invoice:issue')).toBe(true);
  });
});

describe('RBAC — cross-branch (RBAC-CROSS-1)', () => {
  it('only Director/Admin reach across branches', () => {
    expect(isCrossBranch(['DIRECTOR'])).toBe(true);
    expect(isCrossBranch(['SYSTEM_ADMIN'])).toBe(true);
    expect(isCrossBranch(['OPS_SUPERVISOR'])).toBe(false);
    expect(isCrossBranch(['FINANCE'])).toBe(false);
    expect(isCrossBranch(['TECHNICIAN'])).toBe(false);
  });
});

describe('RBAC — MFA at login (RBAC-MFA-1/2, NFR-07)', () => {
  it('Admin and Finance require TOTP', () => {
    expect(requiresMfaAtLogin(['SYSTEM_ADMIN'])).toBe(true);
    expect(requiresMfaAtLogin(['FINANCE'])).toBe(true);
  });
  it('Technician and Supervisor do not', () => {
    expect(requiresMfaAtLogin(['TECHNICIAN'])).toBe(false);
    expect(requiresMfaAtLogin(['OPS_SUPERVISOR'])).toBe(false);
  });
});

describe('RBAC — technician surface', () => {
  it('technician can read JOs (row-level restriction separate) and add materials, nothing else', () => {
    expect(can(['TECHNICIAN'], 'jobOrder:read')).toBe(true);
    expect(can(['TECHNICIAN'], 'material:write')).toBe(true);
    expect(can(['TECHNICIAN'], 'jobOrder:create')).toBe(false);
    expect(can(['TECHNICIAN'], 'invoice:read')).toBe(false);
  });
  it('assertCan throws FORBIDDEN', () => {
    expect(() => assertCan(['TECHNICIAN'], 'invoice:create')).toThrowError(/FORBIDDEN|may not/);
  });
});
