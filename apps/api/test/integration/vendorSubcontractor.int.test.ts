import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { buildApp } from '../../src/app.js';
import { signAccessToken } from '../../src/auth/tokens.js';

const run = process.env.RUN_DB_TESTS ? describe : describe.skip;
const SECRET = process.env.JWT_ACCESS_SECRET ?? 'test-secret';
const bearer = (user: { id: string; roles: string[]; branch: string }) =>
  `Bearer ${signAccessToken({ sub: user.id, roles: user.roles as any, branch: user.branch, mfaComplete: true }, SECRET)}`;

run('Vendor subcontractor tagging and create-branch selection (integration)', () => {
  let prisma: PrismaClient;
  let app: ReturnType<typeof buildApp>;
  let admin: any, director: any, sup: any;
  let clientSG: any, vesselSG: any, clientMY: any, vesselMY: any, clientID: any, vesselID: any;

  beforeAll(async () => {
    prisma = new PrismaClient();
    app = buildApp({ prisma, accessSecret: SECRET, presignPut: async () => ({ uploadUrl: 'http://minio/local', headers: {} }) });
    await app.ready();

    [admin, director, sup] = await Promise.all([
      prisma.user.findUniqueOrThrow({ where: { email: 'admin@tkmr.local' } }),
      prisma.user.findUniqueOrThrow({ where: { email: 'director@tkmr.local' } }),
      prisma.user.findUniqueOrThrow({ where: { email: 'ops@tkmr.local' } }),
    ]);

    const suffix = Date.now().toString().slice(-9);
    clientSG = await prisma.client.create({ data: { branch: 'SG', name: `Vendor Branch SG Client ${suffix}` } });
    vesselSG = await prisma.vessel.create({ data: { clientId: clientSG.id, imoNumber: `VB-SG-${suffix}`, name: `MV Vendor Branch SG ${suffix}` } });
    clientMY = await prisma.client.create({ data: { branch: 'MY', name: `Vendor Branch MY Client ${suffix}` } });
    vesselMY = await prisma.vessel.create({ data: { clientId: clientMY.id, imoNumber: `VB-MY-${suffix}`, name: `MV Vendor Branch MY ${suffix}` } });
    clientID = await prisma.client.create({ data: { branch: 'ID', name: `Vendor Branch ID Client ${suffix}` } });
    vesselID = await prisma.vessel.create({ data: { clientId: clientID.id, imoNumber: `VB-ID-${suffix}`, name: `MV Vendor Branch ID ${suffix}` } });
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  async function createJob(actor: any, payload: Record<string, unknown>) {
    return app.inject({
      method: 'POST',
      url: '/api/v1/job-orders',
      headers: { authorization: bearer(actor) },
      payload: {
        serviceCategories: ['inspection'],
        scopeSummary: 'Vendor subcontractor integration fixture',
        quotedAmountMinor: 10000,
        quotedCurrency: 'SGD',
        ...payload,
      },
    });
  }

  it('locks OPS_SUPERVISOR create branch to their own branch even if a branch is posted', async () => {
    const res = await createJob(sup, { branch: 'MY', clientId: clientSG.id, vesselId: vesselSG.id });
    expect(res.statusCode).toBe(201);
    expect(res.json().branch).toBe('SG');
  });

  it('lets DIRECTOR and SYSTEM_ADMIN choose a create branch when the client and vessel belong to that branch', async () => {
    const directorRes = await createJob(director, { branch: 'MY', clientId: clientMY.id, vesselId: vesselMY.id });
    expect(directorRes.statusCode).toBe(201);
    expect(directorRes.json().branch).toBe('MY');

    const adminRes = await createJob(admin, { branch: 'ID', clientId: clientID.id, vesselId: vesselID.id });
    expect(adminRes.statusCode).toBe(201);
    expect(adminRes.json().branch).toBe('ID');
  });

  it('persists the selected create currency', async () => {
    const res = await createJob(director, { branch: 'MY', clientId: clientMY.id, vesselId: vesselMY.id, quotedCurrency: 'USD' });
    expect(res.statusCode).toBe(201);
    expect(res.json().quotedCurrency).toBe('USD');
    const persisted = await prisma.jobOrder.findUniqueOrThrow({ where: { id: res.json().id } });
    expect(persisted.quotedCurrency).toBe('USD');
  });

  it('supports branch-scoped Vendor CRUD and links vendor tags to Job Orders and Variations', async () => {
    const vendorRes = await app.inject({
      method: 'POST',
      url: '/api/v1/vendors',
      headers: { authorization: bearer(sup) },
      payload: { name: `Subcontractor Vendor ${Date.now()}`, email: 'vendor@example.test', phone: '+65 5555 0000' },
    });
    expect(vendorRes.statusCode).toBe(201);
    const vendor = vendorRes.json();
    expect(vendor.branch).toBe('SG');

    const patchRes = await app.inject({
      method: 'PATCH',
      url: `/api/v1/vendors/${vendor.id}`,
      headers: { authorization: bearer(sup) },
      payload: { version: vendor.version, phone: '+65 5555 1111' },
    });
    expect(patchRes.statusCode).toBe(200);
    expect(patchRes.json().phone).toBe('+65 5555 1111');

    const jobRes = await createJob(sup, {
      clientId: clientSG.id,
      vesselId: vesselSG.id,
      isSubcontracted: true,
      vendorId: vendor.id,
    });
    expect(jobRes.statusCode).toBe(201);
    expect(jobRes.json().isSubcontracted).toBe(true);
    expect(jobRes.json().vendorId).toBe(vendor.id);

    const variationRes = await app.inject({
      method: 'POST',
      url: `/api/v1/job-orders/${jobRes.json().id}/variations`,
      headers: { authorization: bearer(sup) },
      payload: {
        reason: 'Subcontracted specialist scope',
        amountMinor: 2500,
        amountCurrency: 'SGD',
        isSubcontracted: true,
        vendorId: vendor.id,
      },
    });
    expect(variationRes.statusCode).toBe(201);
    expect(variationRes.json().isSubcontracted).toBe(true);
    expect(variationRes.json().vendorId).toBe(vendor.id);
  });
});
