import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { buildApp } from '../../src/app.js';
import { signAccessToken } from '../../src/auth/tokens.js';

const run = process.env.RUN_DB_TESTS ? describe : describe.skip;
const SECRET = process.env.JWT_ACCESS_SECRET ?? 'test-secret';
const previousReadonlyUrl = process.env.DATABASE_URL_READONLY;

const bearer = (user: { id: string; roles: string[]; branch: string }) =>
  `Bearer ${signAccessToken({ sub: user.id, roles: user.roles as any, branch: user.branch, mfaComplete: true }, SECRET)}`;

run('Admin dev tools (integration)', () => {
  let prisma: PrismaClient;
  let app: ReturnType<typeof buildApp>;
  let readonlyPool: Pool;
  let admin: any;
  let director: any;

  beforeAll(async () => {
    process.env.DATABASE_URL_READONLY = process.env.DATABASE_URL_READONLY_TEST
      ?? 'postgresql://marinex_readonly:localdev_readonly@localhost:5432/marinex360_test';
    prisma = new PrismaClient();
    readonlyPool = new Pool({ connectionString: process.env.DATABASE_URL_READONLY });
    app = buildApp({ prisma, accessSecret: SECRET, presignPut: async () => ({ uploadUrl: 'http://minio/local', headers: {} }) });
    await app.ready();
    admin = await prisma.user.findUniqueOrThrow({ where: { email: 'admin@tkmr.local' } });
    director = await prisma.user.findUniqueOrThrow({ where: { email: 'director@tkmr.local' } });
    await prisma.featureFlag.upsert({
      where: { key: 'DEV_TOOLS' },
      update: { enabled: false, description: 'Admin table browser + read-only SQL console', category: 'admin' },
      create: { key: 'DEV_TOOLS', enabled: false, description: 'Admin table browser + read-only SQL console', category: 'admin' },
    });
  });

  afterAll(async () => {
    await app.close();
    await readonlyPool.end();
    await prisma.$disconnect();
    if (previousReadonlyUrl == null) delete process.env.DATABASE_URL_READONLY;
    else process.env.DATABASE_URL_READONLY = previousReadonlyUrl;
  });

  it('blocks SYSTEM_ADMIN while the feature flag is off by default', async () => {
    await prisma.featureFlag.update({ where: { key: 'DEV_TOOLS' }, data: { enabled: false } });
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/dev/tables',
      headers: { authorization: bearer(admin) },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe('FORBIDDEN');
  });

  it('allows SYSTEM_ADMIN to list tables, browse a table, and execute SELECT when enabled', async () => {
    await prisma.featureFlag.update({ where: { key: 'DEV_TOOLS' }, data: { enabled: true } });

    const list = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/dev/tables',
      headers: { authorization: bearer(admin) },
    });
    expect(list.statusCode).toBe(200);
    expect(list.json().some((row: any) => row.table_name === 'User')).toBe(true);

    const browse = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/dev/tables/User?page=1&pageSize=5',
      headers: { authorization: bearer(admin) },
    });
    expect(browse.statusCode).toBe(200);
    expect(Array.isArray(browse.json())).toBe(true);

    const query = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/dev/query',
      headers: { authorization: bearer(admin) },
      payload: { sql: 'SELECT email FROM "User" ORDER BY email' },
    });
    expect(query.statusCode).toBe(200);
    expect(query.json().rows.length).toBeGreaterThan(0);
    expect(query.json().rowCount).toBeGreaterThan(0);

    const audits = await prisma.auditEntry.findMany({
      where: { entityType: 'DevTools', action: { in: ['LIST', 'BROWSE', 'EXECUTE'] } },
      select: { action: true },
    });
    expect(audits.map((audit) => audit.action)).toEqual(expect.arrayContaining(['LIST', 'BROWSE', 'EXECUTE']));
  });

  it('blocks non-SYSTEM_ADMIN users even when the flag is enabled', async () => {
    await prisma.featureFlag.update({ where: { key: 'DEV_TOOLS' }, data: { enabled: true } });
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/dev/tables',
      headers: { authorization: bearer(director) },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe('FORBIDDEN');
  });

  it('rejects write SQL and proves the read-only role cannot write at the database boundary', async () => {
    await prisma.featureFlag.update({ where: { key: 'DEV_TOOLS' }, data: { enabled: true } });
    const before = await prisma.featureFlag.count({ where: { key: 'READONLY_WRITE_TEST' } });

    const rejected = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/dev/query',
      headers: { authorization: bearer(admin) },
      payload: { sql: 'INSERT INTO "FeatureFlag" ("key") VALUES (\'READONLY_WRITE_TEST\')' },
    });
    expect(rejected.statusCode).toBe(400);
    expect(rejected.json().error.code).toBe('VALIDATION_ERROR');
    expect(await prisma.featureFlag.count({ where: { key: 'READONLY_WRITE_TEST' } })).toBe(before);

    await expect(
      readonlyPool.query('INSERT INTO "FeatureFlag" ("key") VALUES ($1)', ['READONLY_WRITE_TEST']),
    ).rejects.toThrow(/permission denied|must be owner/i);
    expect(await prisma.featureFlag.count({ where: { key: 'READONLY_WRITE_TEST' } })).toBe(before);
  });
});
