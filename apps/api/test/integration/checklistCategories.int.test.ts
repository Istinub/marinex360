import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { buildApp } from '../../src/app.js';
import { signAccessToken } from '../../src/auth/tokens.js';

const run = process.env.RUN_DB_TESTS ? describe : describe.skip;
const SECRET = process.env.JWT_ACCESS_SECRET ?? 'test-secret';
const bearer = (u: { id: string; roles: string[]; branch: string }) =>
  `Bearer ${signAccessToken({ sub: u.id, roles: u.roles as any, branch: u.branch, mfaComplete: true }, SECRET)}`;

run('Checklist categories (integration)', () => {
  let prisma: PrismaClient;
  let app: ReturnType<typeof buildApp>;
  let admin: any, tech: any, sup: any;

  beforeAll(async () => {
    prisma = new PrismaClient();
    const presignPut = async () => ({ uploadUrl: 'http://minio/local', headers: {} });
    app = buildApp({ prisma, accessSecret: SECRET, presignPut });
    await app.ready();
    admin = await prisma.user.findUniqueOrThrow({ where: { email: 'admin@tkmr.local' } });
    tech = await prisma.user.findUniqueOrThrow({ where: { email: 'tech@tkmr.local' } });
    sup = await prisma.user.findUniqueOrThrow({ where: { email: 'ops@tkmr.local' } });
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('allows any authenticated role to read categories with ordered items', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/checklist-categories',
      headers: { authorization: bearer(tech) },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body[0]).toHaveProperty('items');
  });

  it('blocks non-admin/director writes', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/checklist-categories',
      headers: { authorization: bearer(sup) },
      payload: { name: 'Supervisor blocked', sortOrder: 999 },
    });

    expect(res.statusCode).toBe(403);
  });

  it('creates, updates, and deletes a category', async () => {
    const suffix = Date.now();
    const create = await app.inject({
      method: 'POST',
      url: '/api/v1/checklist-categories',
      headers: { authorization: bearer(admin) },
      payload: { name: `Test category ${suffix}`, sortOrder: 700 },
    });
    expect(create.statusCode).toBe(201);
    const created = create.json();
    expect(created.name).toBe(`Test category ${suffix}`);

    const patch = await app.inject({
      method: 'PATCH',
      url: `/api/v1/checklist-categories/${created.id}`,
      headers: { authorization: bearer(admin) },
      payload: { name: `Updated category ${suffix}`, sortOrder: 710 },
    });
    expect(patch.statusCode).toBe(200);
    expect(patch.json().name).toBe(`Updated category ${suffix}`);

    const del = await app.inject({
      method: 'DELETE',
      url: `/api/v1/checklist-categories/${created.id}`,
      headers: { authorization: bearer(admin) },
    });
    expect(del.statusCode).toBe(200);
    expect(del.json()).toEqual({ deleted: true });
  });

  it('creates, updates, and deletes category items', async () => {
    const suffix = Date.now();
    const create = await app.inject({
      method: 'POST',
      url: '/api/v1/checklist-categories',
      headers: { authorization: bearer(admin) },
      payload: { name: `Item category ${suffix}`, sortOrder: 800 },
    });
    const category = create.json();

    const addItem = await app.inject({
      method: 'POST',
      url: `/api/v1/checklist-categories/${category.id}/items`,
      headers: { authorization: bearer(admin) },
      payload: { label: 'Initial item', sortOrder: 10 },
    });
    expect(addItem.statusCode).toBe(201);
    const item = addItem.json().items[0];
    expect(item.label).toBe('Initial item');

    const updateItem = await app.inject({
      method: 'PATCH',
      url: `/api/v1/checklist-categories/${category.id}/items/${item.id}`,
      headers: { authorization: bearer(admin) },
      payload: { label: 'Updated item', sortOrder: 20 },
    });
    expect(updateItem.statusCode).toBe(200);
    expect(updateItem.json().items[0].label).toBe('Updated item');

    const deleteItem = await app.inject({
      method: 'DELETE',
      url: `/api/v1/checklist-categories/${category.id}/items/${item.id}`,
      headers: { authorization: bearer(admin) },
    });
    expect(deleteItem.statusCode).toBe(200);
    expect(deleteItem.json().items).toHaveLength(0);

    await prisma.checklistTemplate.updateMany({ where: { id: `fixed-${category.id}` }, data: { active: false } });
    await prisma.checklistCategory.delete({ where: { id: category.id } });
  });

  it('rejects deleting a category with checklist execution history', async () => {
    const suffix = Date.now();
    const seedClient = await prisma.client.findFirstOrThrow({ where: { branch: 'SG', deletedAt: null } });
    const seedVessel = await prisma.vessel.findFirstOrThrow({ where: { deletedAt: null } });
    const create = await app.inject({
      method: 'POST',
      url: '/api/v1/checklist-categories',
      headers: { authorization: bearer(admin) },
      payload: { name: `Used category ${suffix}`, sortOrder: 900 },
    });
    const category = create.json();
    const withItem = await app.inject({
      method: 'POST',
      url: `/api/v1/checklist-categories/${category.id}/items`,
      headers: { authorization: bearer(admin) },
      payload: { label: 'Used item', sortOrder: 10 },
    });
    expect(withItem.statusCode).toBe(201);
    const jo = await prisma.jobOrder.create({
      data: {
        joNumber: `SG-CHECKLIST-CAT-${suffix}`,
        branch: 'SG',
        clientId: seedClient.id,
        vesselId: seedVessel.id,
        serviceCategories: [category.id],
        scopeSummary: 'Checklist category in-use fixture',
        origin: 'MANUAL',
        quotedAmountMinor: 100000,
        quotedCurrency: 'SGD',
        state: 'IN_PROGRESS',
        createdBy: admin.id,
      },
    });
    await prisma.checklistInstance.create({
      data: {
        jobOrderId: jo.id,
        templateId: `fixed-${category.id}`,
        results: [{ itemId: withItem.json().items[0].id, value: true }],
        completedById: tech.id,
        completedAt: new Date(),
      },
    });

    const del = await app.inject({
      method: 'DELETE',
      url: `/api/v1/checklist-categories/${category.id}`,
      headers: { authorization: bearer(admin) },
    });

    expect(del.statusCode).toBe(400);
    expect(del.json().error.code).toBe('VALIDATION_ERROR');
  });
});
