// Async completion-report generation mirrors invoice PDF generation: the API enqueues after
// the JO completion transaction commits; the worker owns Puppeteer and storage writes.
import { Queue } from 'bullmq';

const redisUrl = new URL(process.env.REDIS_URL ?? 'redis://localhost:6379');
const connection = { host: redisUrl.hostname, port: Number(redisUrl.port || 6379) };
let queue: Queue | undefined;

export async function enqueueJobOrderReportGeneration(jobOrderId: string): Promise<void> {
  queue ??= new Queue('job-order-report-generation', { connection });
  await queue.add('generate', { jobOrderId });
}
