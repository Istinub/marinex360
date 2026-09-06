import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { Redis } from 'ioredis';
import { buildApp } from '../../src/app.js';
import { hashPassword } from '../../src/auth/password.js';
import { verifyAccessToken } from '../../src/auth/tokens.js';
import { DEVICE_UNLOCK_RATE_LIMIT, deviceUnlockRateLimitKey } from '../../src/services/deviceUnlockRateLimit.js';

const run = process.env.RUN_DB_TESTS ? describe : describe.skip;
const SECRET = process.env.JWT_ACCESS_SECRET ?? 'test-secret';

run('Devices (integration)', () => {
  let prisma: PrismaClient;
  let app: ReturnType<typeof buildApp>;
  let redis: InstanceType<typeof Redis> | undefined;
  let tech: any;

  beforeAll(async () => {
    prisma = new PrismaClient();
    redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', { maxRetriesPerRequest: 1 });
    redis.on('error', () => undefined);
    app = buildApp({ prisma, accessSecret: SECRET, presignPut: async () => ({ uploadUrl: 'http://minio/local', headers: {} }) });
    await app.ready();
    tech = await prisma.user.findUniqueOrThrow({ where: { email: 'tech@tkmr.local' } });
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

  async function seedDevice(id: string, pin: string) {
    await redis?.del(deviceUnlockRateLimitKey('127.0.0.1', id));
    return prisma.device.upsert({
      where: { id },
      update: { pin: await hashPassword(pin), assignedUserId: tech.id, branch: tech.branch, name: id },
      create: { id, pin: await hashPassword(pin), assignedUserId: tech.id, branch: tech.branch, name: id },
    });
  }

  it('unlocks a device with the correct PIN as the assigned user', async () => {
    const device = await seedDevice('device-inttest-unlock-ok', '2468');
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/devices/${device.id}/unlock`,
      payload: { pin: '2468' },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(typeof body.access).toBe('string');
    expect(typeof body.refresh).toBe('string');
    const claims = verifyAccessToken(body.access, SECRET);
    expect(claims.sub).toBe(tech.id);
    expect(claims.branch).toBe(tech.branch);
  });

  it('unlocks by PIN only as the matching device assigned user', async () => {
    await seedDevice('device-inttest-unlock-by-pin', '8642');
    await redis?.del(deviceUnlockRateLimitKey('127.0.0.1', 'unknown'));

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/devices/unlock-by-pin',
      payload: { pin: '8642' },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(typeof body.access).toBe('string');
    expect(typeof body.refresh).toBe('string');
    const claims = verifyAccessToken(body.access, SECRET);
    expect(claims.sub).toBe(tech.id);
    expect(claims.branch).toBe(tech.branch);
    await redis?.del(deviceUnlockRateLimitKey('127.0.0.1', 'unknown'));
  });

  it('rejects a wrong PIN with a generic unauthorized response', async () => {
    const device = await seedDevice('device-inttest-unlock-wrong', '1357');
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/devices/${device.id}/unlock`,
      payload: { pin: '0000' },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe('UNAUTHORIZED');
  });

  it('rejects a wrong PIN-only unlock with a generic unauthorized response', async () => {
    await seedDevice('device-inttest-unlock-by-pin-wrong', '7531');
    await redis?.del(deviceUnlockRateLimitKey('127.0.0.1', 'unknown'));

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/devices/unlock-by-pin',
      payload: { pin: '9999' },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe('UNAUTHORIZED');
    await redis?.del(deviceUnlockRateLimitKey('127.0.0.1', 'unknown'));
  });

  it('rate limits repeated wrong unlock attempts', async () => {
    const device = await seedDevice('device-inttest-unlock-rate', '9876');
    const ip = '198.51.100.42';
    await redis?.del(deviceUnlockRateLimitKey(ip, device.id));

    for (let i = 0; i < DEVICE_UNLOCK_RATE_LIMIT.maxRequests; i += 1) {
      const response = await app.inject({
        method: 'POST',
        url: `/api/v1/devices/${device.id}/unlock`,
        remoteAddress: ip,
        payload: { pin: '1111' },
      });
      expect(response.statusCode).toBe(401);
    }

    const rejected = await app.inject({
      method: 'POST',
      url: `/api/v1/devices/${device.id}/unlock`,
      remoteAddress: ip,
      payload: { pin: '1111' },
    });
    expect(rejected.statusCode).toBe(429);
    expect(rejected.headers['retry-after']).toBeDefined();
    expect(rejected.json()).toMatchObject({ statusCode: 429, error: 'Too Many Requests' });
    await redis?.del(deviceUnlockRateLimitKey(ip, device.id));
  });

  it('rate limits repeated wrong PIN-only unlock attempts', async () => {
    await seedDevice('device-inttest-unlock-by-pin-rate', '4567');
    const ip = '198.51.100.43';
    await redis?.del(deviceUnlockRateLimitKey(ip, 'unknown'));

    for (let i = 0; i < DEVICE_UNLOCK_RATE_LIMIT.maxRequests; i += 1) {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/devices/unlock-by-pin',
        remoteAddress: ip,
        payload: { pin: '9998' },
      });
      expect(response.statusCode).toBe(401);
    }

    const rejected = await app.inject({
      method: 'POST',
      url: '/api/v1/devices/unlock-by-pin',
      remoteAddress: ip,
      payload: { pin: '9998' },
    });
    expect(rejected.statusCode).toBe(429);
    expect(rejected.headers['retry-after']).toBeDefined();
    expect(rejected.json()).toMatchObject({ statusCode: 429, error: 'Too Many Requests' });
    await redis?.del(deviceUnlockRateLimitKey(ip, 'unknown'));
  });
});
