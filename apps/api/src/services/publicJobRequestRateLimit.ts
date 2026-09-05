import type { FastifyReply, FastifyRequest } from 'fastify';
import { Redis } from 'ioredis';

export const PUBLIC_JOB_REQUEST_RATE_LIMIT = {
  maxRequests: 5,
  windowSeconds: 10 * 60,
} as const;

const REDIS_KEY_PREFIX = 'marinex360:rate-limit:job-requests-public';
const REDIS_RATE_LIMIT_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
end
local ttl = redis.call('TTL', KEYS[1])
return { count, ttl }
`;

interface RateLimitHit {
  count: number;
  ttlSeconds: number;
}

export function publicJobRequestRateLimitKey(ip: string): string {
  return `${REDIS_KEY_PREFIX}:${ip}`;
}

function redisUrl(): string {
  return process.env.REDIS_URL ?? 'redis://localhost:6379';
}

function parseHit(value: unknown): RateLimitHit {
  if (!Array.isArray(value)) throw new Error('Unexpected Redis rate limit response');

  const count = Number(value[0]);
  const ttl = Number(value[1]);
  if (!Number.isFinite(count)) throw new Error('Unexpected Redis rate limit count');

  return {
    count,
    ttlSeconds: Number.isFinite(ttl) && ttl > 0 ? Math.ceil(ttl) : PUBLIC_JOB_REQUEST_RATE_LIMIT.windowSeconds,
  };
}

export function createPublicJobRequestRateLimiter(): {
  preHandler: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  close: () => Promise<void>;
} {
  let redis: InstanceType<typeof Redis> | null = null;

  function client(): InstanceType<typeof Redis> {
    if (redis) return redis;

    redis = new Redis(redisUrl(), {
      maxRetriesPerRequest: 1,
    });
    redis.on('error', () => undefined);
    return redis;
  }

  async function hit(ip: string): Promise<RateLimitHit> {
    return parseHit(await client().eval(
      REDIS_RATE_LIMIT_SCRIPT,
      1,
      publicJobRequestRateLimitKey(ip),
      String(PUBLIC_JOB_REQUEST_RATE_LIMIT.windowSeconds),
    ));
  }

  return {
    async preHandler(req, reply): Promise<void> {
      const result = await hit(req.ip);
      const remaining = Math.max(0, PUBLIC_JOB_REQUEST_RATE_LIMIT.maxRequests - result.count);
      reply
        .header('X-RateLimit-Limit', String(PUBLIC_JOB_REQUEST_RATE_LIMIT.maxRequests))
        .header('X-RateLimit-Remaining', String(remaining))
        .header('X-RateLimit-Reset', String(Math.ceil(Date.now() / 1000) + result.ttlSeconds));

      if (result.count <= PUBLIC_JOB_REQUEST_RATE_LIMIT.maxRequests) return;

      reply
        .code(429)
        .header('Retry-After', String(result.ttlSeconds))
        .send({
          statusCode: 429,
          error: 'Too Many Requests',
          message: 'Rate limit exceeded',
        });
    },
    async close(): Promise<void> {
      const openClient = redis;
      redis = null;
      if (!openClient) return;
      await openClient.quit().catch(() => {
        openClient.disconnect();
      });
    },
  };
}
