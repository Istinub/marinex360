// Integration tests — P1-3 CRM (Client + Contact) against real Postgres. Guarded like
// jobOrders.int.test.ts; enable with RUN_DB_TESTS=1. Maps to OD-03 (personal data referenced
// by id, not duplicated), SOFTDEL-1 (soft-delete only, row survives at the DB), and D-019
// (Contact join-based branch scoping: no `branch` column on Contact by design, but
// GET/PATCH /contacts/:id is scoped via "is this Contact primaryContactId for a Client in the
// caller's branch?" for non-cross-branch roles; DIRECTOR/SYSTEM_ADMIN unrestricted).
//
// RE-RUNNABLE BY DESIGN: fixtures upsert by their real unique keys (email), not fixed ids
// where a schema unique constraint would collide otherwise.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { buildApp } from '../../src/app.js';
import { signAccessToken } from '../../src/auth/tokens.js';

const run = process.env.RUN_DB_TESTS ? describe : describe.skip;
const SECRET = process.env.JWT_ACCESS_SECRET ?? 'test-secret';
const bearer = (u: { id: string; roles: string[]; branch: string }) =>
  `Bearer ${signAccessToken({ sub: u.id, roles: u.roles as any, branch: u.branch, mfaComplete: true }, SECRET)}`;

