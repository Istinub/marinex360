// Optimistic concurrency (OD-05 / B2). No pessimistic locks. A stale version -> 409 VERSION_CONFLICT.
// Implemented as a conditional update: `updateMany where {id, version:expected}`; 0 rows affected means
// either the row moved on (conflict) or it's gone/out-of-scope. The caller has ALREADY passed
// assertBranchAccess (scope before version, CC-05), so a 0-count here is a genuine version conflict.
import { AppError } from '../lib/errors.js';
import type { Prisma } from '@prisma/client';

type Delegate = { updateMany: (args: any) => Promise<{ count: number }> };

export async function optimisticUpdate(
  delegate: Delegate,
  id: string,
  expectedVersion: number,
  data: Record<string, unknown>,
): Promise<void> {
  const res = await delegate.updateMany({
    where: { id, version: expectedVersion },
    data: { ...data, version: { increment: 1 } },
  });
  if (res.count === 0) throw new AppError('VERSION_CONFLICT');
}

export type Tx = Prisma.TransactionClient;
