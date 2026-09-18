import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { buildApp } from '../../src/app.js';
import { signAccessToken } from '../../src/auth/tokens.js';
import { hashPassword } from '../../src/auth/password.js';
import { generateBase32Secret } from '../../src/auth/totp.js';

const run = process.env.RUN_DB_TESTS ? describe : describe.skip;
const SECRET = process.env.JWT_ACCESS_SECRET ?? 'test-secret';
const PASSWORD = 'MarineX360-test!';
const MFA_FLAG_TEST_LOCK = 735001;

const bearer = (user: { id: string; roles: string[]; branch: string }) =>
  `Bearer ${signAccessToken({ sub: user.id, roles: user.roles as any, branch: user.branch, mfaComplete: true }, SECRET)}`;

async function withMfaFlagLock<T>(prisma: PrismaClient, work: () => Promise<T>): Promise<T> {
  await prisma.$executeRaw`SELECT pg_advisory_lock(${MFA_FLAG_TEST_LOCK})`;
  try {
    await prisma.featureFlag.updateMany({ where: { key: 'MFA_REQUIRED' }, data: { enabled: false } });
    return await work();
  } finally {
    await prisma.featureFlag.updateMany({ where: { key: 'MFA_REQUIRED' }, data: { enabled: false } });
    await prisma.$executeRaw`SELECT pg_advisory_unlock(${MFA_FLAG_TEST_LOCK})`;
  }
}

run('Admin settings feature flags (integration)', () => {
  let prisma: PrismaClient;
  let app: ReturnType<typeof buildApp>;
  let admin: any;
  let director: any;
  let passwordHash: string;

  beforeAll(async () => {
    prisma = new PrismaClient();
    app = buildApp({ prisma, accessSecret: SECRET, presignPut: async () => ({ uploadUrl: 'http://minio/local', headers: {} }) });
    await app.ready();
    passwordHash = await hashPassword(PASSWORD);
    admin = await prisma.user.upsert({
      where: { email: 'admin-settings-admin@tkmr.local' },
      update: {
        name: 'Admin Settings Admin',
        passwordHash,
        roles: ['SYSTEM_ADMIN'],
        branch: 'SG',
        active: true,
        mfaEnrolled: true,
        totpSecret: generateBase32Secret(),
      },
      create: {
        email: 'admin-settings-admin@tkmr.local',
        name: 'Admin Settings Admin',
        passwordHash,
        roles: ['SYSTEM_ADMIN'],
        branch: 'SG',
        active: true,
        mfaEnrolled: true,
        totpSecret: generateBase32Secret(),
      },
    });
    director = await prisma.user.findUniqueOrThrow({ where: { email: 'director@tkmr.local' } });
    await prisma.featureFlag.upsert({
      where: { key: 'MFA_REQUIRED' },
      update: { enabled: false, description: 'Require MFA/TOTP at login for System Admin and Finance accounts', category: 'security' },
      create: { key: 'MFA_REQUIRED', enabled: false, description: 'Require MFA/TOTP at login for System Admin and Finance accounts', category: 'security' },
    });
    await prisma.featureFlag.upsert({
      where: { key: 'DEV_TOOLS' },
      update: { enabled: false, description: 'Admin table browser + read-only SQL console', category: 'admin' },
      create: { key: 'DEV_TOOLS', enabled: false, description: 'Admin table browser + read-only SQL console', category: 'admin' },
    });
  });

  afterAll(async () => {
    await prisma.featureFlag.updateMany({ where: { key: { in: ['MFA_REQUIRED', 'DEV_TOOLS'] } }, data: { enabled: false } });
    await app.close();
    await prisma.$disconnect();
  });

  it('allows SYSTEM_ADMIN to list and patch flags and writes an audit row', async () => {
    await withMfaFlagLock(prisma, async () => {
      const list = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/settings/flags',
        headers: { authorization: bearer(admin) },
      });
      expect(list.statusCode).toBe(200);
      expect(list.json().map((flag: any) => flag.key)).toEqual(expect.arrayContaining(['DEV_TOOLS', 'MFA_REQUIRED']));

      const updated = await app.inject({
        method: 'PATCH',
        url: '/api/v1/admin/settings/flags/MFA_REQUIRED',
        headers: { authorization: bearer(admin) },
        payload: { enabled: true },
      });
      expect(updated.statusCode).toBe(200);
      expect(updated.json().enabled).toBe(true);

      const audit = await prisma.auditEntry.findFirst({
        where: { entityType: 'FeatureFlag', entityId: 'MFA_REQUIRED', action: 'UPDATE' },
        orderBy: { at: 'desc' },
      });
      expect(audit?.diff).toEqual({ from: false, to: true });
    });
  });

  it('blocks non-admin users', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/settings/flags',
      headers: { authorization: bearer(director) },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe('FORBIDDEN');
  });

  it('toggles MFA enforcement from disabled to enabled and back', async () => {
    await withMfaFlagLock(prisma, async () => {
      await prisma.featureFlag.update({ where: { key: 'MFA_REQUIRED' }, data: { enabled: false } });

      const disabled = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { email: 'admin-settings-admin@tkmr.local', password: PASSWORD },
      });
      expect(disabled.statusCode).toBe(200);
      expect(disabled.json().mfaEnrollmentRequired).toBe(false);

      await app.inject({
        method: 'PATCH',
        url: '/api/v1/admin/settings/flags/MFA_REQUIRED',
        headers: { authorization: bearer(admin) },
        payload: { enabled: true },
      });

      const enabled = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { email: 'admin-settings-admin@tkmr.local', password: PASSWORD },
      });
      expect(enabled.statusCode).toBe(401);
      expect(enabled.json().error.message).toBe('valid TOTP required');

      await app.inject({
        method: 'PATCH',
        url: '/api/v1/admin/settings/flags/MFA_REQUIRED',
        headers: { authorization: bearer(admin) },
        payload: { enabled: false },
      });

      const offAgain = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { email: 'admin-settings-admin@tkmr.local', password: PASSWORD },
      });
      expect(offAgain.statusCode).toBe(200);
      expect(offAgain.json().mfaEnrollmentRequired).toBe(false);
    });
  });
});
