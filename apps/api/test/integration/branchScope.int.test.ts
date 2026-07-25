// Integration tests — P1-2 branch scoping. Guarded like jobOrders.int.test.ts; enable with
// RUN_DB_TESTS=1 after `prisma migrate dev` + seed. Maps to ADR-7 / D-013 / RBAC-SCOPE-1/2.
//
// D-013: cross-branch DIRECT-ID access returns NOT_FOUND (never enumerates existence) and is
// checked BEFORE the version check (no version-oracle leak). BRANCH_SCOPE_DENIED is reserved
// for explicit cross-branch OPERATIONS a role can't perform (the sync-op path in routes/sync.ts),
// NOT for a direct-ID read/write across branches — that path is NOT_FOUND, full stop.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { buildApp } from '../../src/app.js';
import { signAccessToken } from '../../src/auth/tokens.js';

const run = process.env.RUN_DB_TESTS ? describe : describe.skip;
const SECRET = process.env.JWT_ACCESS_SECRET ?? 'test-secret';
const bearer = (u: { id: string; roles: string[]; branch: string }) =>
  `Bearer ${signAccessToken({ sub: u.id, roles: u.roles as any, branch: u.branch, mfaComplete: true }, SECRET)}`;

run('Branch scoping (integration)', () => {
  // CI FIX (OPS finding, corrected mechanism): Vitest calls this describe callback's
  // synchronous body during collection EVEN when the suite is describe.skip'd — only the
  // registered beforeAll/it/afterAll bodies are actually skipped from running. PrismaClient
  // construction must therefore live INSIDE beforeAll, not here, or it executes unconditionally
  // (including in the "Unit tests" CI step where DATABASE_URL/RUN_DB_TESTS aren't set).
  let prisma: PrismaClient;
  let app: ReturnType<typeof buildApp>;

  // supA = existing seeded Branch-SG supervisor (the "Branch A" actor).
  // director = existing seeded Branch-SG director — a CROSS_BRANCH_ROLE, used as a contrast
  // case to prove the NOT_FOUND above is genuine branch scoping, not a blanket bug.
  // Everything else (Branch-MY client/vessel/JO) is self-provisioned here, not added to the
  // shared seed, so this file doesn't affect fixtures other integration tests depend on.
  let supA: any, director: any, clientMY: any, joMY: any;

  beforeAll(async () => {
    prisma = new PrismaClient();
    const presignPut = async () => ({ uploadUrl: 'http://minio/local', headers: {} });
    app = buildApp({ prisma, accessSecret: SECRET, presignPut });
    await app.ready();
    supA = await prisma.user.findUniqueOrThrow({ where: { email: 'ops@tkmr.local' } }); // branch SG
    director = await prisma.user.findUniqueOrThrow({ where: { email: 'director@tkmr.local' } }); // branch SG, cross-branch role

    const contactMY = await prisma.contact.upsert({
      where: { id: 'ct-branchtest-my' },
      update: {},
      create: { id: 'ct-branchtest-my', name: 'MY Branch Test Contact', email: 'my-branch-test@example.com' },
    });
    clientMY = await prisma.client.upsert({
      where: { id: 'cl-branchtest-my' },
      update: {},
      create: { id: 'cl-branchtest-my', branch: 'MY', name: 'MY Branch Test Client', primaryContactId: contactMY.id },
    });
    const vesselMY = await prisma.vessel.upsert({
      where: { imoNumber: '9999001' },
      update: {},
      create: { clientId: clientMY.id, imoNumber: '9999001', name: 'MV Branch Test MY' },
    });
    joMY = await prisma.jobOrder.upsert({
      where: { joNumber: 'MY-2026-9001' },
      update: { state: 'DRAFT', version: 0, scopeSummary: 'Branch-scope test fixture' },
      create: {
        joNumber: 'MY-2026-9001', branch: 'MY', clientId: clientMY.id, vesselId: vesselMY.id,
        scopeSummary: 'Branch-scope test fixture', origin: 'MANUAL',
        quotedAmountMinor: 100000, quotedCurrency: 'MYR', state: 'DRAFT', createdBy: supA.id,
      },
    });
  });
  afterAll(async () => { await app.close(); await prisma.$disconnect(); });

  it('Branch-A actor reading a Branch-B Job Order by direct ID -> 404 NOT_FOUND (not BRANCH_SCOPE_DENIED)', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/v1/job-orders/${joMY.id}`, headers: { authorization: bearer(supA) } });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('NOT_FOUND');
  });

  it('Branch-A actor reading a Branch-B Client by direct ID -> 404 NOT_FOUND', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/v1/clients/${clientMY.id}`, headers: { authorization: bearer(supA) } });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('NOT_FOUND');
  });

  it('scope checked BEFORE version (no version-oracle leak): wrong version on a cross-branch JO PATCH still yields 404, never 409', async () => {
    const res = await app.inject({
      method: 'PATCH', url: `/api/v1/job-orders/${joMY.id}`,
      headers: { authorization: bearer(supA) },
      payload: { scopeSummary: 'attempted cross-branch edit', version: 999 }, // deliberately wrong
    });
    // If scope were checked AFTER version, a wrong version would leak a 409 (proving the row
    // exists with a different version) before the branch check ever ran. It must be 404.
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('NOT_FOUND');
  });

  it('scope checked BEFORE version, even with the CORRECT version supplied', async () => {
    const res = await app.inject({
      method: 'PATCH', url: `/api/v1/job-orders/${joMY.id}`,
      headers: { authorization: bearer(supA) },
      payload: { scopeSummary: 'attempted cross-branch edit', version: joMY.version }, // correct version
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('NOT_FOUND');
  });

  it('scope checked BEFORE version on Client PATCH too (same principle, different route)', async () => {
    const res = await app.inject({
      method: 'PATCH', url: `/api/v1/clients/${clientMY.id}`,
      headers: { authorization: bearer(supA) },
      payload: { name: 'attempted cross-branch edit', version: 999 },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('NOT_FOUND');
  });

  it('a CROSS_BRANCH_ROLE (Director) CAN read the Branch-B Job Order by direct ID (RBAC-CROSS-1 contrast case)', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/v1/job-orders/${joMY.id}`, headers: { authorization: bearer(director) } });
    expect(res.statusCode).toBe(200);
    expect(res.json().id).toBe(joMY.id);
  });

  it('the JO never actually left DRAFT/version 0 despite the failed cross-branch PATCH attempts (no side effect from a rejected op)', async () => {
    const fresh = await prisma.jobOrder.findUniqueOrThrow({ where: { id: joMY.id } });
    expect(fresh.version).toBe(joMY.version);
    expect(fresh.scopeSummary).toBe('Branch-scope test fixture');
  });
});
