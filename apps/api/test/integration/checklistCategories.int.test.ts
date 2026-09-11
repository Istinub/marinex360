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
  let admin: any, director: any, tech: any, sup: any;

  beforeAll(async () => {
    prisma = new PrismaClient();
    const presignPut = async () => ({ uploadUrl: 'http://minio/local', headers: {} });
    app = buildApp({ prisma, accessSecret: SECRET, presignPut });
    await app.ready();
    admin = await prisma.user.findUniqueOrThrow({ where: { email: 'admin@tkmr.local' } });
    director = await prisma.user.findUniqueOrThrow({ where: { email: 'director@tkmr.local' } });
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
      payload: { name: 'Supervisor blocked' },
    });

    expect(res.statusCode).toBe(403);
  });

  it('creates, updates, and deletes a category', async () => {
    const suffix = Date.now();
    const create = await app.inject({
      method: 'POST',
      url: '/api/v1/checklist-categories',
      headers: { authorization: bearer(admin) },
      payload: { name: `Test category ${suffix}` },
    });
    expect(create.statusCode).toBe(201);
    const created = create.json();
    expect(created.name).toBe(`Test category ${suffix}`);

    const patch = await app.inject({
      method: 'PATCH',
      url: `/api/v1/checklist-categories/${created.id}`,
      headers: { authorization: bearer(admin) },
      payload: { name: `Updated category ${suffix}` },
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
      payload: { name: `Item category ${suffix}` },
    });
    const category = create.json();

    const addItem = await app.inject({
      method: 'POST',
      url: `/api/v1/checklist-categories/${category.id}/items`,
      headers: { authorization: bearer(admin) },
      payload: { label: 'Initial item' },
    });
    expect(addItem.statusCode).toBe(201);
    const item = addItem.json().items[0];
    expect(item.label).toBe('Initial item');

    const updateItem = await app.inject({
      method: 'PATCH',
      url: `/api/v1/checklist-categories/${category.id}/items/${item.id}`,
      headers: { authorization: bearer(admin) },
      payload: { label: 'Updated item' },
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

  it('creates, reads, updates, and deletes named checklist templates and entries', async () => {
    const suffix = Date.now();
    const category = await prisma.checklistCategory.create({
      data: { name: `Template fixture category ${suffix}` },
    });

    const create = await app.inject({
      method: 'POST',
      url: '/api/v1/checklist-templates',
      headers: { authorization: bearer(admin) },
      payload: {
        name: `Reusable template ${suffix}`,
        categoryId: category.id,
        entries: [{ label: 'Initial reusable item' }],
      },
    });
    expect(create.statusCode).toBe(201);
    const template = create.json();
    expect(template.categoryId).toBe(category.id);
    expect(template.entries).toHaveLength(1);

    const list = await app.inject({
      method: 'GET',
      url: `/api/v1/checklist-templates?categoryId=${category.id}`,
      headers: { authorization: bearer(tech) },
    });
    expect(list.statusCode).toBe(200);
    expect(list.json().some((candidate: any) => candidate.id === template.id)).toBe(true);

    const addEntry = await app.inject({
      method: 'POST',
      url: `/api/v1/checklist-templates/${template.id}/entries`,
      headers: { authorization: bearer(director) },
      payload: { label: 'Second reusable item' },
    });
    expect(addEntry.statusCode).toBe(201);

    const updateEntry = await app.inject({
      method: 'PATCH',
      url: `/api/v1/checklist-templates/${template.id}/entries/${addEntry.json().id}`,
      headers: { authorization: bearer(admin) },
      payload: { label: 'Updated reusable item' },
    });
    expect(updateEntry.statusCode).toBe(200);
    expect(updateEntry.json().label).toBe('Updated reusable item');

    const updateTemplate = await app.inject({
      method: 'PATCH',
      url: `/api/v1/checklist-templates/${template.id}`,
      headers: { authorization: bearer(admin) },
      payload: { name: `Updated template ${suffix}`, categoryId: null },
    });
    expect(updateTemplate.statusCode).toBe(200);
    expect(updateTemplate.json()).toMatchObject({ name: `Updated template ${suffix}`, categoryId: null });

    const deleteEntry = await app.inject({
      method: 'DELETE',
      url: `/api/v1/checklist-templates/${template.id}/entries/${addEntry.json().id}`,
      headers: { authorization: bearer(admin) },
    });
    expect(deleteEntry.statusCode).toBe(200);

    const del = await app.inject({
      method: 'DELETE',
      url: `/api/v1/checklist-templates/${template.id}`,
      headers: { authorization: bearer(admin) },
    });
    expect(del.statusCode).toBe(200);
    expect(del.json()).toEqual({ deleted: true });
    await prisma.checklistCategory.delete({ where: { id: category.id } });
  });

  it('creates independent checklist templates without creating a category', async () => {
    const suffix = Date.now();
    const before = await prisma.checklistCategory.count({ where: { name: { startsWith: 'Template category ' } } });
    const create = await app.inject({
      method: 'POST',
      url: '/api/v1/checklist-templates',
      headers: { authorization: bearer(admin) },
      payload: {
        name: `Independent template ${suffix}`,
        entries: [{ label: 'Independent reusable item' }],
      },
    });

    expect(create.statusCode).toBe(201);
    expect(create.json()).toMatchObject({ name: `Independent template ${suffix}`, categoryId: null });
    expect(create.json().entries).toHaveLength(1);
    await expect(prisma.checklistCategory.count({ where: { name: { startsWith: 'Template category ' } } })).resolves.toBe(before);

    const del = await app.inject({
      method: 'DELETE',
      url: `/api/v1/checklist-templates/${create.json().id}`,
      headers: { authorization: bearer(admin) },
    });
    expect(del.statusCode).toBe(200);
  });

  it('copies checklist template entries onto a Job Order snapshot that does not change when the template changes', async () => {
    const suffix = Date.now();
    const seedClient = await prisma.client.findFirstOrThrow({ where: { branch: 'SG', deletedAt: null } });
    const seedVessel = await prisma.vessel.findFirstOrThrow({ where: { deletedAt: null, clientId: seedClient.id } });
    const category = await prisma.checklistCategory.create({
      data: { name: `Snapshot category ${suffix}` },
    });
    const template = await prisma.checklistTemplate.create({
      data: {
        name: `Snapshot template ${suffix}`,
        categoryId: category.id,
        serviceCategory: category.id,
        createdBy: admin.id,
        items: [{ id: 'legacy-one', label: 'Snapshot item one' }],
        entries: {
          create: [
            { label: 'Snapshot item one' },
            { label: 'Snapshot item two' },
          ],
        },
      },
    });

    const createJo = await app.inject({
      method: 'POST',
      url: '/api/v1/job-orders',
      headers: { authorization: bearer(director) },
      payload: {
        clientId: seedClient.id,
        vesselId: seedVessel.id,
        serviceCategories: [category.id],
        scopeSummary: 'Snapshot checklist job',
        quotedAmountMinor: 100000,
        quotedCurrency: 'SGD',
        checklistTemplateId: template.id,
      },
    });
    expect(createJo.statusCode).toBe(201);

    const scheduleJo = await app.inject({
      method: 'POST',
      url: `/api/v1/job-orders/${createJo.json().id}/transition`,
      headers: { authorization: bearer(director) },
      payload: { to: 'SCHEDULED', version: createJo.json().version },
    });
    expect(scheduleJo.statusCode).toBe(200);
    expect(scheduleJo.json().state).toBe('SCHEDULED');

    await prisma.checklistTemplateEntry.create({
      data: { templateId: template.id, label: 'Added after job creation' },
    });

    const jobItems = await app.inject({
      method: 'GET',
      url: `/api/v1/job-orders/${createJo.json().id}/checklist-items`,
      headers: { authorization: bearer(director) },
    });
    expect(jobItems.statusCode).toBe(200);
    expect(jobItems.json().map((item: any) => item.label)).toEqual(['Snapshot item one', 'Snapshot item two']);
  });

  it('rejects deleting a category with checklist execution history', async () => {
    const suffix = Date.now();
    const seedClient = await prisma.client.findFirstOrThrow({ where: { branch: 'SG', deletedAt: null } });
    const seedVessel = await prisma.vessel.findFirstOrThrow({ where: { deletedAt: null } });
    const create = await app.inject({
      method: 'POST',
      url: '/api/v1/checklist-categories',
      headers: { authorization: bearer(admin) },
      payload: { name: `Used category ${suffix}` },
    });
    const category = create.json();
    const withItem = await app.inject({
      method: 'POST',
      url: `/api/v1/checklist-categories/${category.id}/items`,
      headers: { authorization: bearer(admin) },
      payload: { label: 'Used item' },
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

  it('adding a job checklist item to a completed job reopens it to ON_HOLD when no invoice exists', async () => {
    const suffix = Date.now();
    const seedClient = await prisma.client.findFirstOrThrow({ where: { branch: 'SG', deletedAt: null } });
    const seedVessel = await prisma.vessel.findFirstOrThrow({ where: { deletedAt: null, clientId: seedClient.id } });
    const category = await prisma.checklistCategory.create({
      data: { name: `Reopen category ${suffix}` },
    });
    await prisma.checklistTemplate.create({
      data: { id: `fixed-${category.id}`, name: `${category.name} checklist`, serviceCategory: category.id, items: [], active: true },
    });
    const jo = await prisma.jobOrder.create({
      data: {
        joNumber: `SG-CHECKLIST-REOPEN-${suffix}`,
        branch: 'SG',
        clientId: seedClient.id,
        vesselId: seedVessel.id,
        serviceCategories: [category.id],
        scopeSummary: 'Completed job needs new checklist item',
        origin: 'MANUAL',
        quotedAmountMinor: 100000,
        quotedCurrency: 'SGD',
        state: 'COMPLETED',
        createdBy: admin.id,
      },
    });

    const addItem = await app.inject({
      method: 'POST',
      url: `/api/v1/job-orders/${jo.id}/checklist-items`,
      headers: { authorization: bearer(director) },
      payload: { label: 'New verification item' },
    });

    expect(addItem.statusCode).toBe(201);
    expect(addItem.json().jobOrderId).toBe(jo.id);
    await expect(prisma.jobOrder.findUnique({ where: { id: jo.id } })).resolves.toMatchObject({ state: 'ON_HOLD' });
    const history = await prisma.jobStatusHistory.findFirstOrThrow({
      where: { jobOrderId: jo.id, toState: 'ON_HOLD' },
      orderBy: { at: 'desc' },
    });
    expect(history.reason).toBe('New checklist item added — requires re-verification');
  });

  it('rejects adding a checklist item to an invoiced job', async () => {
    const suffix = Date.now();
    const seedClient = await prisma.client.findFirstOrThrow({ where: { branch: 'SG', deletedAt: null } });
    const seedVessel = await prisma.vessel.findFirstOrThrow({ where: { deletedAt: null, clientId: seedClient.id } });
    const category = await prisma.checklistCategory.create({
      data: { name: `Invoiced category ${suffix}` },
    });
    await prisma.checklistTemplate.create({
      data: { id: `fixed-${category.id}`, name: `${category.name} checklist`, serviceCategory: category.id, items: [], active: true },
    });
    const jo = await prisma.jobOrder.create({
      data: {
        joNumber: `SG-CHECKLIST-INVOICED-${suffix}`,
        branch: 'SG',
        clientId: seedClient.id,
        vesselId: seedVessel.id,
        serviceCategories: [category.id],
        scopeSummary: 'Invoiced job should not reopen',
        origin: 'MANUAL',
        quotedAmountMinor: 100000,
        quotedCurrency: 'SGD',
        state: 'INVOICED',
        createdBy: admin.id,
      },
    });

    const addItem = await app.inject({
      method: 'POST',
      url: `/api/v1/job-orders/${jo.id}/checklist-items`,
      headers: { authorization: bearer(admin) },
      payload: { label: 'Blocked item' },
    });

    expect(addItem.statusCode).toBe(400);
    expect(addItem.json().error.code).toBe('VALIDATION_ERROR');
    expect(addItem.json().error.message).toBe('Cannot modify checklist after invoicing');
    await expect(prisma.jobOrder.findUnique({ where: { id: jo.id } })).resolves.toMatchObject({ state: 'INVOICED' });
  });

  it('blocks non-Director/Admin roles from adding a job checklist item that would reopen a completed job', async () => {
    const suffix = Date.now();
    const seedClient = await prisma.client.findFirstOrThrow({ where: { branch: 'SG', deletedAt: null } });
    const seedVessel = await prisma.vessel.findFirstOrThrow({ where: { deletedAt: null, clientId: seedClient.id } });
    const jo = await prisma.jobOrder.create({
      data: {
        joNumber: `SG-CHECKLIST-BLOCKED-${suffix}`,
        branch: 'SG',
        clientId: seedClient.id,
        vesselId: seedVessel.id,
        serviceCategories: [],
        scopeSummary: 'Supervisor should not reopen',
        origin: 'MANUAL',
        quotedAmountMinor: 100000,
        quotedCurrency: 'SGD',
        state: 'COMPLETED',
        createdBy: admin.id,
      },
    });

    const addItem = await app.inject({
      method: 'POST',
      url: `/api/v1/job-orders/${jo.id}/checklist-items`,
      headers: { authorization: bearer(sup) },
      payload: { label: 'Supervisor blocked item' },
    });

    expect(addItem.statusCode).toBe(403);
  });
});
