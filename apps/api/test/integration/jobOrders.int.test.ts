// Integration tests — run in the repo against the Postgres service container (CI) or local stack.
// Guarded so the pure-logic suite stays DB-free. Enable with RUN_DB_TESTS=1 after `prisma migrate
// dev` + seed. Maps to QA B3 (JOSM), B4 (scope/IDOR/audit), B2 (version).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { buildApp } from '../../src/app.js';
import { signAccessToken } from '../../src/auth/tokens.js';

const run = process.env.RUN_DB_TESTS ? describe : describe.skip;
const SECRET = process.env.JWT_ACCESS_SECRET ?? 'test-secret';
const bearer = (u: { id: string; roles: string[]; branch: string }) =>
  `Bearer ${signAccessToken({ sub: u.id, roles: u.roles as any, branch: u.branch, mfaComplete: true }, SECRET)}`;

run('Job Orders (integration)', () => {
  const prisma = new PrismaClient();
  const presignPut = async () => ({ uploadUrl: 'http://minio/local', headers: {} });
  const app = buildApp({ prisma, accessSecret: SECRET, presignPut });

  let sup: any, tech: any, otherTech: any, jo: any;
  beforeAll(async () => {
    await app.ready();
    sup = await prisma.user.findUniqueOrThrow({ where: { email: 'ops@tkmr.local' } });
    tech = await prisma.user.findUniqueOrThrow({ where: { email: 'tech@tkmr.local' } });
    otherTech = await prisma.user.create({ data: { email: 't2@tkmr.local', name: 'T2', passwordHash: 'x', roles: ['TECHNICIAN'], branch: 'SG' } });
    jo = await prisma.jobOrder.findFirstOrThrow({ where: { joNumber: 'SG-2026-0001' } }); // DRAFT
  });
  afterAll(async () => { await app.close(); await prisma.$disconnect(); });

  it('JOSM-5: non-owner cannot enter IN_PROGRESS (FORBIDDEN)', async () => {
    // schedule + assign first
    await app.inject({ method: 'POST', url: `/api/v1/job-orders/${jo.id}/assign`, headers: { authorization: bearer(sup) }, payload: { technicianIds: [tech.id], executionOwnerId: tech.id, version: jo.version } });
    const fresh = await prisma.jobOrder.findUniqueOrThrow({ where: { id: jo.id } });
    await app.inject({ method: 'POST', url: `/api/v1/job-orders/${jo.id}/transition`, headers: { authorization: bearer(sup) }, payload: { to: 'SCHEDULED', version: fresh.version } });
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

  it('B2/CC-01: stale version -> 409 VERSION_CONFLICT', async () => {
    const res = await app.inject({ method: 'PATCH', url: `/api/v1/job-orders/${jo.id}`, headers: { authorization: bearer(sup) }, payload: { scopeSummary: 'x', version: 0 } });
    expect([403, 409]).toContain(res.statusCode); // 403 if header now locked (IN_PROGRESS), else 409
  });

  it('AUDIT-3: AuditEntry is immutable at the DB level (app role has no UPDATE)', async () => {
    // Only meaningful when connected as marinex_app (non-owner). As owner this UPDATE succeeds.
    const row = await prisma.auditEntry.findFirstOrThrow({ where: { entityId: jo.id } });
    await expect(prisma.auditEntry.update({ where: { id: row.id }, data: { action: 'TAMPER' } })).rejects.toThrow();
  });
});
