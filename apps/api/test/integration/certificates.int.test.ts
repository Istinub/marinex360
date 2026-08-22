// Integration tests for P3-6 certificate metadata routes. Guarded so unit runs stay DB-free.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { buildApp } from '../../src/app.js';
import { signAccessToken } from '../../src/auth/tokens.js';

const run = process.env.RUN_DB_TESTS ? describe : describe.skip;
const SECRET = process.env.JWT_ACCESS_SECRET ?? 'test-secret';
const bearer = (u: { id: string; roles: string[]; branch: string }) =>
  `Bearer ${signAccessToken({ sub: u.id, roles: u.roles as any, branch: u.branch, mfaComplete: true }, SECRET)}`;

run('Certificates (integration)', () => {
  let prisma: PrismaClient;
  let app: ReturnType<typeof buildApp>;
  let supSG: any;
  let supMY: any;
  let techSG: any;
  let techMY: any;
  let uniq: string;

  beforeAll(async () => {
    prisma = new PrismaClient();
    const presignPut = async () => ({ uploadUrl: 'http://minio.local/upload', headers: {} });
    app = buildApp({ prisma, accessSecret: SECRET, presignPut });
    await app.ready();
    uniq = Date.now().toString().slice(-9);
    supSG = await prisma.user.findUniqueOrThrow({ where: { email: 'ops@tkmr.local' } });
    supMY = await prisma.user.upsert({
      where: { email: `certs-my-${uniq}@tkmr.local` },
      update: {},
      create: {
        email: `certs-my-${uniq}@tkmr.local`,
        name: 'MY Certificate Ops',
        passwordHash: 'x',
        roles: ['OPS_SUPERVISOR'],
        branch: 'MY',
      },
    });
    techSG = await prisma.user.create({
      data: {
        email: `certs-tech-sg-${uniq}@tkmr.local`,
        name: 'SG Certificate Tech',
        passwordHash: 'x',
        roles: ['TECHNICIAN'],
        branch: 'SG',
      },
    });
    techMY = await prisma.user.create({
      data: {
        email: `certs-tech-my-${uniq}@tkmr.local`,
        name: 'MY Certificate Tech',
        passwordHash: 'x',
        roles: ['TECHNICIAN'],
        branch: 'MY',
      },
    });
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('creates, lists, and soft-deletes a TECHNICIAN certificate scoped through User.branch (D-043)', async () => {
    const create = await app.inject({
      method: 'POST',
      url: '/api/v1/certificates',
      headers: { authorization: bearer(supSG) },
      payload: {
        ownerType: 'TECHNICIAN',
        ownerId: techSG.id,
        certType: 'BOSIET',
        identifier: 'BOS-123',
        issuedAt: '2026-01-01T00:00:00Z',
        expiresAt: '2026-12-31T00:00:00Z',
        s3Key: 'certificates/bosiet.pdf',
      },
    });
    expect(create.statusCode).toBe(201);
    const certificate = create.json();
    expect(certificate).toMatchObject({ ownerType: 'TECHNICIAN', ownerId: techSG.id, certType: 'BOSIET' });

    const list = await app.inject({
      method: 'GET',
      url: `/api/v1/certificates?ownerType=TECHNICIAN&ownerId=${techSG.id}`,
      headers: { authorization: bearer(supSG) },
    });
    expect(list.statusCode).toBe(200);
    expect(list.json().some((row: any) => row.id === certificate.id)).toBe(true);

    const crossBranch = await app.inject({
      method: 'GET',
      url: `/api/v1/certificates?ownerType=TECHNICIAN&ownerId=${techSG.id}`,
      headers: { authorization: bearer(supMY) },
    });
    expect(crossBranch.statusCode).toBe(404);
    expect(crossBranch.json().error.code).toBe('NOT_FOUND');

    const del = await app.inject({
      method: 'DELETE',
      url: `/api/v1/certificates/${certificate.id}`,
      headers: { authorization: bearer(supSG) },
    });
    expect(del.statusCode).toBe(200);
    expect(del.json()).toEqual({ id: certificate.id, deleted: true });
    const deleted = await prisma.certificate.findUniqueOrThrow({ where: { id: certificate.id } });
    expect(deleted.deletedAt).not.toBeNull();
  });

  it('treats COMPANY certificates as unscoped for office roles (D-043)', async () => {
    const create = await app.inject({
      method: 'POST',
      url: '/api/v1/certificates',
      headers: { authorization: bearer(supSG) },
      payload: {
        ownerType: 'COMPANY',
        ownerId: 'TKMR',
        certType: 'ISM DOC',
        expiresAt: '2026-12-31T00:00:00Z',
      },
    });
    expect(create.statusCode).toBe(201);
    const certificate = create.json();

    const listFromMY = await app.inject({
      method: 'GET',
      url: '/api/v1/certificates?ownerType=COMPANY&ownerId=TKMR',
      headers: { authorization: bearer(supMY) },
    });
    expect(listFromMY.statusCode).toBe(200);
    expect(listFromMY.json().some((row: any) => row.id === certificate.id)).toBe(true);
  });

  it('masks another branch TECHNICIAN owner as NOT_FOUND', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/certificates?ownerType=TECHNICIAN&ownerId=${techMY.id}`,
      headers: { authorization: bearer(supSG) },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('NOT_FOUND');
  });
});
