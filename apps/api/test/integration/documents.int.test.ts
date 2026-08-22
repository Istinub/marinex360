// Integration tests for P3-6 document metadata routes. Guarded so unit runs stay DB-free.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { buildApp } from '../../src/app.js';
import { signAccessToken } from '../../src/auth/tokens.js';

const run = process.env.RUN_DB_TESTS ? describe : describe.skip;
const SECRET = process.env.JWT_ACCESS_SECRET ?? 'test-secret';
const bearer = (u: { id: string; roles: string[]; branch: string }) =>
  `Bearer ${signAccessToken({ sub: u.id, roles: u.roles as any, branch: u.branch, mfaComplete: true }, SECRET)}`;

run('Documents (integration)', () => {
  let prisma: PrismaClient;
  let app: ReturnType<typeof buildApp>;
  let supSG: any;
  let supMY: any;
  let clientSG: any;
  let clientMY: any;
  let uniq: string;

  beforeAll(async () => {
    prisma = new PrismaClient();
    const presignPut = async ({ key, contentType }: { key: string; contentType: string }) => ({
      uploadUrl: `http://minio.local/${key}`,
      headers: { 'Content-Type': contentType },
    });
    app = buildApp({ prisma, accessSecret: SECRET, presignPut });
    await app.ready();
    uniq = Date.now().toString().slice(-9);
    supSG = await prisma.user.findUniqueOrThrow({ where: { email: 'ops@tkmr.local' } });
    supMY = await prisma.user.upsert({
      where: { email: `docs-my-${uniq}@tkmr.local` },
      update: {},
      create: {
        email: `docs-my-${uniq}@tkmr.local`,
        name: 'MY Document Ops',
        passwordHash: 'x',
        roles: ['OPS_SUPERVISOR'],
        branch: 'MY',
      },
    });
    clientSG = await prisma.client.create({ data: { branch: 'SG', name: `Docs SG Client ${uniq}` } });
    clientMY = await prisma.client.create({ data: { branch: 'MY', name: `Docs MY Client ${uniq}` } });
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('presign -> create -> list -> replace -> soft-delete lifecycle for a branch-scoped owner', async () => {
    const presign = await app.inject({
      method: 'POST',
      url: '/api/v1/documents/presign',
      headers: { authorization: bearer(supSG) },
      payload: { ownerType: 'CLIENT', ownerId: clientSG.id, filename: 'class-certificate.pdf', mimeType: 'application/pdf' },
    });
    expect(presign.statusCode).toBe(200);
    const presigned = presign.json();
    expect(presigned).toMatchObject({ method: 'PUT', headers: { 'Content-Type': 'application/pdf' } });
    expect(presigned.s3Key).toContain(`/documents/client/${clientSG.id}/`);

    const create = await app.inject({
      method: 'POST',
      url: '/api/v1/documents',
      headers: { authorization: bearer(supSG) },
      payload: {
        ownerType: 'CLIENT',
        ownerId: clientSG.id,
        filename: 'class-certificate.pdf',
        mimeType: 'application/pdf',
        s3Key: presigned.s3Key,
      },
    });
    expect(create.statusCode).toBe(201);
    const document = create.json();
    expect(document).toMatchObject({ ownerType: 'CLIENT', ownerId: clientSG.id, filename: 'class-certificate.pdf' });

    const list = await app.inject({
      method: 'GET',
      url: `/api/v1/documents?ownerType=CLIENT&ownerId=${clientSG.id}`,
      headers: { authorization: bearer(supSG) },
    });
    expect(list.statusCode).toBe(200);
    expect(list.json().some((row: any) => row.id === document.id)).toBe(true);

    const replacePresign = await app.inject({
      method: 'POST',
      url: '/api/v1/documents/presign',
      headers: { authorization: bearer(supSG) },
      payload: { ownerType: 'CLIENT', ownerId: clientSG.id, filename: 'class-certificate-v2.pdf', mimeType: 'application/pdf' },
    });
    expect(replacePresign.statusCode).toBe(200);

    const replace = await app.inject({
      method: 'POST',
      url: `/api/v1/documents/${document.id}/replace`,
      headers: { authorization: bearer(supSG) },
      payload: { filename: 'class-certificate-v2.pdf', mimeType: 'application/pdf', s3Key: replacePresign.json().s3Key },
    });
    expect(replace.statusCode).toBe(201);
    const replacement = replace.json();
    expect(replacement.id).not.toBe(document.id);

    const old = await prisma.document.findUniqueOrThrow({ where: { id: document.id } });
    expect(old.deletedAt).not.toBeNull();

    const del = await app.inject({
      method: 'DELETE',
      url: `/api/v1/documents/${replacement.id}`,
      headers: { authorization: bearer(supSG) },
    });
    expect(del.statusCode).toBe(200);
    expect(del.json()).toEqual({ id: replacement.id, deleted: true });
    const deleted = await prisma.document.findUniqueOrThrow({ where: { id: replacement.id } });
    expect(deleted.deletedAt).not.toBeNull();
  });

  it('masks cross-branch document owner access as NOT_FOUND', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/documents?ownerType=CLIENT&ownerId=${clientMY.id}`,
      headers: { authorization: bearer(supSG) },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('NOT_FOUND');
  });

  it('lets a same-branch owner list return an empty array', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/documents?ownerType=CLIENT&ownerId=${clientMY.id}`,
      headers: { authorization: bearer(supMY) },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });
});
