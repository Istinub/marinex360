/**
 * PLACEHOLDER worker entrypoint owned by DevOps to prove the Redis/BullMQ wiring and the
 * Chromium-in-image setup. BE owns the real processors (async PDF via Puppeteer,
 * notifications, sync processing). The PDF render path is verified by
 * `scripts/render-smoke.mjs` (acceptance #4).
 *
 * NOTE: we hand BullMQ a plain connection-options object (parsed from REDIS_URL) instead
 * of constructing our own ioredis client. BullMQ then builds its connection from its own
 * bundled ioredis, which avoids a dual-package type clash between the top-level `ioredis`
 * and the copy nested under `bullmq`.
 */
import { Worker } from "bullmq";

const redisUrl = new URL(process.env.REDIS_URL ?? "redis://localhost:6379");
const connection = {
  host: redisUrl.hostname,
  port: Number(redisUrl.port || 6379),
};

// Stub processor — replaced by BE with real PDF/notification/sync handlers.
const worker = new Worker(
  "pdf",
  async (job) => {
    console.log(`[worker] received job ${job.id} (${job.name}) — stub`);
    return { ok: true };
  },
  { connection },
);

worker.on("ready", () => console.log("[worker] connected to Redis; awaiting jobs"));
worker.on("failed", (job, err) => console.error(`[worker] job ${job?.id} failed`, err));