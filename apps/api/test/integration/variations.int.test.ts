// Integration tests — Variations (D-003 every-variation-to-Director, no threshold; D-021
// one-way decisions) against real Postgres. Guarded like the rest of the suite; RUN_DB_TESTS=1.
//
// NOTE on VAR-6 (branch scoping): variation:approve/reject is held ONLY by DIRECTOR and
// SYSTEM_ADMIN, and BOTH are CROSS_BRANCH_ROLES by design (D-003 intends Directors to oversee
// variations across branches). There is therefore no actor capable of approving/rejecting who
// is ALSO branch-restricted — a "denied cross-branch approve" test would be testing a
// combination that can't occur. Branch scoping IS meaningfully testable on the CREATE side
// (variation:create is held by branch-restricted OPS_SUPERVISOR too), so that's where VAR-6
// lives; the approve-side cross-branch case is a POSITIVE confirmation instead of a denial.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { buildApp } from '../../src/app.js';
import { signAccessToken } from '../../src/auth/tokens.js';

const run = process.env.RUN_DB_TESTS ? describe : describe.skip;
const SECRET = process.env.JWT_ACCESS_SECRET ?? 'test-secret';
const bearer = (u: { id: string; roles: string[]; branch: string }) =>
  `Bearer ${signAccessToken({ sub: u.id, roles: u.roles as any, branch: u.branch, mfaComplete: true }, SECRET)}`;

