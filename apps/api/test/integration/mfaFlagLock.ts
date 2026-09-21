import type { PrismaClient } from '@prisma/client';
import { Client } from 'pg';

const MFA_FLAG_TEST_LOCK = 735001;

export async function withMfaFlagLock<T>(prisma: PrismaClient, work: () => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  await client.query('BEGIN');
  let committed = false;

  try {
    await client.query('SELECT pg_advisory_xact_lock($1)', [MFA_FLAG_TEST_LOCK]);
    await prisma.featureFlag.upsert({
      where: { key: 'MFA_REQUIRED' },
      update: { enabled: false, description: 'Require MFA/TOTP at login for System Admin and Finance accounts', category: 'security' },
      create: { key: 'MFA_REQUIRED', enabled: false, description: 'Require MFA/TOTP at login for System Admin and Finance accounts', category: 'security' },
    });

    const result = await work();
    await prisma.featureFlag.updateMany({ where: { key: 'MFA_REQUIRED' }, data: { enabled: false } });
    await client.query('COMMIT');
    committed = true;
    return result;
  } finally {
    if (!committed) {
      await prisma.featureFlag.updateMany({ where: { key: 'MFA_REQUIRED' }, data: { enabled: false } }).catch(() => undefined);
      await client.query('ROLLBACK').catch(() => undefined);
    }
    await client.end();
  }
}