run('CRM: Client + Contact (integration)', () => {
  const prisma = new PrismaClient();
  const presignPut = async () => ({ uploadUrl: 'http://minio/local', headers: {} });
  const app = buildApp({ prisma, accessSecret: SECRET, presignPut });

  let sup: any, director: any, supMY: any;
  let contactId: string, contactVersion: number;
  let clientId: string, clientVersion: number;

  beforeAll(async () => {
    await app.ready();
    sup = await prisma.user.findUniqueOrThrow({ where: { email: 'ops@tkmr.local' } }); // branch SG, contact:write/client:write
    director = await prisma.user.findUniqueOrThrow({ where: { email: 'director@tkmr.local' } }); // cross-branch role (D-019 contrast case)
    supMY = await prisma.user.upsert({
      where: { email: 'ops-my@tkmr.local' },
      update: {},
      create: { email: 'ops-my@tkmr.local', name: 'MY Ops Supervisor', passwordHash: 'x', roles: ['OPS_SUPERVISOR'], branch: 'MY' },
    });
  });
  afterAll(async () => { await app.close(); await prisma.$disconnect(); });

  it('CREATE Contact via API, then AuditEntry written for it', async () => {
    const before = await prisma.auditEntry.count({ where: { entityType: 'Contact' } });
    const res = await app.inject({
      method: 'POST', url: '/api/v1/contacts', headers: { authorization: bearer(sup) },
      payload: { name: 'CRM Integration Test Contact', email: 'crm-int-test@example.com', phone: '+65-6000-9999' },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    contactId = body.id; contactVersion = body.version;
    expect(body.name).toBe('CRM Integration Test Contact');
    expect(await prisma.auditEntry.count({ where: { entityType: 'Contact' } })).toBe(before + 1);
  });

  it('CREATE Client referencing the Contact by id (OD-03: personal data lives once, referenced by id)', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/v1/clients', headers: { authorization: bearer(sup) },
      payload: { name: 'CRM Integration Test Client', address: '1 Test St', primaryContactId: contactId },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    clientId = body.id; clientVersion = body.version;
    expect(body.branch).toBe('SG'); // server-derived from the actor's token, never client-supplied
    expect(body.primaryContactId).toBe(contactId);
  });

  // D-019: now that the Contact is linked to an SG Client, an SG (non-cross-branch) actor can read it.
  it('READ Contact via GET /contacts/:id — same-branch actor, now that a Client links it (D-019)', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/v1/contacts/${contactId}`, headers: { authorization: bearer(sup) } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ id: contactId, name: 'CRM Integration Test Contact', email: 'crm-int-test@example.com' });
  });

  it('D-019: a different-branch (MY) non-cross-branch actor CANNOT read the SG-linked Contact -> 404 NOT_FOUND', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/v1/contacts/${contactId}`, headers: { authorization: bearer(supMY) } });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('NOT_FOUND');
  });

  it('D-019: a CROSS_BRANCH_ROLE (Director) CAN read the Contact regardless of branch linkage', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/v1/contacts/${contactId}`, headers: { authorization: bearer(director) } });
    expect(res.statusCode).toBe(200);
    expect(res.json().id).toBe(contactId);
  });

  it('READ Client resolves the SAME Contact row by relation, not a duplicate copy', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/v1/clients/${clientId}`, headers: { authorization: bearer(sup) } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.primaryContact.id).toBe(contactId);
    expect(body.primaryContact.email).toBe('crm-int-test@example.com');
    // OD-03: exactly one Contact row exists for this person — the Client references it, doesn't copy it.
    expect(await prisma.contact.count({ where: { id: contactId } })).toBe(1);
  });

  it('UPDATE Contact via PATCH — version increments, no duplicate row created', async () => {
    const res = await app.inject({
      method: 'PATCH', url: `/api/v1/contacts/${contactId}`, headers: { authorization: bearer(sup) },
      payload: { phone: '+65-6000-0000', version: contactVersion },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.phone).toBe('+65-6000-0000');
    expect(body.version).toBe(contactVersion + 1);
    expect(await prisma.contact.count({ where: { id: contactId } })).toBe(1); // still exactly one row
    contactVersion = body.version;
  });

  it('D-019: MY actor cannot PATCH the SG-linked Contact either -> 404 NOT_FOUND (checked before version)', async () => {
    const res = await app.inject({
      method: 'PATCH', url: `/api/v1/contacts/${contactId}`, headers: { authorization: bearer(supMY) },
      payload: { phone: '+65-0000-0000', version: 999 }, // deliberately wrong version too — should still 404, not 409
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('NOT_FOUND');
  });

  it('UPDATE Contact with a stale version -> 409 VERSION_CONFLICT', async () => {
    const res = await app.inject({
      method: 'PATCH', url: `/api/v1/contacts/${contactId}`, headers: { authorization: bearer(sup) },
      payload: { phone: '+65-9999-9999', version: 0 }, // stale — already incremented above
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('VERSION_CONFLICT');
  });

  it('UPDATE Client via PATCH — version increments', async () => {
    const res = await app.inject({
      method: 'PATCH', url: `/api/v1/clients/${clientId}`, headers: { authorization: bearer(sup) },
      payload: { creditTerms: 'NET60', version: clientVersion },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.creditTerms).toBe('NET60');
    expect(body.version).toBe(clientVersion + 1);
    clientVersion = body.version;
  });

  it('DELETE Client is a SOFT delete: API hides it, but the row still exists at the DB with deletedAt set (OD-03)', async () => {
    const delRes = await app.inject({ method: 'DELETE', url: `/api/v1/clients/${clientId}`, headers: { authorization: bearer(sup) } });
    expect(delRes.statusCode).toBe(200);
    expect(delRes.json()).toEqual({ id: clientId, deleted: true });

    // API-level: now invisible (filtered by deletedAt: null).
    const getRes = await app.inject({ method: 'GET', url: `/api/v1/clients/${clientId}`, headers: { authorization: bearer(sup) } });
    expect(getRes.statusCode).toBe(404);

    // DB-level: the row was NOT hard-deleted — it still exists with deletedAt populated.
    const row = await prisma.client.findUnique({ where: { id: clientId } });
    expect(row).not.toBeNull();
    expect(row!.deletedAt).not.toBeNull();
  });

  it('the Contact referenced by the now-soft-deleted Client is untouched (OD-03: no cascading deletion of shared reference data)', async () => {
    const contact = await prisma.contact.findUnique({ where: { id: contactId } });
    expect(contact).not.toBeNull();
    expect(contact!.email).toBe('crm-int-test@example.com');
  });

  it('D-019 side effect (expected, not a bug): once its only linking Client is soft-deleted, a same-branch actor can no longer read the Contact via the join check', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/v1/contacts/${contactId}`, headers: { authorization: bearer(sup) } });
    expect(res.statusCode).toBe(404);
    // Cross-branch role is still unaffected — confirms this is the join check, not a general regression.
    const dirRes = await app.inject({ method: 'GET', url: `/api/v1/contacts/${contactId}`, headers: { authorization: bearer(director) } });
    expect(dirRes.statusCode).toBe(200);
  });

  it('AuditEntry rows exist for CREATE/UPDATE/SOFT_DELETE on the Client', async () => {
    const actions = await prisma.auditEntry.findMany({ where: { entityType: 'Client', entityId: clientId }, select: { action: true } });
    const seen = new Set(actions.map((a) => a.action));
    expect(seen.has('CREATE')).toBe(true);
    expect(seen.has('UPDATE')).toBe(true);
    expect(seen.has('SOFT_DELETE')).toBe(true);
  });
});
