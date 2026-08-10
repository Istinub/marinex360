// Integration tests — P1-4 Vessel APIs (IMO uniqueness, branch scoping via owning Client,
// service history) against real Postgres. Guarded like the rest of the suite; RUN_DB_TESTS=1.
// Maps to FR-02 (IMO unique)/FR-03 (service history), and reuses the D-018/D-019 scope
// conventions already proven: scope-before-version, NOT_FOUND masking, cross-branch-role bypass.
//
// RE-RUNNABLE BY DESIGN: imoNumber (the one hard @unique constraint here) gets a per-run
// suffix; the MY-branch Client fixture is a fixed-id upsert, matching the lessons learned
// earlier this session (wrong-field upserts / hard-coded uniques both caused real failures).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { buildApp } from '../../src/app.js';
import { signAccessToken } from '../../src/auth/tokens.js';

const run = process.env.RUN_DB_TESTS ? describe : describe.skip;
const SECRET = process.env.JWT_ACCESS_SECRET ?? 'test-secret';
const bearer = (u: { id: string; roles: string[]; branch: string }) =>
  `Bearer ${signAccessToken({ sub: u.id, roles: u.roles as any, branch: u.branch, mfaComplete: true }, SECRET)}`;

run('Vessel APIs (integration)', () => {
  // CI FIX (OPS finding, corrected mechanism): Vitest calls this describe callback's
  // synchronous body during collection EVEN when the suite is describe.skip'd — only the
  // registered beforeAll/it/afterAll bodies are actually skipped from running. PrismaClient
  // construction must therefore live INSIDE beforeAll, not here, or it executes unconditionally
  // (including in the "Unit tests" CI step where DATABASE_URL/RUN_DB_TESTS aren't set).
  let prisma: PrismaClient;
  let app: ReturnType<typeof buildApp>;

  // sup = SG OPS_SUPERVISOR (vessel:read/write, NOT cross-branch)
  // admin = SG SYSTEM_ADMIN (vessel:write AND cross-branch — the correct role for the
  //   cross-branch-CREATE contrast case; DIRECTOR has vessel:read only, not vessel:write,
  //   so using Director here would produce a false-negative 403-from-RBAC, not from scope).
  // director = SG DIRECTOR (vessel:read only, cross-branch — correct for the READ contrast case).
  let sup: any, admin: any, director: any;
  let clientSG: any, clientMY: any;
  let imoUniq: string;

  beforeAll(async () => {
    prisma = new PrismaClient();
    const presignPut = async () => ({ uploadUrl: 'http://minio/local', headers: {} });
    app = buildApp({ prisma, accessSecret: SECRET, presignPut });
    await app.ready();
    sup = await prisma.user.findUniqueOrThrow({ where: { email: 'ops@tkmr.local' } });
    admin = await prisma.user.findUniqueOrThrow({ where: { email: 'admin@tkmr.local' } });
    director = await prisma.user.findUniqueOrThrow({ where: { email: 'director@tkmr.local' } });
    clientSG = await prisma.client.findFirstOrThrow({ where: { branch: 'SG', deletedAt: null } });

    // Self-provisioned MY-branch client fixture, independent of other test files (fixed-id
    // upsert so repeated runs never collide and never depend on branchScope.int.test.ts having run).
    clientMY = await prisma.client.upsert({
      where: { id: 'client-inttest-vessels-my' },
      update: {},
      create: { id: 'client-inttest-vessels-my', branch: 'MY', name: 'Vessel-Test MY Client' },
    });

    imoUniq = Date.now().toString().slice(-9);
  });
  afterAll(async () => { await app.close(); await prisma.$disconnect(); });

  it('CREATE Vessel for an SG Client (same-branch actor) — 201, AuditEntry written', async () => {
    const before = await prisma.auditEntry.count({ where: { entityType: 'Vessel' } });
    const res = await app.inject({
      method: 'POST', url: '/api/v1/vessels', headers: { authorization: bearer(sup) },
      payload: { clientId: clientSG.id, imoNumber: `9${imoUniq}`, name: 'MV Integration Test', type: 'Bulk Carrier', flag: 'SG' },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.imoNumber).toBe(`9${imoUniq}`);
    expect(await prisma.auditEntry.count({ where: { entityType: 'Vessel' } })).toBe(before + 1);
  });

  it('FR-02 / D-024: duplicate imoNumber is rejected -> 400 VALIDATION_ERROR with structured details (not just a message string)', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/v1/vessels', headers: { authorization: bearer(sup) },
      payload: { clientId: clientSG.id, imoNumber: `9${imoUniq}`, name: 'MV Duplicate Attempt' }, // same IMO as above
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
    expect(res.json().error.message).toMatch(/already registered/);
    // D-024: machine-readable details so WEB doesn't have to string-match the message.
    expect(res.json().error.details).toEqual({ field: 'imoNumber', reason: 'duplicate' });
  });

  it('branch scope on CREATE: an SG actor cannot register a vessel against a MY Client -> 404 NOT_FOUND', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/v1/vessels', headers: { authorization: bearer(sup) },
      payload: { clientId: clientMY.id, imoNumber: `8${imoUniq}`, name: 'MV Should Not Register' },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('NOT_FOUND');
    // Confirm no row was actually created despite the attempt.
    expect(await prisma.vessel.findUnique({ where: { imoNumber: `8${imoUniq}` } })).toBeNull();
  });

  it('cross-branch role (SYSTEM_ADMIN) CAN register a vessel against a MY Client', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/v1/vessels', headers: { authorization: bearer(admin) },
      payload: { clientId: clientMY.id, imoNumber: `7${imoUniq}`, name: 'MV Admin Cross-Branch' },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().clientId).toBe(clientMY.id);
  });

  it('FR-03: service history — GET /vessels/:id/job-orders returns the vessel\'s JOs for a same-branch actor', async () => {
    const vessel = await prisma.vessel.findUniqueOrThrow({ where: { imoNumber: `9${imoUniq}` } }); // the SG vessel from test 1
    const jo = await prisma.jobOrder.create({
      data: {
        joNumber: `SG-VESSELTEST-${imoUniq}`, branch: 'SG', clientId: clientSG.id, vesselId: vessel.id,
        scopeSummary: 'Vessel service-history fixture', origin: 'MANUAL',
        quotedAmountMinor: 50000, quotedCurrency: 'SGD', state: 'DRAFT', createdBy: sup.id,
      },
    });
    const res = await app.inject({ method: 'GET', url: `/api/v1/vessels/${vessel.id}/job-orders`, headers: { authorization: bearer(sup) } });
    expect(res.statusCode).toBe(200);
    const jos = res.json();
    expect(jos.some((j: any) => j.id === jo.id)).toBe(true);
  });

  it('branch scope on service history: an SG actor cannot read a MY vessel\'s job-orders -> 404 NOT_FOUND', async () => {
    const vesselMY = await prisma.vessel.findUniqueOrThrow({ where: { imoNumber: `7${imoUniq}` } }); // MY vessel from the admin-create test
    const res = await app.inject({ method: 'GET', url: `/api/v1/vessels/${vesselMY.id}/job-orders`, headers: { authorization: bearer(sup) } });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('NOT_FOUND');
  });

  it('cross-branch role (Director, vessel:read only) CAN read the MY vessel\'s job-orders', async () => {
    const vesselMY = await prisma.vessel.findUniqueOrThrow({ where: { imoNumber: `7${imoUniq}` } });
    const res = await app.inject({ method: 'GET', url: `/api/v1/vessels/${vesselMY.id}/job-orders`, headers: { authorization: bearer(director) } });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json())).toBe(true);
  });

  it('GET /vessels/:id/job-orders for a vessel with no JOs yet returns an empty array, not an error', async () => {
    const vesselMY = await prisma.vessel.findUniqueOrThrow({ where: { imoNumber: `7${imoUniq}` } }); // has no JOs created against it
    const res = await app.inject({ method: 'GET', url: `/api/v1/vessels/${vesselMY.id}/job-orders`, headers: { authorization: bearer(admin) } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });

  it('GET /vessels/:id/job-orders for a nonexistent vessel id -> 404 NOT_FOUND', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/vessels/00000000-0000-0000-0000-000000000000/job-orders', headers: { authorization: bearer(sup) } });
    expect(res.statusCode).toBe(404);
  });

  // ---- D-029 / CC-10: GET /vessels flat branch-scoped list + optional ?clientId= filter ----
  // Self-contained: creates one known SG vessel and one known MY vessel via upsert (idempotent on
  // imoNumber) so these tests don't depend on the create-tests above having run first.
  it('D-029: SG actor sees SG vessels but NOT MY vessels (branch-scoped via owning Client)', async () => {
    const sgVessel = await prisma.vessel.upsert({
      where: { imoNumber: `1${imoUniq}` }, update: {},
      create: { clientId: clientSG.id, imoNumber: `1${imoUniq}`, name: 'MV List Test SG' },
    });
    const myVessel = await prisma.vessel.upsert({
      where: { imoNumber: `2${imoUniq}` }, update: {},
      create: { clientId: clientMY.id, imoNumber: `2${imoUniq}`, name: 'MV List Test MY' },
    });
    const res = await app.inject({ method: 'GET', url: '/api/v1/vessels', headers: { authorization: bearer(sup) } });
    expect(res.statusCode).toBe(200);
    const imos = res.json().map((v: any) => v.imoNumber);
    expect(imos).toContain(sgVessel.imoNumber);
    expect(imos).not.toContain(myVessel.imoNumber); // MY vessel invisible to an SG-scoped caller
  });

  it('D-029: cross-branch role (Director) sees vessels across ALL branches', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/vessels', headers: { authorization: bearer(director) } });
    expect(res.statusCode).toBe(200);
    const imos = res.json().map((v: any) => v.imoNumber);
    expect(imos).toContain(`1${imoUniq}`); // SG
    expect(imos).toContain(`2${imoUniq}`); // MY — visible to cross-branch role
  });

  it('D-029: ?clientId= filter narrows the list to that client (within scope)', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/v1/vessels?clientId=${clientSG.id}`, headers: { authorization: bearer(sup) } });
    expect(res.statusCode).toBe(200);
    const rows = res.json();
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((v: any) => v.clientId === clientSG.id)).toBe(true);
  });

  it('D-029: SG actor filtering by a MY clientId gets [] (empty, not 404 — list-endpoint scope convention)', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/v1/vessels?clientId=${clientMY.id}`, headers: { authorization: bearer(sup) } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]); // branch join matches nothing; not a 404
  });

  it('D-029: soft-deleted vessels are excluded from the list', async () => {
    const doomed = await prisma.vessel.upsert({
      where: { imoNumber: `3${imoUniq}` }, update: { deletedAt: new Date() },
      create: { clientId: clientSG.id, imoNumber: `3${imoUniq}`, name: 'MV Soon Deleted', deletedAt: new Date() },
    });
    const res = await app.inject({ method: 'GET', url: '/api/v1/vessels', headers: { authorization: bearer(sup) } });
    expect(res.json().map((v: any) => v.imoNumber)).not.toContain(doomed.imoNumber);
  });
});
