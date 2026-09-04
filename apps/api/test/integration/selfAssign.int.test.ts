// Integration tests for D-070 technician self-assignment and available-job listing.
// Guarded so the pure-logic suite stays DB-free. Enable with RUN_DB_TESTS=1 after `prisma migrate
// dev` + seed. Uses fixed fixtures so repeated runs do not create duplicate jobs.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { buildApp } from '../../src/app.js';
import { signAccessToken } from '../../src/auth/tokens.js';

const run = process.env.RUN_DB_TESTS ? describe : describe.skip;
const SECRET = process.env.JWT_ACCESS_SECRET ?? 'test-secret';
const bearer = (u: { id: string; roles: string[]; branch: string }) =>
  `Bearer ${signAccessToken({ sub: u.id, roles: u.roles as any, branch: u.branch, mfaComplete: true }, SECRET)}`;

const SELF_ASSIGN_ID = 'jo-inttest-self-assign';
const SELF_ASSIGN_DRAFT_ID = 'jo-inttest-self-assign-draft';
const SELF_ASSIGN_CROSS_BRANCH_ID = 'jo-inttest-self-assign-cross-branch';
const SELF_ASSIGN_AVAILABLE_ID = 'jo-inttest-self-assign-available';
const SELF_ASSIGN_OWNED_ID = 'jo-inttest-self-assign-owned';

