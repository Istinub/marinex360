import { Queue } from 'bullmq';

const redisUrl = new URL(process.env.REDIS_URL ?? 'redis://localhost:6379');
const connection = { host: redisUrl.hostname, port: Number(redisUrl.port || 6379) };
let queue: Queue | undefined;

export async function enqueueQuotationPdfGeneration(quotationId: string): Promise<void> {
  queue ??= new Queue('quotation-pdf-generation', { connection });
  await queue.add('generate', { quotationId });
}
