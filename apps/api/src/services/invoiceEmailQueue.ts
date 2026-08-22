// D-045/P3-7: enqueue invoice email delivery after issue commits. Delivery is async/fail-open.
import { Queue } from 'bullmq';

const redisUrl = new URL(process.env.REDIS_URL ?? 'redis://localhost:6379');
const connection = { host: redisUrl.hostname, port: Number(redisUrl.port || 6379) };
let queue: Queue | undefined;

export async function enqueueInvoiceEmailDelivery(invoiceId: string): Promise<void> {
  queue ??= new Queue('invoice-email-delivery', { connection });
  await queue.add('send', { invoiceId });
}
