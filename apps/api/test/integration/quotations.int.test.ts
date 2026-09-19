import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { Queue } from 'bullmq';
import { buildApp } from '../../src/app.js';
import { signAccessToken } from '../../src/auth/tokens.js';

const run = process.env.RUN_DB_TESTS ? describe : describe.skip;
const SECRET = process.env.JWT_ACCESS_SECRET ?? 'test-secret';
const bearer = (user: { id: string; roles: string[]; branch: string }) =>
  `Bearer ${signAccessToken({ sub: user.id, roles: user.roles as any, branch: user.branch, mfaComplete: true }, SECRET)}`;

run('Quotations (integration)', () => {
  let prisma: PrismaClient;
  let app: ReturnType<typeof buildApp>;
  let queue: Queue;
  let ops: any;
  let admin: any;
  let uniq: string;

  beforeAll(async () => {
    prisma = new PrismaClient();
    app = buildApp({ prisma, accessSecret: SECRET, presignPut: async () => ({ uploadUrl: 'http://minio/local', headers: {} }) });
    await app.ready();
    const redisUrl = new URL(process.env.REDIS_URL ?? 'redis://localhost:6379');
    queue = new Queue('quotation-pdf-generation', { connection: { host: redisUrl.hostname, port: Number(redisUrl.port || 6379) } });
    ops = await prisma.user.findUniqueOrThrow({ where: { email: 'ops@tkmr.local' } });
    admin = await prisma.user.findUniqueOrThrow({ where: { email: 'admin@tkmr.local' } });
    uniq = Date.now().toString().slice(-8);
  });

  afterAll(async () => {
    await queue?.close();
    await app.close();
    await prisma.$disconnect();
  });

  function payload(suffix: string) {
    return {
      branch: 'SG',
      manualClientName: `Quotation Fixture Client ${uniq}-${suffix}`,
      manualVesselName: `MV Quote ${suffix}`,
      category: 'MECHANICAL',
      quotationDate: '2026-09-18',
      location: 'Singapore',
      currency: 'SGD',
      validityDays: 30,
      workDurationText: '3 working days',
      lines: [
        {
          itemCode: 'A',
          description: 'Pump overhaul',
          unit: 'sets',
          quantity: 2,
          unitPrice: 1250,
          remarks: 'Workshop scope',
        },
        {
          itemCode: 'B',
          description: 'Sea trial attendance if required',
          unit: 'lot',
          quantity: null,
          unitPrice: null,
          remarks: 'TBA',
        },
      ],
    };
  }

  it('creates quotations with collision-safe sequence numbers and preserves TBA line amounts', async () => {
    const first = await app.inject({
      method: 'POST',
      url: '/api/v1/quotations',
      headers: { authorization: bearer(ops) },
      payload: payload('ONE'),
    });
    const second = await app.inject({
      method: 'POST',
      url: '/api/v1/quotations',
      headers: { authorization: bearer(admin) },
      payload: payload('TWO'),
    });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    const firstBody = first.json();
    const secondBody = second.json();
    expect(firstBody.quotationNumber).toMatch(/^QT-PTTKMR-26-09-\d{3,}$/);
    expect(secondBody.quotationNumber).toMatch(/^QT-PTTKMR-26-09-\d{3,}$/);
    const firstSeq = Number(firstBody.quotationNumber.split('-').at(-1));
    const secondSeq = Number(secondBody.quotationNumber.split('-').at(-1));
    expect(secondSeq).toBe(firstSeq + 1);
    expect(firstBody.lines[0].amount).toBe('2500');
    expect(firstBody.lines[1].amount).toBeNull();

    const detail = await app.inject({ method: 'GET', url: `/api/v1/quotations/${firstBody.id}`, headers: { authorization: bearer(ops) } });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().lines[1].amount).toBeNull();
  });

  it('edits draft quotations with optimistic concurrency and queues PDF generation', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/quotations',
      headers: { authorization: bearer(admin) },
      payload: payload('EDIT'),
    });
    expect(created.statusCode).toBe(200);
    const quotation = created.json();

    const update = await app.inject({
      method: 'PATCH',
      url: `/api/v1/quotations/${quotation.id}`,
      headers: { authorization: bearer(admin) },
      payload: {
        version: quotation.version,
        category: 'PROPULSION',
        validityDays: 45,
        lines: [
          { description: 'Adjusted propulsion scope', unit: 'hours', quantity: 4, unitPrice: 300 },
          { description: 'Specialist part', unit: 'pcs', quantity: null, unitPrice: null, remarks: 'TBA' },
        ],
      },
    });
    expect(update.statusCode).toBe(200);
    expect(update.json().category).toBe('PROPULSION');
    expect(update.json().validityDays).toBe(45);
    expect(update.json().lines[0].amount).toBe('1200');
    expect(update.json().lines[1].amount).toBeNull();

    const generate = await app.inject({
      method: 'POST',
      url: `/api/v1/quotations/${quotation.id}/generate-pdf`,
      headers: { authorization: bearer(admin) },
    });
    expect(generate.statusCode).toBe(200);
    expect(generate.json()).toEqual({ status: 'QUEUED' });
    const jobs = await queue.getJobs(['waiting', 'delayed', 'prioritized', 'paused', 'active', 'completed', 'failed']);
    expect(jobs.some((job) => job.name === 'generate' && job.data.quotationId === quotation.id)).toBe(true);

    const pdf = await app.inject({ method: 'GET', url: `/api/v1/quotations/${quotation.id}/pdf`, headers: { authorization: bearer(admin) } });
    expect(pdf.statusCode).toBe(200);
    expect(pdf.json()).toEqual({ status: 'PENDING' });
  });

  it('duplicates quotations with a fresh number and clears client/vessel assignment', async () => {
    const client = await prisma.client.create({ data: { branch: 'SG', name: `Quotation Duplicate Client ${uniq}` } });
    const vessel = await prisma.vessel.create({ data: { clientId: client.id, imoNumber: `8${uniq}01`.slice(0, 12), name: `MV Quote Duplicate ${uniq}` } });
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/quotations',
      headers: { authorization: bearer(admin) },
      payload: { ...payload('DUP'), clientId: client.id, vesselId: vessel.id, manualClientName: null, manualVesselName: null },
    });
    expect(created.statusCode).toBe(200);
    const source = created.json();

    const duplicate = await app.inject({
      method: 'POST',
      url: `/api/v1/quotations/${source.id}/duplicate`,
      headers: { authorization: bearer(admin) },
    });

    expect(duplicate.statusCode).toBe(200);
    const body = duplicate.json();
    expect(body.id).not.toBe(source.id);
    expect(body.quotationNumber).not.toBe(source.quotationNumber);
    expect(body.clientId).toBeNull();
    expect(body.vesselId).toBeNull();
    expect(body.manualClientName).toBeNull();
    expect(body.manualVesselName).toBeNull();
    expect(body.lines).toHaveLength(source.lines.length);
    expect(body.lines.map((line: any) => line.description)).toEqual(source.lines.map((line: any) => line.description));
  });

  it('searches past quotation lines with quotation context and copies selected lines as snapshots', async () => {
    const source = await app.inject({
      method: 'POST',
      url: '/api/v1/quotations',
      headers: { authorization: bearer(admin) },
      payload: {
        ...payload('HISTORY-SOURCE'),
        manualClientName: `History Copy Client ${uniq}`,
        manualVesselName: `LPG History ${uniq}`,
        category: 'PROPULSION',
        lines: [
          {
            itemCode: 'HC-1',
            description: `History-copy stern tube seal renewal ${uniq}`,
            unit: 'SET',
            quantity: 2,
            unitPrice: 775,
            remarks: 'Reusable history line',
          },
          {
            itemCode: 'HC-2',
            description: `History-copy auxiliary attendance ${uniq}`,
            unit: 'LOT',
            quantity: null,
            unitPrice: null,
            remarks: 'TBA',
          },
        ],
      },
    });
    expect(source.statusCode).toBe(200);
    const sourceBody = source.json();

    const search = await app.inject({
      method: 'GET',
      url: `/api/v1/quotations/lines/search?keyword=stern%20tube&category=PROPULSION&pageSize=10`,
      headers: { authorization: bearer(admin) },
    });
    expect(search.statusCode).toBe(200);
    const found = search.json().items.find((line: any) => line.id === sourceBody.lines[0].id);
    expect(found).toMatchObject({
      itemCode: 'HC-1',
      description: `History-copy stern tube seal renewal ${uniq}`,
      unit: 'SET',
      quantity: '2',
      unitPrice: '775',
      amount: '1550',
    });
    expect(found.quotation).toMatchObject({
      quotationNumber: sourceBody.quotationNumber,
      category: 'PROPULSION',
      clientName: `History Copy Client ${uniq}`,
      vesselName: `LPG History ${uniq}`,
      currency: 'SGD',
    });

    const target = await app.inject({
      method: 'POST',
      url: '/api/v1/quotations',
      headers: { authorization: bearer(admin) },
      payload: {
        ...payload('HISTORY-TARGET'),
        lines: [{ description: `Target starter line ${uniq}`, unit: 'LOT', quantity: 1, unitPrice: 1 }],
      },
    });
    expect(target.statusCode).toBe(200);
    const targetBody = target.json();

    const copy = await app.inject({
      method: 'POST',
      url: `/api/v1/quotations/${targetBody.id}/copy-lines`,
      headers: { authorization: bearer(admin) },
      payload: [sourceBody.lines[0].id],
    });
    expect(copy.statusCode).toBe(200);
    const copied = copy.json();
    const copiedLine = copied.lines.find((line: any) => line.description === `History-copy stern tube seal renewal ${uniq}`);
    expect(copiedLine).toMatchObject({
      itemCode: 'HC-1',
      unit: 'SET',
      quantity: '2',
      unitPrice: '775',
      amount: '1550',
      remarks: 'Reusable history line',
    });
    expect(copiedLine.id).not.toBe(sourceBody.lines[0].id);

    const sourceEdit = await app.inject({
      method: 'PATCH',
      url: `/api/v1/quotations/${sourceBody.id}`,
      headers: { authorization: bearer(admin) },
      payload: {
        version: sourceBody.version,
        lines: [{ description: `Original changed after copy ${uniq}`, unit: 'SET', quantity: 1, unitPrice: 99 }],
      },
    });
    expect(sourceEdit.statusCode).toBe(200);

    const copiedDetail = await app.inject({
      method: 'GET',
      url: `/api/v1/quotations/${targetBody.id}`,
      headers: { authorization: bearer(admin) },
    });
    expect(copiedDetail.statusCode).toBe(200);
    expect(copiedDetail.json().lines.some((line: any) => line.description === `History-copy stern tube seal renewal ${uniq}`)).toBe(true);
    expect(copiedDetail.json().lines.some((line: any) => line.description === `Original changed after copy ${uniq}`)).toBe(false);
  });

  it('moves quotations to trash, excludes them from the main list, and restores them', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/quotations',
      headers: { authorization: bearer(admin) },
      payload: payload('TRASH'),
    });
    expect(created.statusCode).toBe(200);
    const quotation = created.json();

    const remove = await app.inject({
      method: 'POST',
      url: `/api/v1/quotations/${quotation.id}/delete`,
      headers: { authorization: bearer(ops) },
    });
    expect(remove.statusCode).toBe(200);
    expect(remove.json()).toEqual({ deleted: true });

    const mainList = await app.inject({ method: 'GET', url: '/api/v1/quotations', headers: { authorization: bearer(admin) } });
    expect(mainList.statusCode).toBe(200);
    expect(mainList.json().some((row: any) => row.id === quotation.id)).toBe(false);

    const trash = await app.inject({ method: 'GET', url: '/api/v1/quotations/trash', headers: { authorization: bearer(admin) } });
    expect(trash.statusCode).toBe(200);
    const trashed = trash.json().find((row: any) => row.id === quotation.id);
    expect(trashed?.deletedAt).toBeTruthy();

    const detailWhileTrashed = await app.inject({ method: 'GET', url: `/api/v1/quotations/${quotation.id}`, headers: { authorization: bearer(admin) } });
    expect(detailWhileTrashed.statusCode).toBe(404);

    const restore = await app.inject({
      method: 'POST',
      url: `/api/v1/quotations/${quotation.id}/restore`,
      headers: { authorization: bearer(admin) },
    });
    expect(restore.statusCode).toBe(200);
    expect(restore.json()).toEqual({ restored: true });

    const restoredList = await app.inject({ method: 'GET', url: '/api/v1/quotations', headers: { authorization: bearer(admin) } });
    expect(restoredList.statusCode).toBe(200);
    expect(restoredList.json().some((row: any) => row.id === quotation.id)).toBe(true);
  });

  it('creates, applies, and snapshots quotation line templates', async () => {
    const createTemplate = await app.inject({
      method: 'POST',
      url: '/api/v1/quotation-line-templates',
      headers: { authorization: bearer(admin) },
      payload: {
        name: `Propulsion template ${uniq}`,
        category: 'PROPULSION',
        entries: [
          { itemCode: 'P1', description: 'Template propulsion check', unit: 'sets', typicalUnitPrice: 450 },
          { itemCode: 'P2', description: 'Template sea trial', unit: 'lot', typicalUnitPrice: null },
        ],
      },
    });
    expect(createTemplate.statusCode).toBe(201);
    const template = createTemplate.json();
    expect(template.entries[0].typicalUnitPrice).toBe('450');

    const list = await app.inject({
      method: 'GET',
      url: '/api/v1/quotation-line-templates?category=PROPULSION',
      headers: { authorization: bearer(ops) },
    });
    expect(list.statusCode).toBe(200);
    expect(list.json().some((row: any) => row.id === template.id)).toBe(true);

    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/quotations',
      headers: { authorization: bearer(admin) },
      payload: payload('TPL'),
    });
    expect(created.statusCode).toBe(200);
    const quotation = created.json();
    const apply = await app.inject({
      method: 'POST',
      url: `/api/v1/quotations/${quotation.id}/apply-template/${template.id}`,
      headers: { authorization: bearer(admin) },
    });
    expect(apply.statusCode).toBe(200);
    const applied = apply.json();
    expect(applied.lines.some((line: any) => line.description === 'Template propulsion check')).toBe(true);

    const updateTemplate = await app.inject({
      method: 'PATCH',
      url: `/api/v1/quotation-line-templates/${template.id}`,
      headers: { authorization: bearer(admin) },
      payload: {
        name: template.name,
        entries: [{ itemCode: 'P1', description: 'Template changed later', unit: 'sets', typicalUnitPrice: 999 }],
      },
    });
    expect(updateTemplate.statusCode).toBe(200);

    const detail = await app.inject({ method: 'GET', url: `/api/v1/quotations/${quotation.id}`, headers: { authorization: bearer(admin) } });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().lines.some((line: any) => line.description === 'Template propulsion check')).toBe(true);
    expect(detail.json().lines.some((line: any) => line.description === 'Template changed later')).toBe(false);
  });

  it('saves a quotation current line set as a new template', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/quotations',
      headers: { authorization: bearer(admin) },
      payload: payload('FROM'),
    });
    expect(created.statusCode).toBe(200);
    const quotation = created.json();

    const template = await app.inject({
      method: 'POST',
      url: `/api/v1/quotation-line-templates/from-quotation/${quotation.id}`,
      headers: { authorization: bearer(admin) },
      payload: { name: `Saved from quotation ${uniq}`, category: quotation.category },
    });
    expect(template.statusCode).toBe(201);
    expect(template.json().entries.map((entry: any) => entry.description)).toEqual(quotation.lines.map((line: any) => line.description));
  });
});
