// D-059/CC-18 integration evidence for OD-06 ESignature sync: full evidence capture plus
// execution-owner-only signing. Guarded so unit runs stay DB-free.
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

run('Sync ESignature D-059/CC-18 (integration)', () => {
  let prisma: PrismaClient;
  let app: ReturnType<typeof buildApp>;
  let supervisor: any;
  let executionOwner: any;
  let assignedNonOwner: any;
  let client: any;
  let vessel: any;

  beforeAll(async () => {
    prisma = new PrismaClient();
    const presignPut = async () => ({ uploadUrl: 'http://minio/local', headers: {} });
    app = buildApp({ prisma, accessSecret: SECRET, presignPut });
    await app.ready();

    supervisor = await prisma.user.findUniqueOrThrow({ where: { email: 'ops@tkmr.local' } });
    executionOwner = await prisma.user.findUniqueOrThrow({ where: { email: 'tech@tkmr.local' } });
    assignedNonOwner = await prisma.user.upsert({
      where: { email: 'sync-esig-non-owner@tkmr.local' },
      update: { roles: ['TECHNICIAN'], branch: 'SG' },
      create: { email: 'sync-esig-non-owner@tkmr.local', name: 'Sync ESignature Non Owner', passwordHash: 'x', roles: ['TECHNICIAN'], branch: 'SG' },
    });
    client = await prisma.client.findFirstOrThrow({ where: { branch: 'SG', deletedAt: null } });
    vessel = await prisma.vessel.findFirstOrThrow({ where: { clientId: client.id, deletedAt: null } });
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  async function createJobOrder(suffix: string) {
    return prisma.jobOrder.create({
      data: {
        joNumber: `SG-SYNC-ESIG-${suffix}-${randomUUID().slice(0, 8)}`,
        branch: 'SG',
        clientId: client.id,
        vesselId: vessel.id,
        scopeSummary: `D-059 sync ESignature ${suffix}`,
        origin: 'MANUAL',
        quotedAmountMinor: 100000,
        quotedCurrency: 'SGD',
        labourRateAmountMinor: 9000,
        labourRateCurrency: 'SGD',
        state: 'IN_PROGRESS',
        assignedTechnicianIds: [executionOwner.id, assignedNonOwner.id],
        executionOwnerId: executionOwner.id,
        createdBy: supervisor.id,
      },
    });
  }

  async function syncAs(user: any, ops: unknown[]) {
    return app.inject({
      method: 'POST',
      url: '/api/v1/sync/batch',
      headers: { authorization: bearer(user) },
      payload: { schemaVersion: SYNC_SCHEMA_VERSION, ops },
    });
  }

  it('persists the full OD-06 ESignature evidence bundle from the execution owner', async () => {
    const jobOrder = await createJobOrder('OWNER');
    const entityId = randomUUID();
    const opId = randomUUID();
    const signedAt = '2026-08-31T04:00:00.000Z';
    const payload = {
      imageS3Key: `signatures/${entityId}.png`,
      signerName: 'Tariq Technician',
      signerRole: 'TECHNICIAN',
      signedAt,
      deviceId: 'field-tablet-17',
      geoLat: 1.3521,
      geoLng: 103.8198,
      documentHash: 'a'.repeat(64),
    };

    const res = await syncAs(executionOwner, [{
      opId,
      entity: 'ESignature',
      action: 'CREATE',
      entityId,
      jobOrderId: jobOrder.id,
      payload,
    }]);

    expect(res.statusCode).toBe(200);
    expect(res.json().results[0]).toMatchObject({ opId, status: 'APPLIED', resultRef: entityId });

    const row = await prisma.eSignature.findUniqueOrThrow({ where: { id: entityId } });
    expect(row.imageS3Key).toBe(payload.imageS3Key);
    expect(row.signerName).toBe(payload.signerName);
    expect(row.signerRole).toBe(payload.signerRole);
    expect(row.signedAt?.toISOString()).toBe(signedAt);
    expect(row.deviceId).toBe(payload.deviceId);
    expect(row.geoLat).toBeCloseTo(payload.geoLat);
    expect(row.geoLng).toBeCloseTo(payload.geoLng);
    expect(row.documentHash).toBe(payload.documentHash);
    expect(row.reviewState).toBeNull();
    expect(row.opId).toBe(opId);
  });

  it('rejects ESignature CREATE from an assigned technician who is not the execution owner', async () => {
    const jobOrder = await createJobOrder('NONOWNER');
    const entityId = randomUUID();
    const opId = randomUUID();

    const res = await syncAs(assignedNonOwner, [{
      opId,
      entity: 'ESignature',
      action: 'CREATE',
      entityId,
      jobOrderId: jobOrder.id,
      payload: {
        imageS3Key: `signatures/${entityId}.png`,
        signerName: 'Assigned Non Owner',
        signerRole: 'TECHNICIAN',
        signedAt: '2026-08-31T05:00:00.000Z',
        deviceId: 'field-tablet-18',
        geoLat: 1.3001,
        geoLng: 103.8001,
        documentHash: 'b'.repeat(64),
      },
    }]);

    expect(res.statusCode).toBe(200);
    expect(res.json().results[0]).toEqual({
      opId,
      status: 'FORBIDDEN',
      error: { code: 'FORBIDDEN', message: "only the job's execution owner may sign" },
    });
    await expect(prisma.eSignature.findUnique({ where: { id: entityId } })).resolves.toBeNull();
    await expect(prisma.processedOp.findUnique({ where: { opId } })).resolves.toBeNull();
  });

  it('keeps non-ESignature sync ops available to an assigned non-owner technician', async () => {
    const template = await prisma.checklistTemplate.create({
      data: {
        name: `Sync ESignature non-owner regression ${randomUUID().slice(0, 8)}`,
        items: [{ id: 'visual-check', label: 'Visual check', type: 'bool', required: false }],
      },
    });
    const cases = [
      { entity: 'WorkLog', delegate: 'workLog', payload: { startedAt: '2026-08-31T06:00:00.000Z' } },
      { entity: 'Photo', delegate: 'photo', payload: { s3Key: 'photos/non-owner.jpg', phase: 'DURING', takenAt: '2026-08-31T06:10:00.000Z' } },
      { entity: 'Observation', delegate: 'observation', payload: { templateKey: 'general', body: 'Assigned non-owner observation' } },
      { entity: 'ChecklistInstance', delegate: 'checklistInstance', payload: { templateId: template.id } },
      {
        entity: 'MaterialLine',
        delegate: 'materialLine',
        payload: { description: 'Field sealant', quantity: '2.500', unit: 'tube', unitCostAmountMinor: 1250, unitCostCurrency: 'SGD' },
      },
    ] as const;

    for (const c of cases) {
      const jobOrder = await createJobOrder(c.entity.toUpperCase());
      const entityId = randomUUID();
      const opId = randomUUID();
      const res = await syncAs(assignedNonOwner, [{
        opId,
        entity: c.entity,
        action: 'CREATE',
        entityId,
        jobOrderId: jobOrder.id,
        payload: c.payload,
      }]);

      expect(res.statusCode).toBe(200);
      expect(res.json().results[0]).toMatchObject({ opId, status: 'APPLIED', resultRef: entityId });
      expect(res.json().results[0].reviewState).toBeUndefined();
      const row = await (prisma as any)[c.delegate].findUnique({ where: { id: entityId } });
      expect(row.reviewState).toBeNull();
    }
  });
});
