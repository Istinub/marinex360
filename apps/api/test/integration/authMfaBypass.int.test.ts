import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { buildApp } from '../../src/app.js';
import { hashPassword } from '../../src/auth/password.js';
import { generateBase32Secret, totpAt } from '../../src/auth/totp.js';
import { verifyAccessToken } from '../../src/auth/tokens.js';

const run = process.env.RUN_DB_TESTS ? describe : describe.skip;
const SECRET = process.env.JWT_ACCESS_SECRET ?? 'test-secret';
const PASSWORD = 'MarineX360-test!';
const previousSkipAdminMfa = process.env.SKIP_ADMIN_MFA;
const MFA_FLAG_TEST_LOCK = 735001;

async function withMfaFlagLock<T>(prisma: PrismaClient, work: () => Promise<T>): Promise<T> {
  await prisma.$executeRaw`SELECT pg_advisory_lock(${MFA_FLAG_TEST_LOCK})`;
  try {
    await prisma.featureFlag.upsert({
      where: { key: 'MFA_REQUIRED' },
      update: { enabled: false, description: 'Require MFA/TOTP at login for System Admin and Finance accounts', category: 'security' },
      create: { key: 'MFA_REQUIRED', enabled: false, description: 'Require MFA/TOTP at login for System Admin and Finance accounts', category: 'security' },
    });
    return await work();
  } finally {
    await prisma.featureFlag.updateMany({ where: { key: 'MFA_REQUIRED' }, data: { enabled: false } });
    await prisma.$executeRaw`SELECT pg_advisory_unlock(${MFA_FLAG_TEST_LOCK})`;
  }
}

run('Auth login MFA bypass (integration)', () => {
  let prisma: PrismaClient;
  let app: ReturnType<typeof buildApp>;
  let passwordHash: string;
  let adminSecret: string;
  let financeSecret: string;

  beforeAll(async () => {
    prisma = new PrismaClient();
    app = buildApp({ prisma, accessSecret: SECRET, presignPut: async () => ({ uploadUrl: 'http://minio/local', headers: {} }) });
    await app.ready();
    passwordHash = await hashPassword(PASSWORD);
    adminSecret = generateBase32Secret();
    financeSecret = generateBase32Secret();

    await prisma.user.upsert({
      where: { email: 'auth-mfa-admin@tkmr.local' },
      update: {
        name: 'Auth MFA Admin',
        passwordHash,
        roles: ['SYSTEM_ADMIN'],
        branch: 'SG',
        active: true,
        mfaEnrolled: true,
        totpSecret: adminSecret,
      },
      create: {
        email: 'auth-mfa-admin@tkmr.local',
        name: 'Auth MFA Admin',
        passwordHash,
        roles: ['SYSTEM_ADMIN'],
        branch: 'SG',
        active: true,
        mfaEnrolled: true,
        totpSecret: adminSecret,
      },
    });
    await prisma.user.upsert({
      where: { email: 'auth-mfa-finance@tkmr.local' },
      update: {
        name: 'Auth MFA Finance',
        passwordHash,
        roles: ['FINANCE'],
        branch: 'SG',
        active: true,
        mfaEnrolled: true,
        totpSecret: financeSecret,
      },
      create: {
        email: 'auth-mfa-finance@tkmr.local',
        name: 'Auth MFA Finance',
        passwordHash,
        roles: ['FINANCE'],
        branch: 'SG',
        active: true,
        mfaEnrolled: true,
        totpSecret: financeSecret,
      },
    });
    await prisma.user.upsert({
      where: { email: 'auth-mfa-ops@tkmr.local' },
      update: {
        name: 'Auth MFA Ops',
        passwordHash,
        roles: ['OPS_SUPERVISOR'],
        branch: 'SG',
        active: true,
        mfaEnrolled: false,
        totpSecret: null,
      },
      create: {
        email: 'auth-mfa-ops@tkmr.local',
        name: 'Auth MFA Ops',
        passwordHash,
        roles: ['OPS_SUPERVISOR'],
        branch: 'SG',
        active: true,
        mfaEnrolled: false,
        totpSecret: null,
      },
    });
  });

  beforeEach(() => {
    delete process.env.SKIP_ADMIN_MFA;
  });

  afterAll(async () => {
    if (previousSkipAdminMfa == null) delete process.env.SKIP_ADMIN_MFA;
    else process.env.SKIP_ADMIN_MFA = previousSkipAdminMfa;
    await app.close();
    await prisma.$disconnect();
  });

  it('does not require Admin TOTP while MFA_REQUIRED is disabled', async () => {
    await withMfaFlagLock(prisma, async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { email: 'auth-mfa-admin@tkmr.local', password: PASSWORD },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().mfaEnrollmentRequired).toBe(false);
      const claims = verifyAccessToken(response.json().access, SECRET);
      expect(claims.mfaComplete).toBe(true);
    });
  });

  it('keeps Admin TOTP enforced when MFA_REQUIRED is enabled and SKIP_ADMIN_MFA is unset', async () => {
    await withMfaFlagLock(prisma, async () => {
      await prisma.featureFlag.update({ where: { key: 'MFA_REQUIRED' }, data: { enabled: true } });

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { email: 'auth-mfa-admin@tkmr.local', password: PASSWORD },
      });

      expect(response.statusCode).toBe(401);
      expect(response.json().error.message).toBe('valid TOTP required');
    });
  });

  it('lets Admin bypass MFA only when SKIP_ADMIN_MFA=true', async () => {
    await withMfaFlagLock(prisma, async () => {
      await prisma.featureFlag.update({ where: { key: 'MFA_REQUIRED' }, data: { enabled: true } });
      process.env.SKIP_ADMIN_MFA = 'true';

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { email: 'auth-mfa-admin@tkmr.local', password: PASSWORD },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().mfaEnrollmentRequired).toBe(false);
      const claims = verifyAccessToken(response.json().access, SECRET);
      expect(claims.roles).toContain('SYSTEM_ADMIN');
      expect(claims.mfaComplete).toBe(true);
    });
  });

  it('does not bypass Finance MFA when SKIP_ADMIN_MFA=true', async () => {
    await withMfaFlagLock(prisma, async () => {
      await prisma.featureFlag.update({ where: { key: 'MFA_REQUIRED' }, data: { enabled: true } });
      process.env.SKIP_ADMIN_MFA = 'true';

      const blocked = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { email: 'auth-mfa-finance@tkmr.local', password: PASSWORD },
      });
      expect(blocked.statusCode).toBe(401);
      expect(blocked.json().error.message).toBe('valid TOTP required');

      const allowed = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { email: 'auth-mfa-finance@tkmr.local', password: PASSWORD, totp: totpAt(financeSecret, Date.now()) },
      });
      expect(allowed.statusCode).toBe(200);
      expect(verifyAccessToken(allowed.json().access, SECRET).mfaComplete).toBe(true);
    });
  });

  it('leaves non-MFA roles unchanged when SKIP_ADMIN_MFA=true', async () => {
    process.env.SKIP_ADMIN_MFA = 'true';

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'auth-mfa-ops@tkmr.local', password: PASSWORD },
    });

    expect(response.statusCode).toBe(200);
    const claims = verifyAccessToken(response.json().access, SECRET);
    expect(claims.roles).toEqual(['OPS_SUPERVISOR']);
    expect(claims.mfaComplete).toBe(true);
  });
});
