// End-to-end Job Order sequence coverage for the core office -> technician -> review flow.
// Guarded like the rest of the DB-backed integration suite.
import { randomUUID } from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { buildApp } from '../../src/app.js';
import { signAccessToken } from '../../src/auth/tokens.js';
import { SYNC_SCHEMA_VERSION } from '../../src/routes/sync.js';

const run = process.env.RUN_DB_TESTS ? describe : describe.skip;
const SECRET = process.env.JWT_ACCESS_SECRET ?? 'test-secret';
const bearer = (user: { id: string; roles: string[]; branch: string }) =>
  `Bearer ${signAccessToken({ sub: user.id, roles: user.roles as any, branch: user.branch, mfaComplete: true }, SECRET)}`;

run('Core Job Order sequence (integration)', () => {
  let prisma: PrismaClient;
  let app: ReturnType<typeof buildApp>;
  let admin: any, director: any, finance: any, sup: any, tech: any, otherTech: any;
  let client: any, vessel: any;

  beforeAll(async () => {
    prisma = new PrismaClient();
    const presignPut = async () => ({ uploadUrl: 'http://minio/local', headers: {} });
    app = buildApp({ prisma, accessSecret: SECRET, presignPut });
    await app.ready();

    [admin, director, finance, sup, tech] = await Promise.all([
      prisma.user.findUniqueOrThrow({ where: { email: 'admin@tkmr.local' } }),
      prisma.user.findUniqueOrThrow({ where: { email: 'director@tkmr.local' } }),
      prisma.user.findUniqueOrThrow({ where: { email: 'finance@tkmr.local' } }),
      prisma.user.findUniqueOrThrow({ where: { email: 'ops@tkmr.local' } }),
      prisma.user.findUniqueOrThrow({ where: { email: 'tech@tkmr.local' } }),
    ]);
    otherTech = await prisma.user.upsert({
      where: { email: 'jo-sequence-other-tech@tkmr.local' },
      update: { roles: ['TECHNICIAN'], branch: 'SG', active: true },
      create: { email: 'jo-sequence-other-tech@tkmr.local', name: 'JO Sequence Other Tech', passwordHash: 'x', roles: ['TECHNICIAN'], branch: 'SG' },
    });
    vessel = await prisma.vessel.findFirstOrThrow({
      where: { deletedAt: null, client: { branch: 'SG', deletedAt: null } },
      include: { client: true },
    });
    client = vessel.client;
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  async function createViaApi(actor: any, suffix: string) {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/job-orders',
      headers: { authorization: bearer(actor) },
      payload: {
        clientId: client.id,
        vesselId: vessel.id,
        serviceCategories: ['inspection'],
        port: 'Singapore',
        scopeSummary: `JO sequence ${suffix} ${randomUUID()}`,
        quotedAmountMinor: 125000,
        quotedCurrency: 'SGD',
      },
    });
    expect(res.statusCode).toBe(201);
    return res.json();
  }

  async function createJobOrder(state = 'DRAFT', owner: any = null) {
    return prisma.jobOrder.create({
      data: {
        joNumber: `SG-JO-SEQ-${randomUUID().slice(0, 8)}`,
        branch: 'SG',
        clientId: client.id,
        vesselId: vessel.id,
        serviceCategories: ['inspection'],
        port: 'Singapore',
        scopeSummary: `JO sequence fixture ${randomUUID()}`,
        origin: 'MANUAL',
        quotedAmountMinor: 125000,
        quotedCurrency: 'SGD',
        labourRateAmountMinor: 9000,
        labourRateCurrency: 'SGD',
        state,
        assignedTechnicianIds: owner ? [owner.id] : [],
        executionOwnerId: owner?.id ?? null,
        createdBy: sup.id,
      },
    });
  }

  async function createCrossBranchJobOrder(state = 'DRAFT') {
    const suffix = randomUUID().slice(0, 8);
    const myClient = await prisma.client.create({
      data: {
        branch: 'MY',
        name: `JO Sequence MY Client ${suffix}`,
        status: 'ACTIVE',
      },
    });
    const myVessel = await prisma.vessel.create({
      data: {
        clientId: myClient.id,
        imoNumber: `MYSEQ${suffix}`,
        name: `JO Sequence MY Vessel ${suffix}`,
      },
    });
    return prisma.jobOrder.create({
      data: {
        joNumber: `MY-JO-SEQ-${suffix}`,
        branch: 'MY',
        clientId: myClient.id,
        vesselId: myVessel.id,
        serviceCategories: ['inspection'],
        port: 'Port Klang',
        scopeSummary: `MY branch JO sequence fixture ${randomUUID()}`,
        origin: 'MANUAL',
        quotedAmountMinor: 125000,
        quotedCurrency: 'MYR',
        labourRateAmountMinor: 9000,
        labourRateCurrency: 'MYR',
        state,
        createdBy: sup.id,
      },
    });
  }

  it('SYSTEM_ADMIN, DIRECTOR, and OPS_SUPERVISOR can create Job Orders', async () => {
    for (const actor of [admin, director, sup]) {
      const jo = await createViaApi(actor, actor.roles[0]);
      expect(jo.state).toBe('DRAFT');
      expect(jo.branch).toBe('SG');
      expect(jo.clientId).toBe(client.id);
      expect(jo.vesselId).toBe(vessel.id);
    }
  });

  it('SYSTEM_ADMIN, DIRECTOR, and OPS_SUPERVISOR can assign and schedule Job Orders', async () => {
    for (const actor of [admin, director, sup]) {
      const jo = await createViaApi(actor, `assign-${actor.roles[0]}`);
      const assigned = await app.inject({
        method: 'POST',
        url: `/api/v1/job-orders/${jo.id}/assign`,
        headers: { authorization: bearer(actor) },
        payload: { technicianIds: [tech.id], executionOwnerId: tech.id, version: jo.version },
      });
      expect(assigned.statusCode).toBe(200);
      expect(assigned.json().executionOwnerId).toBe(tech.id);
      expect(assigned.json().assignedTechnicianIds).toEqual([tech.id]);

      const scheduled = await app.inject({
        method: 'POST',
        url: `/api/v1/job-orders/${jo.id}/transition`,
        headers: { authorization: bearer(actor) },
        payload: { to: 'SCHEDULED', version: assigned.json().version },
      });
      expect(scheduled.statusCode).toBe(200);
      expect(scheduled.json().state).toBe('SCHEDULED');
    }
  });

  it('technician sees all branch jobs with openability tags, then self-assigns the available one', async () => {
    const assigned = await createJobOrder('SCHEDULED', tech);
    const assignedToOtherTech = await createJobOrder('IN_PROGRESS', otherTech);
    const available = await createJobOrder('SCHEDULED');

    const list = await app.inject({
      method: 'GET',
      url: '/api/v1/job-orders',
      headers: { authorization: bearer(tech) },
    });
    expect(list.statusCode).toBe(200);
    const rows = list.json();
    expect(rows.find((row: any) => row.id === assigned.id)?.isAvailable).toBe(false);
    expect(rows.find((row: any) => row.id === assigned.id)?.canOpen).toBe(true);
    expect(rows.find((row: any) => row.id === assignedToOtherTech.id)?.isAvailable).toBe(false);
    expect(rows.find((row: any) => row.id === assignedToOtherTech.id)?.canOpen).toBe(false);
    expect(rows.find((row: any) => row.id === available.id)?.isAvailable).toBe(true);
    expect(rows.find((row: any) => row.id === available.id)?.canOpen).toBe(true);

    const claimed = await app.inject({
      method: 'POST',
      url: `/api/v1/job-orders/${available.id}/self-assign`,
      headers: { authorization: bearer(tech) },
      payload: { version: available.version },
    });
    expect(claimed.statusCode).toBe(200);
    expect(claimed.json().executionOwnerId).toBe(tech.id);
    expect(claimed.json().assignedTechnicianIds).toContain(tech.id);
  });

  it('technician detail access allows unassigned and own jobs while masking other-owner and cross-branch jobs', async () => {
    const unassigned = await createJobOrder('COMPLETED');
    const ownCompleted = await createJobOrder('COMPLETED', tech);
    const otherOwner = await createJobOrder('IN_PROGRESS', otherTech);
    const crossBranch = await createCrossBranchJobOrder('SCHEDULED');

    const unassignedDetail = await app.inject({
      method: 'GET',
      url: `/api/v1/job-orders/${unassigned.id}`,
      headers: { authorization: bearer(tech) },
    });
    expect(unassignedDetail.statusCode).toBe(200);
    expect(unassignedDetail.json().id).toBe(unassigned.id);

    const ownDetail = await app.inject({
      method: 'GET',
      url: `/api/v1/job-orders/${ownCompleted.id}`,
      headers: { authorization: bearer(tech) },
    });
    expect(ownDetail.statusCode).toBe(200);
    expect(ownDetail.json().id).toBe(ownCompleted.id);

    const otherDetail = await app.inject({
      method: 'GET',
      url: `/api/v1/job-orders/${otherOwner.id}`,
      headers: { authorization: bearer(tech) },
    });
    expect(otherDetail.statusCode).toBe(404);
    expect(otherDetail.json().error.code).toBe('NOT_FOUND');

    const unassignedFinancialSummary = await app.inject({
      method: 'GET',
      url: `/api/v1/job-orders/${unassigned.id}/financial-summary`,
      headers: { authorization: bearer(tech) },
    });
    expect(unassignedFinancialSummary.statusCode).toBe(200);

    const otherFinancialSummary = await app.inject({
      method: 'GET',
      url: `/api/v1/job-orders/${otherOwner.id}/financial-summary`,
      headers: { authorization: bearer(tech) },
    });
    expect(otherFinancialSummary.statusCode).toBe(404);
    expect(otherFinancialSummary.json().error.code).toBe('NOT_FOUND');

    const crossBranchDetail = await app.inject({
      method: 'GET',
      url: `/api/v1/job-orders/${crossBranch.id}`,
      headers: { authorization: bearer(tech) },
    });
    expect(crossBranchDetail.statusCode).toBe(404);
    expect(crossBranchDetail.json().error.code).toBe('NOT_FOUND');
  });

  it('technician list and detail access follows the state visibility matrix', async () => {
    const states = ['DRAFT', 'SCHEDULED', 'IN_PROGRESS', 'ON_HOLD', 'PENDING_REVIEW', 'COMPLETED', 'INVOICED', 'CLOSED', 'CANCELLED'] as const;
    const jobs = new Map<string, any>();
    for (const state of states) {
      jobs.set(state, await createJobOrder(state, state === 'IN_PROGRESS' ? otherTech : tech));
    }

    const list = await app.inject({
      method: 'GET',
      url: '/api/v1/job-orders',
      headers: { authorization: bearer(tech) },
    });
    expect(list.statusCode).toBe(200);
    const rows = list.json();

    expect(rows.find((row: any) => row.id === jobs.get('DRAFT').id)).toBeUndefined();
    expect(rows.find((row: any) => row.id === jobs.get('CANCELLED').id)).toBeUndefined();

    const expectedListAccess: Record<string, { canOpen: boolean; readOnly: boolean; isAvailable: boolean }> = {
      SCHEDULED: { canOpen: true, readOnly: false, isAvailable: false },
      IN_PROGRESS: { canOpen: false, readOnly: false, isAvailable: false },
      ON_HOLD: { canOpen: true, readOnly: false, isAvailable: false },
      PENDING_REVIEW: { canOpen: true, readOnly: true, isAvailable: false },
      COMPLETED: { canOpen: true, readOnly: true, isAvailable: false },
      INVOICED: { canOpen: true, readOnly: true, isAvailable: false },
      CLOSED: { canOpen: true, readOnly: true, isAvailable: false },
    };

    for (const [state, expected] of Object.entries(expectedListAccess)) {
      const row = rows.find((candidate: any) => candidate.id === jobs.get(state).id);
      expect(row, state).toBeTruthy();
      expect(row.canOpen, state).toBe(expected.canOpen);
      expect(row.readOnly, state).toBe(expected.readOnly);
      expect(row.isAvailable, state).toBe(expected.isAvailable);
    }

    const availableScheduled = await createJobOrder('SCHEDULED');
    const availableList = await app.inject({
      method: 'GET',
      url: '/api/v1/job-orders',
      headers: { authorization: bearer(tech) },
    });
    const availableRow = availableList.json().find((row: any) => row.id === availableScheduled.id);
    expect(availableRow).toMatchObject({ canOpen: true, readOnly: false, isAvailable: true, canStart: true });

    for (const state of ['SCHEDULED', 'ON_HOLD', 'PENDING_REVIEW', 'COMPLETED', 'INVOICED', 'CLOSED'] as const) {
      const detail = await app.inject({
        method: 'GET',
        url: `/api/v1/job-orders/${jobs.get(state).id}`,
        headers: { authorization: bearer(tech) },
      });
      expect(detail.statusCode, state).toBe(200);
      expect(detail.json().readOnly, state).toBe(expectedListAccess[state].readOnly);
    }

    for (const state of ['DRAFT', 'IN_PROGRESS', 'CANCELLED'] as const) {
      const detail = await app.inject({
        method: 'GET',
        url: `/api/v1/job-orders/${jobs.get(state).id}`,
        headers: { authorization: bearer(tech) },
      });
      expect(detail.statusCode, state).toBe(404);
      expect(detail.json().error.code, state).toBe('NOT_FOUND');
    }

    const ownInProgress = await createJobOrder('IN_PROGRESS', tech);
    const ownInProgressDetail = await app.inject({
      method: 'GET',
      url: `/api/v1/job-orders/${ownInProgress.id}`,
      headers: { authorization: bearer(tech) },
    });
    expect(ownInProgressDetail.statusCode).toBe(200);
    expect(ownInProgressDetail.json()).toMatchObject({ canOpen: true, readOnly: false });
  });

  it('technician starts their own scheduled job, while a non-owner technician cannot start it', async () => {
    const jo = await createJobOrder('SCHEDULED', tech);

    const blocked = await app.inject({
      method: 'POST',
      url: `/api/v1/job-orders/${jo.id}/transition`,
      headers: { authorization: bearer(otherTech) },
      payload: { to: 'IN_PROGRESS', version: jo.version },
    });
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json().error.code).toBe('FORBIDDEN');

    const started = await app.inject({
      method: 'POST',
      url: `/api/v1/job-orders/${jo.id}/transition`,
      headers: { authorization: bearer(tech) },
      payload: { to: 'IN_PROGRESS', version: jo.version },
    });
    expect(started.statusCode).toBe(200);
    expect(started.json().state).toBe('IN_PROGRESS');
  });

  it('technician can pause their own IN_PROGRESS job with a reason while non-owners cannot', async () => {
    const owned = await createJobOrder('IN_PROGRESS', tech);
    const paused = await app.inject({
      method: 'POST',
      url: `/api/v1/job-orders/${owned.id}/transition`,
      headers: { authorization: bearer(tech) },
      payload: { to: 'ON_HOLD', version: owned.version, reason: 'Waiting for yard access' },
    });
    expect(paused.statusCode).toBe(200);
    expect(paused.json().state).toBe('ON_HOLD');

    const history = await prisma.jobStatusHistory.findFirstOrThrow({
      where: { jobOrderId: owned.id, toState: 'ON_HOLD' },
      orderBy: { at: 'desc' },
    });
    expect(history.reason).toBe('Waiting for yard access');

    const otherOwned = await createJobOrder('IN_PROGRESS', otherTech);
    const blocked = await app.inject({
      method: 'POST',
      url: `/api/v1/job-orders/${otherOwned.id}/transition`,
      headers: { authorization: bearer(tech) },
      payload: { to: 'ON_HOLD', version: otherOwned.version, reason: 'Trying to pause another job' },
    });
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json().error.code).toBe('FORBIDDEN');
  });

  it('office roles can still pause SCHEDULED and IN_PROGRESS jobs with a reason', async () => {
    for (const actor of [admin, director, sup]) {
      const scheduled = await createJobOrder('SCHEDULED', tech);
      const scheduledPause = await app.inject({
        method: 'POST',
        url: `/api/v1/job-orders/${scheduled.id}/transition`,
        headers: { authorization: bearer(actor) },
        payload: { to: 'ON_HOLD', version: scheduled.version, reason: 'Office hold before sailing' },
      });
      expect(scheduledPause.statusCode).toBe(200);
      expect(scheduledPause.json().state).toBe('ON_HOLD');

      const inProgress = await createJobOrder('IN_PROGRESS', tech);
      const inProgressPause = await app.inject({
        method: 'POST',
        url: `/api/v1/job-orders/${inProgress.id}/transition`,
        headers: { authorization: bearer(actor) },
        payload: { to: 'ON_HOLD', version: inProgress.version, reason: 'Office hold during execution' },
      });
      expect(inProgressPause.statusCode).toBe(200);
      expect(inProgressPause.json().state).toBe('ON_HOLD');
    }
  });

  it('technician can resume an ON_HOLD job and becomes execution owner', async () => {
    const jo = await createJobOrder('IN_PROGRESS', otherTech);
    await prisma.jobStatusHistory.create({
      data: { jobOrderId: jo.id, fromState: 'IN_PROGRESS', toState: 'ON_HOLD', actorId: sup.id, reason: 'Paused for yard access' },
    });
    const held = await prisma.jobOrder.update({ where: { id: jo.id }, data: { state: 'ON_HOLD' } });

    const resumed = await app.inject({
      method: 'POST',
      url: `/api/v1/job-orders/${held.id}/transition`,
      headers: { authorization: bearer(tech) },
      payload: { to: 'IN_PROGRESS', version: held.version, reason: 'Taking over after hold' },
    });

    expect(resumed.statusCode).toBe(200);
    expect(resumed.json()).toMatchObject({ state: 'IN_PROGRESS', executionOwnerId: tech.id });
    expect(resumed.json().assignedTechnicianIds).toContain(tech.id);
  });

  it('syncs currently implemented execution data: observation, material, photo, checklist results, and signature', async () => {
    const jo = await createJobOrder('IN_PROGRESS', tech);
    const template = await prisma.checklistTemplate.create({
      data: {
        name: `JO sequence checklist ${randomUUID().slice(0, 8)}`,
        items: [
          { id: 'visual', label: 'Visual check', type: 'bool', required: true },
          { id: 'notes', label: 'Notes', type: 'text', required: false },
        ],
      },
    });
    const ops = [
      {
        opId: randomUUID(),
        entity: 'Observation',
        action: 'CREATE',
        entityId: randomUUID(),
        jobOrderId: jo.id,
        payload: { body: 'Main pump inspected, no abnormal vibration.', templateKey: null },
      },
      {
        opId: randomUUID(),
        entity: 'MaterialLine',
        action: 'CREATE',
        entityId: randomUUID(),
        jobOrderId: jo.id,
        payload: { description: 'Gasket kit', quantity: '1', unit: 'set', unitCostAmountMinor: 5000, unitCostCurrency: 'SGD' },
      },
      {
        opId: randomUUID(),
        entity: 'Photo',
        action: 'CREATE',
        entityId: randomUUID(),
        jobOrderId: jo.id,
        payload: { s3Key: 'SG/job/photo.jpg', phase: 'DURING', takenAt: '2026-09-04T01:00:00.000Z' },
      },
      {
        opId: randomUUID(),
        entity: 'ChecklistInstance',
        action: 'CREATE',
        entityId: randomUUID(),
        jobOrderId: jo.id,
        payload: {
          templateId: template.id,
          results: [{ itemId: 'visual', value: true }, { itemId: 'notes', value: 'No leaks observed.' }],
          completedAt: '2026-09-04T01:05:00.000Z',
        },
      },
      {
        opId: randomUUID(),
        entity: 'ESignature',
        action: 'CREATE',
        entityId: randomUUID(),
        jobOrderId: jo.id,
        payload: {
          imageS3Key: 'SG/job/signature.png',
          signerName: 'Tariq Technician',
          signerRole: 'TECHNICIAN',
          signedAt: '2026-09-04T01:10:00.000Z',
          deviceId: 'field-device-sequence',
          geoLat: 1.3521,
          geoLng: 103.8198,
          documentHash: 'c'.repeat(64),
        },
      },
    ] as const;

    const synced = await app.inject({
      method: 'POST',
      url: '/api/v1/sync/batch',
      headers: { authorization: bearer(tech) },
      payload: { schemaVersion: SYNC_SCHEMA_VERSION, ops },
    });
    expect(synced.statusCode).toBe(200);
    expect(synced.json().results).toHaveLength(ops.length);
    expect(synced.json().results.every((result: any) => result.status === 'APPLIED')).toBe(true);

    await expect(prisma.observation.findUnique({ where: { id: ops[0].entityId } })).resolves.toMatchObject({ body: ops[0].payload.body });
    await expect(prisma.materialLine.findUnique({ where: { id: ops[1].entityId } })).resolves.toMatchObject({ description: ops[1].payload.description });
    await expect(prisma.photo.findUnique({ where: { id: ops[2].entityId } })).resolves.toMatchObject({ s3Key: ops[2].payload.s3Key });
    const checklist = await prisma.checklistInstance.findUniqueOrThrow({ where: { id: ops[3].entityId } });
    expect(checklist.completedById).toBe(tech.id);
    expect(checklist.completedAt?.toISOString()).toBe(ops[3].payload.completedAt);
    expect(checklist.results).toEqual(ops[3].payload.results);
    await expect(prisma.eSignature.findUnique({ where: { id: ops[4].entityId } })).resolves.toMatchObject({ documentHash: ops[4].payload.documentHash });
  });

  it('technician submits IN_PROGRESS for review and office roles complete PENDING_REVIEW jobs', async () => {
    const jo = await createJobOrder('IN_PROGRESS', tech);
    const submitted = await app.inject({
      method: 'POST',
      url: `/api/v1/job-orders/${jo.id}/transition`,
      headers: { authorization: bearer(tech) },
      payload: { to: 'PENDING_REVIEW', version: jo.version },
    });
    expect(submitted.statusCode).toBe(200);
    expect(submitted.json().state).toBe('PENDING_REVIEW');

    for (const actor of [admin, director, sup]) {
      const reviewJo = await createJobOrder('PENDING_REVIEW', tech);
      const completed = await app.inject({
        method: 'POST',
        url: `/api/v1/job-orders/${reviewJo.id}/transition`,
        headers: { authorization: bearer(actor) },
        payload: { to: 'COMPLETED', version: reviewJo.version },
      });
      expect(completed.statusCode).toBe(200);
      expect(completed.json().state).toBe('COMPLETED');
      expect(await prisma.invoice.count({ where: { jobOrderId: reviewJo.id, status: 'DRAFT' } })).toBe(1);
    }
  });

  it('rejects illegal state skips', async () => {
    const draft = await createJobOrder('DRAFT', tech);
    const draftSkip = await app.inject({
      method: 'POST',
      url: `/api/v1/job-orders/${draft.id}/transition`,
      headers: { authorization: bearer(tech) },
      payload: { to: 'IN_PROGRESS', version: draft.version },
    });
    expect(draftSkip.statusCode).toBe(409);
    expect(draftSkip.json().error.code).toBe('STATE_TRANSITION_INVALID');

    const scheduled = await createJobOrder('SCHEDULED', tech);
    const scheduledSkip = await app.inject({
      method: 'POST',
      url: `/api/v1/job-orders/${scheduled.id}/transition`,
      headers: { authorization: bearer(tech) },
      payload: { to: 'PENDING_REVIEW', version: scheduled.version },
    });
    expect(scheduledSkip.statusCode).toBe(409);
    expect(scheduledSkip.json().error.code).toBe('STATE_TRANSITION_INVALID');
  });

  it('role gates reject non-office JO create/assign/variation actions and allow invoice-state roles', async () => {
    const financeCreate = await app.inject({
      method: 'POST',
      url: '/api/v1/job-orders',
      headers: { authorization: bearer(finance) },
      payload: { clientId: client.id, vesselId: vessel.id, scopeSummary: 'blocked', quotedAmountMinor: 1, quotedCurrency: 'SGD' },
    });
    expect(financeCreate.statusCode).toBe(403);

    const techCreate = await app.inject({
      method: 'POST',
      url: '/api/v1/job-orders',
      headers: { authorization: bearer(tech) },
      payload: { clientId: client.id, vesselId: vessel.id, scopeSummary: 'blocked', quotedAmountMinor: 1, quotedCurrency: 'SGD' },
    });
    expect(techCreate.statusCode).toBe(403);

    const jo = await createJobOrder('DRAFT');
    const financeAssign = await app.inject({
      method: 'POST',
      url: `/api/v1/job-orders/${jo.id}/assign`,
      headers: { authorization: bearer(finance) },
      payload: { technicianIds: [tech.id], executionOwnerId: tech.id, version: jo.version },
    });
    expect(financeAssign.statusCode).toBe(403);

    const techVariation = await app.inject({
      method: 'POST',
      url: `/api/v1/job-orders/${jo.id}/variations`,
      headers: { authorization: bearer(tech) },
      payload: { reason: 'blocked technician variation', amountMinor: 100, amountCurrency: 'SGD' },
    });
    expect(techVariation.statusCode).toBe(403);

    for (const actor of [finance, admin, director]) {
      const completed = await createJobOrder('COMPLETED', tech);
      const invoiced = await app.inject({
        method: 'POST',
        url: `/api/v1/job-orders/${completed.id}/transition`,
        headers: { authorization: bearer(actor) },
        payload: { to: 'INVOICED', version: completed.version },
      });
      expect(invoiced.statusCode).toBe(200);
      expect(invoiced.json().state).toBe('INVOICED');
    }
  });
});