run('Variations (integration)', () => {
  // CI FIX (OPS finding, corrected mechanism): Vitest calls this describe callback's
  // synchronous body during collection EVEN when the suite is describe.skip'd — only the
  // registered beforeAll/it/afterAll bodies are actually skipped from running. PrismaClient
  // construction must therefore live INSIDE beforeAll, not here, or it executes unconditionally
  // (including in the "Unit tests" CI step where DATABASE_URL/RUN_DB_TESTS aren't set).
  let prisma: PrismaClient;
  let app: ReturnType<typeof buildApp>;

  let sup: any, director: any, admin: any;
  let joSG: any, joMY: any;
  let uniq: string;

  beforeAll(async () => {
    prisma = new PrismaClient();
    const presignPut = async () => ({ uploadUrl: 'http://minio/local', headers: {} });
    app = buildApp({ prisma, accessSecret: SECRET, presignPut });
    await app.ready();
    sup = await prisma.user.findUniqueOrThrow({ where: { email: 'ops@tkmr.local' } });       // SG, variation:create only
    director = await prisma.user.findUniqueOrThrow({ where: { email: 'director@tkmr.local' } }); // cross-branch, variation:approve/reject
    admin = await prisma.user.findUniqueOrThrow({ where: { email: 'admin@tkmr.local' } });       // cross-branch, everything

    uniq = Date.now().toString().slice(-9);
    const clientSG = await prisma.client.findFirstOrThrow({ where: { branch: 'SG', deletedAt: null } });
    const vesselSG = await prisma.vessel.findFirstOrThrow({ where: { deletedAt: null } });
    joSG = await prisma.jobOrder.create({
      data: {
        joNumber: `SG-VARTEST-${uniq}`, branch: 'SG', clientId: clientSG.id, vesselId: vesselSG.id,
        scopeSummary: 'Variation test fixture (SG)', origin: 'MANUAL',
        quotedAmountMinor: 200000, quotedCurrency: 'SGD', state: 'DRAFT', createdBy: sup.id,
      },
    });

    // Self-provisioned MY-branch JO for the create-side branch-scope test (VAR-6), independent
    // of other test files' fixtures.
    const clientMY = await prisma.client.upsert({
      where: { id: 'client-inttest-variations-my' },
      update: {},
      create: { id: 'client-inttest-variations-my', branch: 'MY', name: 'Variation-Test MY Client' },
    });
    const vesselMY = await prisma.vessel.upsert({
      where: { imoNumber: `6${uniq}` },
      update: {},
      create: { clientId: clientMY.id, imoNumber: `6${uniq}`, name: 'MV Variation Test MY' },
    });
    joMY = await prisma.jobOrder.create({
      data: {
        joNumber: `MY-VARTEST-${uniq}`, branch: 'MY', clientId: clientMY.id, vesselId: vesselMY.id,
        scopeSummary: 'Variation test fixture (MY)', origin: 'MANUAL',
        quotedAmountMinor: 150000, quotedCurrency: 'MYR', state: 'DRAFT', createdBy: admin.id,
      },
    });
  });
  afterAll(async () => { await app.close(); await prisma.$disconnect(); });

  it('VAR-1: CREATE variation -> 201 PROPOSED, AuditEntry written', async () => {
    const before = await prisma.auditEntry.count({ where: { entityType: 'Variation' } });
    const res = await app.inject({
      method: 'POST', url: `/api/v1/job-orders/${joSG.id}/variations`, headers: { authorization: bearer(sup) },
      payload: { reason: 'Additional scope requested by client', amountMinor: 50000, amountCurrency: 'SGD' },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.status).toBe('PROPOSED');
    expect(await prisma.auditEntry.count({ where: { entityType: 'Variation' } })).toBe(before + 1);
  });

  it('VAR-2: non-Director/Admin (Supervisor) cannot approve -> 403 FORBIDDEN (D-003)', async () => {
    const variation = await prisma.variation.findFirstOrThrow({ where: { jobOrderId: joSG.id, status: 'PROPOSED' } });
    const res = await app.inject({
      method: 'POST', url: `/api/v1/variations/${variation.id}/approve`, headers: { authorization: bearer(sup) },
      payload: { version: variation.version },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('FORBIDDEN');
  });

  it('VAR-3: Director APPROVES -> 200, status APPROVED, approverId set, audit written', async () => {
    const variation = await prisma.variation.findFirstOrThrow({ where: { jobOrderId: joSG.id, status: 'PROPOSED' } });
    const res = await app.inject({
      method: 'POST', url: `/api/v1/variations/${variation.id}/approve`, headers: { authorization: bearer(director) },
      payload: { version: variation.version },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe('APPROVED');
    expect(body.approverId).toBe(director.id);
    expect(await prisma.auditEntry.count({ where: { entityType: 'Variation', entityId: variation.id, action: 'APPROVE' } })).toBe(1);
  });

  it('VAR-7 (D-021): re-deciding an already-APPROVED variation -> 409 STATE_TRANSITION_INVALID, not VALIDATION_ERROR', async () => {
    const variation = await prisma.variation.findFirstOrThrow({ where: { jobOrderId: joSG.id, status: 'APPROVED' } });
    const res = await app.inject({
      method: 'POST', url: `/api/v1/variations/${variation.id}/reject`, headers: { authorization: bearer(director) },
      payload: { version: variation.version },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('STATE_TRANSITION_INVALID');
    // Confirm no side effect: still APPROVED, version unchanged.
    const fresh = await prisma.variation.findUniqueOrThrow({ where: { id: variation.id } });
    expect(fresh.status).toBe('APPROVED');
    expect(fresh.version).toBe(variation.version);
  });

  it('VAR-4: Director REJECTS a different (fresh) variation -> 200, status REJECTED, audit written', async () => {
    const created = await app.inject({
      method: 'POST', url: `/api/v1/job-orders/${joSG.id}/variations`, headers: { authorization: bearer(sup) },
      payload: { reason: 'Second variation for reject-path test', amountMinor: 25000, amountCurrency: 'SGD' },
    });
    const variation = created.json();
    const res = await app.inject({
      method: 'POST', url: `/api/v1/variations/${variation.id}/reject`, headers: { authorization: bearer(director) },
      payload: { version: variation.version, reason: 'Not justified' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('REJECTED');
    expect(await prisma.auditEntry.count({ where: { entityType: 'Variation', entityId: variation.id, action: 'REJECT' } })).toBe(1);
  });

  it('VAR-7 (D-021), REJECTED side: re-deciding an already-REJECTED variation -> 409 STATE_TRANSITION_INVALID', async () => {
    const variation = await prisma.variation.findFirstOrThrow({ where: { jobOrderId: joSG.id, status: 'REJECTED' } });
    const res = await app.inject({
      method: 'POST', url: `/api/v1/variations/${variation.id}/approve`, headers: { authorization: bearer(director) },
      payload: { version: variation.version },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('STATE_TRANSITION_INVALID');
  });

  it('VAR-5: stale version on approve -> 409 VERSION_CONFLICT (distinct from VAR-7\'s STATE_TRANSITION_INVALID)', async () => {
    const created = await app.inject({
      method: 'POST', url: `/api/v1/job-orders/${joSG.id}/variations`, headers: { authorization: bearer(sup) },
      payload: { reason: 'Third variation for version-conflict test', amountMinor: 10000, amountCurrency: 'SGD' },
    });
    const variation = created.json();
    const res = await app.inject({
      method: 'POST', url: `/api/v1/variations/${variation.id}/approve`, headers: { authorization: bearer(director) },
      payload: { version: variation.version + 1 }, // deliberately wrong, but status IS still PROPOSED
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('VERSION_CONFLICT'); // NOT STATE_TRANSITION_INVALID — different failure mode
  });

  it('VAR-6: branch scope on CREATE — SG Supervisor cannot propose a variation on a MY-branch JO -> 404 NOT_FOUND', async () => {
    const res = await app.inject({
      method: 'POST', url: `/api/v1/job-orders/${joMY.id}/variations`, headers: { authorization: bearer(sup) },
      payload: { reason: 'Should not be allowed', amountMinor: 1000, amountCurrency: 'MYR' },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('NOT_FOUND');
  });

  it('VAR-6 contrast: cross-branch role (Director) CAN approve a variation on the MY-branch JO (D-003 intends cross-branch Director oversight)', async () => {
    const created = await app.inject({
      method: 'POST', url: `/api/v1/job-orders/${joMY.id}/variations`, headers: { authorization: bearer(admin) }, // admin creates it (cross-branch, has variation:create too)
      payload: { reason: 'MY-branch variation for cross-branch approval test', amountMinor: 5000, amountCurrency: 'MYR' },
    });
    expect(created.statusCode).toBe(201);
    const variation = created.json();
    const res = await app.inject({
      method: 'POST', url: `/api/v1/variations/${variation.id}/approve`, headers: { authorization: bearer(director) }, // SG-based Director approving a MY variation
      payload: { version: variation.version },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('APPROVED');
  });
});
