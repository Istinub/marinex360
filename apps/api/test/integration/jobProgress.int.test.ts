import { randomUUID } from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { Redis } from 'ioredis';
import { buildApp } from '../../src/app.js';
import {
  PUBLIC_JOB_PROGRESS_RATE_LIMIT,
  publicJobProgressRateLimitKey,
} from '../../src/services/publicJobProgressRateLimit.js';

const run = process.env.RUN_DB_TESTS ? describe : describe.skip;
const SECRET = process.env.JWT_ACCESS_SECRET ?? 'test-secret';

run('Public job progress rate limit (integration)', () => {
  let prisma: PrismaClient;
  let app: ReturnType<typeof buildApp>;
  let redis: InstanceType<typeof Redis> | undefined;
  let admin: any;

  beforeAll(async () => {
    prisma = new PrismaClient();
    redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', { maxRetriesPerRequest: 1 });
    redis.on('error', () => undefined);
    app = buildApp({ prisma, accessSecret: SECRET, presignPut: async () => ({ uploadUrl: 'http://minio/local', headers: {} }) });
    await app.ready();
    admin = await prisma.user.findUniqueOrThrow({ where: { email: 'admin@tkmr.local' } });
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

  async function createSharedJobOrder() {
    const unique = randomUUID();
    const client = await prisma.client.create({
      data: { branch: 'SG', name: `Public Progress Client ${unique}`, status: 'ACTIVE' },
    });
    const vessel = await prisma.vessel.create({
      data: {
        clientId: client.id,
        imoNumber: `PROGRESS-${unique.slice(0, 12)}`,
        name: `Public Progress Vessel ${unique.slice(0, 8)}`,
      },
    });
    return prisma.jobOrder.create({
      data: {
        joNumber: `SG-PROGRESS-${unique.slice(0, 8)}`,
        branch: 'SG',
        clientId: client.id,
        vesselId: vessel.id,
        serviceCategories: ['inspection'],
        scopeSummary: 'Public progress rate limit fixture',
        quotedAmountMinor: 10000,
        quotedCurrency: 'SGD',
        state: 'SCHEDULED',
        deadline: new Date('2026-09-20T00:00:00.000Z'),
        shareToken: `progress-${unique}`,
        createdBy: admin.id,
        statusHistory: {
          create: [{ fromState: 'DRAFT', toState: 'SCHEDULED', actorId: admin.id, at: new Date('2026-09-14T03:30:00.000Z') }],
        },
      },
    });
  }

  it('returns public deadline and reliable last status change timestamp without exposing documents', async () => {
    const jo = await createSharedJobOrder();
    const ip = '203.0.113.62';
    await redis?.del(publicJobProgressRateLimitKey(ip));

    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/public/job-progress/${jo.shareToken}`,
      remoteAddress: ip,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      deadline: '2026-09-20T00:00:00.000Z',
      lastUpdatedAt: '2026-09-14T03:30:00.000Z',
    });
    expect(response.json()).not.toHaveProperty('documents');
    expect(response.json()).not.toHaveProperty('photos');
  });

  it('allows sixty rapid public tracking requests from one IP and rejects the sixty-first', async () => {
    const jo = await createSharedJobOrder();
    const ip = '203.0.113.61';
    const key = publicJobProgressRateLimitKey(ip);
    await redis?.del(key);

    for (let i = 0; i < PUBLIC_JOB_PROGRESS_RATE_LIMIT.maxRequests; i += 1) {
      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/public/job-progress/${jo.shareToken}`,
        remoteAddress: ip,
      });
      expect(response.statusCode).toBe(200);
      expect(response.headers['x-ratelimit-limit']).toBe(String(PUBLIC_JOB_PROGRESS_RATE_LIMIT.maxRequests));
    }

    const rejected = await app.inject({
      method: 'GET',
      url: `/api/v1/public/job-progress/${jo.shareToken}`,
      remoteAddress: ip,
    });
    expect(rejected.statusCode).toBe(429);
    expect(rejected.headers['retry-after']).toBeDefined();
    expect(rejected.json()).toMatchObject({ statusCode: 429, error: 'Too Many Requests' });

    await redis?.del(key);
  }, 15000);
});
