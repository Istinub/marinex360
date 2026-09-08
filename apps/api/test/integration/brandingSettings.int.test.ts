import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { buildApp } from '../../src/app.js';
import { signAccessToken } from '../../src/auth/tokens.js';

const run = process.env.RUN_DB_TESTS ? describe : describe.skip;
const SECRET = process.env.JWT_ACCESS_SECRET ?? 'test-secret';
const bearer = (user: { id: string; roles: string[]; branch: string }) =>
  `Bearer ${signAccessToken({ sub: user.id, roles: user.roles as any, branch: user.branch, mfaComplete: true }, SECRET)}`;

run('Branding settings (integration)', () => {
  let prisma: PrismaClient;
  let app: ReturnType<typeof buildApp>;
  let director: any;
  let ops: any;

  beforeAll(async () => {
    prisma = new PrismaClient();
    app = buildApp({ prisma, accessSecret: SECRET, presignPut: async () => ({ uploadUrl: 'http://minio/local', headers: {} }) });
    await app.ready();
    director = await prisma.user.findUniqueOrThrow({ where: { email: 'director@tkmr.local' } });
    ops = await prisma.user.findUniqueOrThrow({ where: { email: 'ops@tkmr.local' } });
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('GET returns the current singleton and real PNG logo filenames', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/branding-settings',
      headers: { authorization: bearer(director) },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ id: 'singleton', logoFilename: expect.any(String) });
    expect(response.json().availableLogoFilenames).toHaveLength(3);
    expect(response.json().availableLogoFilenames).toEqual(expect.arrayContaining(['TKMR_Engineering.png', 'TKMR_Logo.png', 'TKMR.png']));
  });

  it('PATCH rejects a non-Director/Admin caller', async () => {
    const response = await app.inject({
      method: 'PATCH',
      url: '/api/v1/branding-settings',
      headers: { authorization: bearer(ops) },
      payload: { logoFilename: 'TKMR.png' },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe('FORBIDDEN');
  });

  it('PATCH rejects a filename outside the real branding asset list', async () => {
    const response = await app.inject({
      method: 'PATCH',
      url: '/api/v1/branding-settings',
      headers: { authorization: bearer(director) },
      payload: { logoFilename: 'not-a-real-logo.png' },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('PATCH updates the setting returned by the next GET', async () => {
    const updated = await app.inject({
      method: 'PATCH',
      url: '/api/v1/branding-settings',
      headers: { authorization: bearer(director) },
      payload: { logoFilename: 'TKMR.png' },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().logoFilename).toBe('TKMR.png');

    const fetched = await app.inject({
      method: 'GET',
      url: '/api/v1/branding-settings',
      headers: { authorization: bearer(director) },
    });
    expect(fetched.json().logoFilename).toBe('TKMR.png');
  });
});