run('Job Order self-assignment (integration)', () => {
  let prisma: PrismaClient;
  let app: ReturnType<typeof buildApp>;
  let sup: any, tech: any, otherTech: any, crossBranchTech: any;
  let seedClient: any, seedVessel: any;

  beforeAll(async () => {
    prisma = new PrismaClient();
    const presignPut = async () => ({ uploadUrl: 'http://minio/local', headers: {} });
    app = buildApp({ prisma, accessSecret: SECRET, presignPut });
    await app.ready();
    sup = await prisma.user.findUniqueOrThrow({ where: { email: 'ops@tkmr.local' } });
    tech = await prisma.user.findUniqueOrThrow({ where: { email: 'tech@tkmr.local' } });
    otherTech = await prisma.user.upsert({
      where: { email: 't2@tkmr.local' },
      update: { branch: 'SG', roles: ['TECHNICIAN'], active: true },
      create: { email: 't2@tkmr.local', name: 'T2', passwordHash: 'x', roles: ['TECHNICIAN'], branch: 'SG' },
    });
    crossBranchTech = await prisma.user.upsert({
      where: { email: 't3@tkmr.local' },
      update: { branch: 'MY', roles: ['TECHNICIAN'], active: true },
      create: { email: 't3@tkmr.local', name: 'T3', passwordHash: 'x', roles: ['TECHNICIAN'], branch: 'MY' },
    });
    seedClient = await prisma.client.findFirstOrThrow({ where: { branch: 'SG', deletedAt: null } });
    seedVessel = await prisma.vessel.findFirstOrThrow({ where: { deletedAt: null } });

    await prisma.jobOrder.upsert({
      where: { id: SELF_ASSIGN_ID },
      update: { branch: 'SG', clientId: seedClient.id, vesselId: seedVessel.id, state: 'SCHEDULED', version: 0, assignedTechnicianIds: [], executionOwnerId: null, deletedAt: null },
      create: { id: SELF_ASSIGN_ID, joNumber: 'SG-INTTEST-SELF-ASSIGN', branch: 'SG', clientId: seedClient.id, vesselId: seedVessel.id, scopeSummary: 'Self-assign fixture', origin: 'MANUAL', quotedAmountMinor: 100000, quotedCurrency: 'SGD', state: 'SCHEDULED', createdBy: sup.id },
    });
    await prisma.jobOrder.upsert({
      where: { id: SELF_ASSIGN_DRAFT_ID },
      update: { branch: 'SG', clientId: seedClient.id, vesselId: seedVessel.id, state: 'DRAFT', version: 0, assignedTechnicianIds: [], executionOwnerId: null, deletedAt: null },
      create: { id: SELF_ASSIGN_DRAFT_ID, joNumber: 'SG-INTTEST-SELF-DRAFT', branch: 'SG', clientId: seedClient.id, vesselId: seedVessel.id, scopeSummary: 'Self-assign draft fixture', origin: 'MANUAL', quotedAmountMinor: 100000, quotedCurrency: 'SGD', state: 'DRAFT', createdBy: sup.id },
    });
    await prisma.jobOrder.upsert({
      where: { id: SELF_ASSIGN_CROSS_BRANCH_ID },
      update: { branch: 'MY', clientId: seedClient.id, vesselId: seedVessel.id, state: 'SCHEDULED', version: 0, assignedTechnicianIds: [], executionOwnerId: null, deletedAt: null },
      create: { id: SELF_ASSIGN_CROSS_BRANCH_ID, joNumber: 'MY-INTTEST-SELF-CROSS', branch: 'MY', clientId: seedClient.id, vesselId: seedVessel.id, scopeSummary: 'Self-assign cross-branch fixture', origin: 'MANUAL', quotedAmountMinor: 100000, quotedCurrency: 'SGD', state: 'SCHEDULED', createdBy: sup.id },
    });
    await prisma.jobOrder.upsert({
      where: { id: SELF_ASSIGN_AVAILABLE_ID },
      update: { branch: 'SG', clientId: seedClient.id, vesselId: seedVessel.id, state: 'SCHEDULED', version: 0, assignedTechnicianIds: [], executionOwnerId: null, deletedAt: null },
      create: { id: SELF_ASSIGN_AVAILABLE_ID, joNumber: 'SG-INTTEST-SELF-AVAILABLE', branch: 'SG', clientId: seedClient.id, vesselId: seedVessel.id, scopeSummary: 'Self-assign available fixture', origin: 'MANUAL', quotedAmountMinor: 100000, quotedCurrency: 'SGD', state: 'SCHEDULED', createdBy: sup.id },
    });
    await prisma.jobOrder.upsert({
      where: { id: SELF_ASSIGN_OWNED_ID },
      update: { branch: 'SG', clientId: seedClient.id, vesselId: seedVessel.id, state: 'SCHEDULED', version: 0, assignedTechnicianIds: [tech.id], executionOwnerId: tech.id, deletedAt: null },
      create: { id: SELF_ASSIGN_OWNED_ID, joNumber: 'SG-INTTEST-SELF-OWNED', branch: 'SG', clientId: seedClient.id, vesselId: seedVessel.id, scopeSummary: 'Self-assign owned fixture', origin: 'MANUAL', quotedAmountMinor: 100000, quotedCurrency: 'SGD', state: 'SCHEDULED', createdBy: sup.id, assignedTechnicianIds: [tech.id], executionOwnerId: tech.id },
    });
  });

  afterAll(async () => { await app.close(); await prisma.$disconnect(); });

  it('self-assigns a scheduled job and writes audit', async () => {
    const res = await app.inject({ method: 'POST', url: `/api/v1/job-orders/${SELF_ASSIGN_ID}/self-assign`, headers: { authorization: bearer(tech) }, payload: { version: 0 } });
    expect(res.statusCode).toBe(200);
    const saved = await prisma.jobOrder.findUniqueOrThrow({ where: { id: SELF_ASSIGN_ID } });
    expect(saved.executionOwnerId).toBe(tech.id);
    expect(saved.assignedTechnicianIds).toContain(tech.id);
    expect(await prisma.auditEntry.count({ where: { entityId: SELF_ASSIGN_ID, action: 'SELF_ASSIGN' } })).toBeGreaterThan(0);
  });

  it('rejects a second technician with VERSION_CONFLICT', async () => {
    const res = await app.inject({ method: 'POST', url: `/api/v1/job-orders/${SELF_ASSIGN_ID}/self-assign`, headers: { authorization: bearer(otherTech) }, payload: { version: 0 } });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('VERSION_CONFLICT');
  });

  it('hides cross-branch self-assignment as NOT_FOUND', async () => {
    const res = await app.inject({ method: 'POST', url: `/api/v1/job-orders/${SELF_ASSIGN_CROSS_BRANCH_ID}/self-assign`, headers: { authorization: bearer(tech) }, payload: { version: 0 } });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('NOT_FOUND');
  });

  it('rejects self-assignment on DRAFT with STATE_TRANSITION_INVALID', async () => {
    const res = await app.inject({ method: 'POST', url: `/api/v1/job-orders/${SELF_ASSIGN_DRAFT_ID}/self-assign`, headers: { authorization: bearer(tech) }, payload: { version: 0 } });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('STATE_TRANSITION_INVALID');
  });

  it('marks available and owned jobs in the technician listing', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/job-orders', headers: { authorization: bearer(tech) } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.find((jobOrder: any) => jobOrder.id === SELF_ASSIGN_AVAILABLE_ID)?.isAvailable).toBe(true);
    expect(body.find((jobOrder: any) => jobOrder.id === SELF_ASSIGN_OWNED_ID)?.isAvailable).toBe(false);
  });
});