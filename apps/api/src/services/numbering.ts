// Branch-prefixed sequential numbers (CONV-ID-2). Unique, never reused after soft-delete.
// [PROPOSED FORMAT — needs PM/TL ratification] `{BRANCH}-{YYYY}-{NNNN}` e.g. SG-2026-0007.
// Concurrency: a transaction-scoped Postgres advisory lock keyed on (branch,year) serialises
// allocation, so no two txns pick the same NNNN. Gapless within committed rows; a rolled-back
// txn may leave a gap — accepted per the S0 BE review unless "strictly gapless" is mandated.
import type { Prisma } from '@prisma/client';

async function nextSeq(tx: Prisma.TransactionClient, table: 'JobOrder' | 'Invoice', numberField: string, branch: string, year: number): Promise<number> {
  // advisory lock: hashtext(branch||year||table) -> bigint key
  await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(hashtext($1))`, `${table}:${branch}:${year}`);
  const prefix = `${branch}-${year}-`;
  const rows = await tx.$queryRawUnsafe<{ max: string | null }[]>(
    `SELECT MAX(CAST(split_part("${numberField}", '-', 3) AS INTEGER)) AS max
       FROM "${table}" WHERE "${numberField}" LIKE $1`,
    `${prefix}%`,
  );
  return (rows[0]?.max ? Number(rows[0].max) : 0) + 1;
}

export async function nextJoNumber(tx: Prisma.TransactionClient, branch: string, now = new Date()): Promise<string> {
  const y = now.getUTCFullYear();
  const n = await nextSeq(tx, 'JobOrder', 'joNumber', branch, y);
  return `${branch}-${y}-${String(n).padStart(4, '0')}`;
}

export async function nextInvoiceNumber(tx: Prisma.TransactionClient, branch: string, now = new Date()): Promise<string> {
  const y = now.getUTCFullYear();
  await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(hashtext($1))`, `Invoice:${branch}:${y}`);
  const prefix = `INV-${branch}-${y}-`;
  const rows = await tx.$queryRawUnsafe<{ max: string | null }[]>(
    `SELECT MAX(CAST(split_part("invoiceNumber", '-', 4) AS INTEGER)) AS max
       FROM "Invoice" WHERE "invoiceNumber" LIKE $1`,
    `${prefix}%`,
  );
  const n = (rows[0]?.max ? Number(rows[0].max) : 0) + 1;
  return `INV-${branch}-${y}-${String(n).padStart(4, '0')}`;
}
