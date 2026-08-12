// Integration smoke test for Mobile R-8 assigned delta. Guarded so unit runs stay DB-free.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { buildApp } from '../../src/app.js';
import { signAccessToken } from '../../src/auth/tokens.js';

const run = process.env.RUN_DB_TESTS ? describe : describe.skip;
const SECRET = process.env.JWT_ACCESS_SECRET ?? 'test-secret';
const bearer = (user: { id: string; roles: string[]; branch: string }) =>
  `Bearer ${signAccessToken({ sub: user.id, roles: user.roles as any, branch: user.branch, mfaComplete: true }, SECRET)}`;

run('Sync assigned delta (integration)', () => {
  let prisma: PrismaClient;
  let app: ReturnType<typeof buildApp>;
  let tech: any;

  beforeAll(async () => {
    prisma = new PrismaClient();
    const presignPut = async () => ({ uploadUrl: 'http://minio/local', headers: {} });
    app = buildApp({ prisma, accessSecret: SECRET, presignPut });
    await app.ready();
    tech = await prisma.user.findUniqueOrThrow({ where: { email: 'tech@tkmr.local' } });
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('returns assigned job delta and all child collections without a Prisma updatedAt runtime error', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/sync/assigned?since=1970-01-01T00:00:00.000Z',
      headers: { authorization: bearer(tech) },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(typeof body.cursor).toBe('string');
    expect(Array.isArray(body.jobOrders)).toBe(true);
    expect(body.children).toBeTruthy();
    expect(Array.isArray(body.children.worklogs)).toBe(true);
    expect(Array.isArray(body.children.photos)).toBe(true);
    expect(Array.isArray(body.children.observations)).toBe(true);
    expect(Array.isArray(body.children.checklists)).toBe(true);
    expect(Array.isArray(body.children.materials)).toBe(true);
    expect(Array.isArray(body.children.esignatures)).toBe(true);
  });
});
