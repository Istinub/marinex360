// Integration tests — run in the repo against the Postgres service container (CI) or local stack.
// Guarded so the pure-logic suite stays DB-free. Enable with RUN_DB_TESTS=1 after `prisma migrate
// dev` + seed. Maps to QA B3 (JOSM), B4 (scope/IDOR/audit), B2 (version).
//
// RE-RUNNABLE BY DESIGN: this suite provisions its OWN dedicated Job Order via fixed-id upsert
// and drives it through the lifecycle, so it never depends on (or corrupts) the shared seeded
// SG-2026-0001. Running it repeatedly against a persistent DB needs no `prisma migrate reset`.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { buildApp } from '../../src/app.js';
import { signAccessToken } from '../../src/auth/tokens.js';

const run = process.env.RUN_DB_TESTS ? describe : describe.skip;
const SECRET = process.env.JWT_ACCESS_SECRET ?? 'test-secret';
const bearer = (u: { id: string; roles: string[]; branch: string }) =>
  `Bearer ${signAccessToken({ sub: u.id, roles: u.roles as any, branch: u.branch, mfaComplete: true }, SECRET)}`;

// Fixed id so every run reuses the same JO fixture row instead of creating duplicates.
const JO_ID = 'jo-inttest-jobs';

run('Job Orders (integration)', () => {
  // CI FIX (OPS finding, corrected mechanism): Vitest calls this describe callback's
  // synchronous body during collection EVEN when the suite is describe.skip'd — only the
  // registered beforeAll/it/afterAll bodies are actually skipped from running. PrismaClient
  // construction must therefore live INSIDE beforeAll, not here, or it executes unconditionally
  // (including in the "Unit tests" CI step where DATABASE_URL/RUN_DB_TESTS aren't set).
  let prisma: PrismaClient;
  let app: ReturnType<typeof buildApp>;

  let sup: any, tech: any, otherTech: any, jo: any;

  beforeAll(async () => {
    prisma = new PrismaClient();
    const presignPut = async () => ({ uploadUrl: 'http://minio/local', headers: {} });
    app = buildApp({ prisma, accessSecret: SECRET, presignPut });
    await app.ready();
    sup = await prisma.user.findUniqueOrThrow({ where: { email: 'ops@tkmr.local' } });
    tech = await prisma.user.findUniqueOrThrow({ where: { email: 'tech@tkmr.local' } });
    otherTech = await prisma.user.upsert({
      where: { email: 't2@tkmr.local' },
      update: {},
      create: { email: 't2@tkmr.local', name: 'T2', passwordHash: 'x', roles: ['TECHNICIAN'], branch: 'SG' },
    });

    // Dedicated JO for this suite. If a prior run left it mid-lifecycle, reset it to a clean
    // DRAFT/version-0 baseline so the assertions below start from a known state every time.
    const seedClient = await prisma.client.findFirstOrThrow({ where: { branch: 'SG', deletedAt: null } });
    const seedVessel = await prisma.vessel.findFirstOrThrow({ where: { deletedAt: null } });
    jo = await prisma.jobOrder.upsert({
      where: { id: JO_ID },
      update: { state: 'DRAFT', version: 0, assignedTechnicianIds: [], executionOwnerId: null },
      create: {
        id: JO_ID, joNumber: 'SG-INTTEST-JOBS', branch: 'SG', clientId: seedClient.id, vesselId: seedVessel.id,
        scopeSummary: 'Job Orders integration fixture', origin: 'MANUAL',
        quotedAmountMinor: 100000, quotedCurrency: 'SGD', state: 'DRAFT', createdBy: sup.id,
      },
    });
    // NOTE: JobStatusHistory is intentionally append-only / DB-immutable (D-006, AUDIT-3) —
    // once the app runtime connects as marinex_app (S0-9), a deleteMany here is correctly
    // REJECTED at the DB level. Accumulated history rows across repeated runs are harmless:
    // this suite's only history assertion is `toBeGreaterThan(0)`, and it never exercises the
    // resume-from-ON_HOLD path that depends on history ordering.
    jo = await prisma.jobOrder.findUniqueOrThrow({ where: { id: JO_ID } });
  });
  afterAll(async () => { await app.close(); await prisma.$disconnect(); });

  it('JOSM-5: non-owner cannot enter IN_PROGRESS (FORBIDDEN)', async () => {
    // assign the real tech, move DRAFT -> SCHEDULED, then have a DIFFERENT tech attempt IN_PROGRESS
    const a = await app.inject({ method: 'POST', url: `/api/v1/job-orders/${jo.id}/assign`, headers: { authorization: bearer(sup) }, payload: { technicianIds: [tech.id], executionOwnerId: tech.id, version: jo.version } });
    expect(a.statusCode).toBe(200);
    const assigned = await prisma.jobOrder.findUniqueOrThrow({ where: { id: jo.id } });
    const s = await app.inject({ method: 'POST', url: `/api/v1/job-orders/${jo.id}/transition`, headers: { authorization: bearer(sup) }, payload: { to: 'SCHEDULED', version: assigned.version } });
    expect(s.statusCode).toBe(200);
    const sched = await prisma.jobOrder.findUniqueOrThrow({ where: { id: jo.id } });
    const res = await app.inject({ method: 'POST', url: `/api/v1/job-orders/${jo.id}/transition`, headers: { authorization: bearer(otherTech) }, payload: { to: 'IN_PROGRESS', version: sched.version } });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('FORBIDDEN');
  });

  it('JOSM-1 + AUDIT-1: owner advances; JobStatusHistory + AuditEntry rows written', async () => {
    const sched = await prisma.jobOrder.findUniqueOrThrow({ where: { id: jo.id } });
    const before = await prisma.auditEntry.count({ where: { entityId: jo.id } });
    const res = await app.inject({ method: 'POST', url: `/api/v1/job-orders/${jo.id}/transition`, headers: { authorization: bearer(tech) }, payload: { to: 'IN_PROGRESS', version: sched.version } });
    expect(res.statusCode).toBe(200);
    expect(await prisma.auditEntry.count({ where: { entityId: jo.id } })).toBe(before + 1);
    expect(await prisma.jobStatusHistory.count({ where: { jobOrderId: jo.id, toState: 'IN_PROGRESS' } })).toBeGreaterThan(0);
  });

  it('B2/CC-01: header edit on an IN_PROGRESS job is rejected (locked) or version-conflicts', async () => {
    const res = await app.inject({ method: 'PATCH', url: `/api/v1/job-orders/${jo.id}`, headers: { authorization: bearer(sup) }, payload: { scopeSummary: 'x', version: 0 } });
    expect([403, 409]).toContain(res.statusCode); // 403 header-locked (now IN_PROGRESS), else 409 stale version
  });

  it('AUDIT-3: AuditEntry is immutable at the DB level (app role has no UPDATE)', async () => {
    // Only a TRUE guarantee when connected as marinex_app (non-owner). As the owner role this
    // UPDATE succeeds, so this assertion is meaningful only post-S0-9 runtime cutover.
    const row = await prisma.auditEntry.findFirstOrThrow({ where: { entityId: jo.id } });
    await expect(prisma.auditEntry.update({ where: { id: row.id }, data: { action: 'TAMPER' } })).rejects.toThrow();
  });

  it('D-006: JobStatusHistory.reason is persisted as a first-class column on side transitions', async () => {
    const fixture = await prisma.jobOrder.create({
      data: {
        joNumber: `SG-INTTEST-REASON-${Date.now()}`,
        branch: 'SG',
        clientId: jo.clientId,
        vesselId: jo.vesselId,
        scopeSummary: 'JobStatusHistory reason fixture',
        origin: 'MANUAL',
        quotedAmountMinor: 100000,
        quotedCurrency: 'SGD',
        state: 'SCHEDULED',
        createdBy: sup.id,
        assignedTechnicianIds: [tech.id],
        executionOwnerId: tech.id,
      },
    });

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/job-orders/${fixture.id}/transition`,
      headers: { authorization: bearer(sup) },
      payload: { to: 'ON_HOLD', version: fixture.version, reason: 'Awaiting parts delivery' },
    });

    expect(res.statusCode).toBe(200);
    const history = await prisma.jobStatusHistory.findFirstOrThrow({
      where: { jobOrderId: fixture.id, toState: 'ON_HOLD' },
      orderBy: { at: 'desc' },
    });
    expect(history.reason).toBe('Awaiting parts delivery');
  });

  it('GET /job-orders/:id includes variations inline (fixes WEB not-appearing bug)', async () => {
    const fixture = await prisma.jobOrder.create({
      data: {
        joNumber: `SG-INTTEST-VARIATIONS-${Date.now()}`,
        branch: 'SG',
        clientId: jo.clientId,
        vesselId: jo.vesselId,
        scopeSummary: 'Inline variations fixture',
        origin: 'MANUAL',
        quotedAmountMinor: 100000,
        quotedCurrency: 'SGD',
        state: 'DRAFT',
        createdBy: sup.id,
      },
    });
    const created = await app.inject({
      method: 'POST',
      url: `/api/v1/job-orders/${fixture.id}/variations`,
      headers: { authorization: bearer(sup) },
      payload: { reason: 'Regression test for missing variations in JO detail', amountMinor: 1000, amountCurrency: 'SGD' },
    });
    expect(created.statusCode).toBe(201);

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/job-orders/${fixture.id}`,
      headers: { authorization: bearer(sup) },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body.variations)).toBe(true);
    expect(body.variations.some((v: any) => v.id === created.json().id)).toBe(true);
  });
});
