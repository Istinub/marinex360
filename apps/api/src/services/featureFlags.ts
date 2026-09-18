import type { PrismaClient } from '@prisma/client';
import { AppError } from '../lib/errors.js';

export async function assertFeatureEnabled(prisma: PrismaClient, key: string): Promise<void> {
  const flag = await prisma.featureFlag.findUnique({ where: { key } });
  if (!flag?.enabled) throw new AppError('FORBIDDEN', `feature '${key}' is not enabled`);
}
