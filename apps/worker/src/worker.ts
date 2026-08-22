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
import { Queue, Worker } from "bullmq";
import { generateInvoicePdf } from "./jobs/generateInvoicePdf.js";
import { sendInvoiceEmail } from "./jobs/sendInvoiceEmail.js";
import { reconcileOverdueInvoices } from "./jobs/overdueReconciliation.js";
import { reconcileCertificateExpiryAlerts } from "./jobs/certificateExpiryAlert.js";

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

// D-034: recurring OVERDUE reconciliation, every 15 minutes. The Queue schedules the repeatable
// job at startup; this Worker is the processor that persists overdue status and emits alerts.
const overdueQueue = new Queue("invoice-overdue-reconciliation", { connection });
await overdueQueue.add(
  "reconcile",
  {},
  {
    repeat: { every: 15 * 60 * 1000 },
    jobId: "overdue-reconciliation-recurring",
  },
);

const overdueWorker = new Worker(
  "invoice-overdue-reconciliation",
  async () => {
    const result = await reconcileOverdueInvoices();
    console.log(`[worker] overdue reconciliation: ${result.reconciled} invoice(s) marked OVERDUE`);
    return result;
  },
  { connection },
);

overdueWorker.on("failed", (_job, err) => console.error("[worker] overdue reconciliation job failed", err));

const invoicePdfQueueName = "invoice-pdf-generation";
const invoicePdfWorker = new Worker(
  invoicePdfQueueName,
  async (job) => {
    const { invoiceId } = job.data as { invoiceId: string };
    return generateInvoicePdf(invoiceId);
  },
  { connection },
);
invoicePdfWorker.on("failed", (_job, err) => console.error("[worker] invoice PDF generation failed", err));

const invoiceEmailWorker = new Worker(
  "invoice-email-delivery",
  async (job) => {
    const { invoiceId } = job.data as { invoiceId: string };
    return sendInvoiceEmail(invoiceId);
  },
  { connection },
);
invoiceEmailWorker.on("failed", (_job, err) => console.error("[worker] invoice email delivery failed", err));

// FR-48/FR-60: recurring certificate-expiry alert, daily. Certificate expiry is a day-scale
// operational alert, unlike invoice overdue reconciliation's 15-minute cadence.
const certificateExpiryQueue = new Queue("certificate-expiry-alert", { connection });
await certificateExpiryQueue.add(
  "reconcile",
  {},
  {
    repeat: { every: 24 * 60 * 60 * 1000 },
    jobId: "certificate-expiry-alert-recurring",
  },
);

const certificateExpiryWorker = new Worker(
  "certificate-expiry-alert",
  async () => {
    const result = await reconcileCertificateExpiryAlerts();
    console.log(`[worker] certificate expiry alert: ${result.alerted} certificate(s) alerted`);
    return result;
  },
  { connection },
);
certificateExpiryWorker.on("failed", (_job, err) => console.error("[worker] certificate expiry alert job failed", err));
