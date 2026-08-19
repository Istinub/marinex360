// D-037: enqueues the PDF job AFTER the issue transaction commits — never render synchronously
// in the HTTP request/response cycle.
import { Queue } from 'bullmq';

const redisUrl = new URL(process.env.REDIS_URL ?? 'redis://localhost:6379');
const connection = { host: redisUrl.hostname, port: Number(redisUrl.port || 6379) };
let queue: Queue | undefined;

export async function enqueueInvoicePdfGeneration(invoiceId: string): Promise<void> {
  queue ??= new Queue('invoice-pdf-generation', { connection });
  await queue.add('generate', { invoiceId });
}
