import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { Redis } from 'ioredis';
import { buildApp } from '../../src/app.js';
import { signAccessToken } from '../../src/auth/tokens.js';
import { PUBLIC_JOB_REQUEST_RATE_LIMIT, publicJobRequestRateLimitKey } from '../../src/services/publicJobRequestRateLimit.js';

const run = process.env.RUN_DB_TESTS ? describe : describe.skip;
const SECRET = process.env.JWT_ACCESS_SECRET ?? 'test-secret';
const bearer = (u: { id: string; roles: string[]; branch: string }) =>
  `Bearer ${signAccessToken({ sub: u.id, roles: u.roles as any, branch: u.branch, mfaComplete: true }, SECRET)}`;

run('Job requests (integration)', () => {
  let prisma: PrismaClient;
  let app: ReturnType<typeof buildApp>;
  let redis: InstanceType<typeof Redis> | undefined;
  let sup: any, director: any, admin: any, tech: any, clientUser: any;
  let clientSg: any, clientMy: any, vesselSg: any, vesselMy: any;

  beforeAll(async () => {
    prisma = new PrismaClient();
    redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', { maxRetriesPerRequest: 1 });
    redis.on('error', () => undefined);
    app = buildApp({ prisma, accessSecret: SECRET, presignPut: async () => ({ uploadUrl: 'http://minio/local', headers: {} }) });
    await app.ready();
    sup = await prisma.user.findUniqueOrThrow({ where: { email: 'ops@tkmr.local' } });
    director = await prisma.user.findUniqueOrThrow({ where: { email: 'director@tkmr.local' } });
    admin = await prisma.user.findUniqueOrThrow({ where: { email: 'admin@tkmr.local' } });
    tech = await prisma.user.findUniqueOrThrow({ where: { email: 'tech@tkmr.local' } });
    clientSg = await prisma.client.findFirstOrThrow({ where: { branch: 'SG', deletedAt: null } });
    clientMy = await prisma.client.upsert({ where: { id: 'client-inttest-my' }, update: { branch: 'MY', deletedAt: null }, create: { id: 'client-inttest-my', branch: 'MY', name: 'MY Fixture' } });
    vesselSg = await prisma.vessel.findFirstOrThrow({ where: { clientId: clientSg.id, deletedAt: null } });
    vesselMy = await prisma.vessel.upsert({ where: { id: 'vessel-inttest-my' }, update: { clientId: clientMy.id, deletedAt: null }, create: { id: 'vessel-inttest-my', clientId: clientMy.id, imoNumber: 'MY-INTTEST-1', name: 'MY Vessel' } });
    clientUser = await prisma.user.upsert({ where: { email: 'client-inttest@tkmr.local' }, update: { clientId: clientSg.id, roles: ['CLIENT'], branch: 'SG', active: true }, create: { email: 'client-inttest@tkmr.local', name: 'Client Fixture', passwordHash: 'x', roles: ['CLIENT'], branch: 'SG', clientId: clientSg.id } });
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
    if (redis) {
      await redis.quit().catch(() => {
        redis?.disconnect();
      });
    }
  });

  const publicRequestPayload = (suffix: string) => ({
    guestName: `Guest ${suffix}`,
    guestEmail: `guest-${suffix}@example.test`,
    guestCompany: 'Guest Co',
    vesselDescription: `Guest vessel ${suffix}`,
    scopeSummary: `Guest scope ${suffix}`,
    branch: 'SG',
  });

  it('creates a public guest request without auth and does not allow guest listing', async () => {
    const ip = '203.0.113.20';
    await redis?.del(publicJobRequestRateLimitKey(ip));
    const created = await app.inject({ method: 'POST', url: '/api/v1/job-requests/public', remoteAddress: ip, payload: publicRequestPayload('single') });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ status: 'PENDING', branch: 'SG' });
    expect((await app.inject({ method: 'GET', url: '/api/v1/job-requests' })).statusCode).toBe(401);
  });

  it('rate limits the sixth rapid public request from the same IP', async () => {
    const ip = '203.0.113.21';
    const key = publicJobRequestRateLimitKey(ip);
    await redis?.del(key);

    for (let i = 0; i < PUBLIC_JOB_REQUEST_RATE_LIMIT.maxRequests; i += 1) {
      const response = await app.inject({ method: 'POST', url: '/api/v1/job-requests/public', remoteAddress: ip, payload: publicRequestPayload(`limit-${i}`) });
      expect(response.statusCode).toBe(201);
    }

    const rejected = await app.inject({ method: 'POST', url: '/api/v1/job-requests/public', remoteAddress: ip, payload: publicRequestPayload('limit-6') });
    expect(rejected.statusCode).toBe(429);
    expect(rejected.headers['retry-after']).toBeDefined();
    expect(rejected.json()).toMatchObject({ statusCode: 429, error: 'Too Many Requests' });
    await redis?.del(key);
  });

  it('derives CLIENT request company server-side and ignores body clientId spoofing', async () => {
    const response = await app.inject({ method: 'POST', url: '/api/v1/job-requests', headers: { authorization: bearer(clientUser) }, payload: { clientId: clientMy.id, vesselDescription: 'Client vessel', scopeSummary: 'Client scope' } });
    expect(response.statusCode).toBe(201);
    expect(response.json().clientId).toBe(clientSg.id);
  });

  it('scopes CLIENT jobs and invoices to the linked company', async () => {
    const ownJob = await prisma.jobOrder.upsert({ where: { id: 'jo-inttest-client-own' }, update: { branch: 'SG', clientId: clientSg.id, vesselId: vesselSg.id, scopeSummary: 'Own client job', deletedAt: null }, create: { id: 'jo-inttest-client-own', joNumber: 'SG-INTTEST-CLIENT-OWN', branch: 'SG', clientId: clientSg.id, vesselId: vesselSg.id, scopeSummary: 'Own client job', quotedAmountMinor: 1, quotedCurrency: 'SGD', createdBy: sup.id } });
    const otherJob = await prisma.jobOrder.upsert({ where: { id: 'jo-inttest-client-other' }, update: { branch: 'MY', clientId: clientMy.id, vesselId: vesselMy.id, scopeSummary: 'Other client job', deletedAt: null }, create: { id: 'jo-inttest-client-other', joNumber: 'MY-INTTEST-CLIENT-OTHER', branch: 'MY', clientId: clientMy.id, vesselId: vesselMy.id, scopeSummary: 'Other client job', quotedAmountMinor: 1, quotedCurrency: 'SGD', createdBy: sup.id } });
    const list = await app.inject({ method: 'GET', url: '/api/v1/job-orders', headers: { authorization: bearer(clientUser) } });
    expect(list.statusCode).toBe(200);
    expect(list.json().map((row: any) => row.id)).toContain(ownJob.id);
    expect(list.json().map((row: any) => row.id)).not.toContain(otherJob.id);
    expect((await app.inject({ method: 'GET', url: `/api/v1/job-orders/${otherJob.id}`, headers: { authorization: bearer(clientUser) } })).statusCode).toBe(404);
  });

  it('shows OPS branch scope and lets Director/Admin see cross-branch requests', async () => {
    await prisma.jobRequest.create({ data: { clientId: clientSg.id, vesselDescription: 'SG request', scopeSummary: 'SG scope', branch: 'SG' } });
    await prisma.jobRequest.create({ data: { clientId: clientMy.id, vesselDescription: 'MY request', scopeSummary: 'MY scope', branch: 'MY' } });
    const ops = await app.inject({ method: 'GET', url: '/api/v1/job-requests', headers: { authorization: bearer(sup) } });
    const dir = await app.inject({ method: 'GET', url: '/api/v1/job-requests', headers: { authorization: bearer(director) } });
    const adm = await app.inject({ method: 'GET', url: '/api/v1/job-requests', headers: { authorization: bearer(admin) } });
    expect(ops.json().every((row: any) => row.branch === 'SG')).toBe(true);
    expect(dir.json().some((row: any) => row.branch === 'MY')).toBe(true);
    expect(adm.json().some((row: any) => row.branch === 'MY')).toBe(true);
  });

  it('GET /job-requests/:id returns one branch-scoped request detail', async () => {
    const pending = await prisma.jobRequest.create({
      data: { clientId: clientSg.id, vesselDescription: 'Detail vessel', scopeSummary: 'Detail scope', branch: 'SG' },
    });
    const detail = await app.inject({
      method: 'GET',
      url: `/api/v1/job-requests/${pending.id}`,
      headers: { authorization: bearer(sup) },
    });

    expect(detail.statusCode).toBe(200);
    expect(detail.json()).toMatchObject({
      id: pending.id,
      clientId: clientSg.id,
      vesselDescription: 'Detail vessel',
      scopeSummary: 'Detail scope',
      branch: 'SG',
      status: 'PENDING',
    });
  });

  it('convert produces a real, correctly-linked JobOrder and marks request CONVERTED', async () => {
    const pending = await prisma.jobRequest.create({ data: { clientId: clientSg.id, vesselDescription: 'Convert vessel', scopeSummary: 'Convert scope', branch: 'SG' } });
    const converted = await app.inject({ method: 'POST', url: `/api/v1/job-requests/${pending.id}/convert`, headers: { authorization: bearer(sup) }, payload: { vesselId: vesselSg.id, quotedAmountMinor: 100, quotedCurrency: 'SGD' } });
    expect(converted.statusCode).toBe(200);
    expect(converted.json()).toMatchObject({
      clientId: clientSg.id,
      vesselId: vesselSg.id,
      scopeSummary: 'Convert scope',
      state: 'DRAFT',
      quotedAmountMinor: 100,
      quotedCurrency: 'SGD',
    });
    const updatedRequest = await prisma.jobRequest.findUniqueOrThrow({ where: { id: pending.id } });
    expect(updatedRequest.status).toBe('CONVERTED');
    expect(updatedRequest.convertedJobOrderId).toBe(converted.json().id);
  });

  it('convert with no existing Client creates one from guest info and links the JobOrder', async () => {
    const unique = Date.now();
    const pending = await prisma.jobRequest.create({
      data: {
        guestName: `Guest Convert ${unique}`,
        guestEmail: `guest-convert-${unique}@example.test`,
        guestCompany: `Guest Convert Co ${unique}`,
        vesselDescription: `Guest vessel description ${unique}`,
        scopeSummary: 'Guest conversion scope',
        branch: 'SG',
      },
    });

    const converted = await app.inject({
      method: 'POST',
      url: `/api/v1/job-requests/${pending.id}/convert`,
      headers: { authorization: bearer(sup) },
      payload: { quotedAmountMinor: 12345, quotedCurrency: 'SGD' },
    });

    expect(converted.statusCode).toBe(200);
    const jobOrder = converted.json();
    const client = await prisma.client.findUniqueOrThrow({ where: { id: jobOrder.clientId }, include: { primaryContact: true } });
    const vessel = await prisma.vessel.findUniqueOrThrow({ where: { id: jobOrder.vesselId } });
    expect(client).toMatchObject({ name: `Guest Convert Co ${unique}`, branch: 'SG' });
    expect(client.primaryContact).toMatchObject({ name: `Guest Convert ${unique}`, email: `guest-convert-${unique}@example.test` });
    expect(vessel).toMatchObject({ clientId: client.id, name: `Guest vessel description ${unique}` });
    expect(jobOrder).toMatchObject({ clientId: client.id, vesselId: vessel.id, scopeSummary: 'Guest conversion scope' });
    await expect(prisma.jobRequest.findUniqueOrThrow({ where: { id: pending.id } })).resolves.toMatchObject({
      status: 'CONVERTED',
      convertedJobOrderId: jobOrder.id,
    });
  });

  it('decline sets status without creating a JobOrder', async () => {
    const decline = await prisma.jobRequest.create({ data: { clientId: clientSg.id, vesselDescription: 'Decline vessel', scopeSummary: 'Decline scope', branch: 'SG' } });
    const declined = await app.inject({ method: 'POST', url: `/api/v1/job-requests/${decline.id}/decline`, headers: { authorization: bearer(sup) }, payload: { declineReason: 'Outside service scope' } });
    expect(declined.statusCode).toBe(200);
    const updated = await prisma.jobRequest.findUniqueOrThrow({ where: { id: decline.id } });
    expect(updated.status).toBe('DECLINED');
    expect(updated.convertedJobOrderId).toBeNull();
    expect(await prisma.jobOrder.count({ where: { scopeSummary: 'Decline scope' } })).toBe(0);
  });

  it('blocks non-Ops/Admin/Director from convert and decline actions', async () => {
    const convertRequest = await prisma.jobRequest.create({ data: { clientId: clientSg.id, vesselDescription: 'Tech convert vessel', scopeSummary: 'Tech convert scope', branch: 'SG' } });
    const declineRequest = await prisma.jobRequest.create({ data: { clientId: clientSg.id, vesselDescription: 'Tech decline vessel', scopeSummary: 'Tech decline scope', branch: 'SG' } });

    const convert = await app.inject({
      method: 'POST',
      url: `/api/v1/job-requests/${convertRequest.id}/convert`,
      headers: { authorization: bearer(tech) },
      payload: { vesselId: vesselSg.id, quotedAmountMinor: 100, quotedCurrency: 'SGD' },
    });
    const decline = await app.inject({
      method: 'POST',
      url: `/api/v1/job-requests/${declineRequest.id}/decline`,
      headers: { authorization: bearer(tech) },
      payload: { declineReason: 'No access' },
    });

    expect(convert.statusCode).toBe(403);
    expect(decline.statusCode).toBe(403);
    await expect(prisma.jobRequest.findUniqueOrThrow({ where: { id: convertRequest.id } })).resolves.toMatchObject({ status: 'PENDING', convertedJobOrderId: null });
    await expect(prisma.jobRequest.findUniqueOrThrow({ where: { id: declineRequest.id } })).resolves.toMatchObject({ status: 'PENDING', convertedJobOrderId: null });
  });

  it('keeps technician self-assignment capability available', async () => {
    expect((await app.inject({ method: 'POST', url: '/api/v1/job-orders/does-not-exist/self-assign', headers: { authorization: bearer(tech) }, payload: { version: 0 } })).statusCode).toBe(404);
  });
});
