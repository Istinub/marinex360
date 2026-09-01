import {
  CapacitorSQLite,
  SQLiteConnection,
  type SQLiteDBConnection,
} from '@capacitor-community/sqlite';
import type { MobileSqlAdapter } from '../composables/useOfflineExecution';
import deviceSchema from '../../Mobile_app_device-sqlite-schema.sql?raw';

const DATABASE_NAME = 'marinex360-mobile';
const DATABASE_VERSION = 1;

interface MobileRuntime {
  marinex360?: {
    db?: MobileSqlAdapter;
  };
}

function mobileRuntime(): typeof globalThis & MobileRuntime {
  return globalThis as typeof globalThis & MobileRuntime;
}

function createMobileSqlAdapter(
  connection: SQLiteDBConnection,
  sqlite: SQLiteConnection,
): MobileSqlAdapter {
  let transactionActive = false;

  async function persistWhenIdle(): Promise<void> {
    if (!transactionActive) await sqlite.saveToStore(DATABASE_NAME);
  }

  return {
    async select<T>(sql: string, params: unknown[] = []): Promise<T[]> {
      const result = await connection.query(sql, params);
      return (result.values ?? []) as T[];
    },

    async execute(sql: string, params: unknown[] = []): Promise<void> {
      if (params.length > 0) {
        await connection.run(sql, params, false);
      } else {
        await connection.execute(sql, false);
      }
      await persistWhenIdle();
    },

    async transaction<T>(work: () => Promise<T>): Promise<T> {
      if (transactionActive) return work();

      await connection.beginTransaction();
      transactionActive = true;
      try {
        const result = await work();
        await connection.commitTransaction();
        transactionActive = false;
        await sqlite.saveToStore(DATABASE_NAME);
        return result;
      } catch (error) {
        await connection.rollbackTransaction();
        transactionActive = false;
        throw error;
      }
    },
  };
}

export async function initializeWebDatabase(): Promise<void> {
  const sqlite = new SQLiteConnection(CapacitorSQLite);

  await sqlite.initWebStore();

  const connection = await sqlite.createConnection(
    DATABASE_NAME,
    false,
    'no-encryption',
    DATABASE_VERSION,
    false,
  );
  await connection.open();
  await connection.execute(deviceSchema, false);
  await sqlite.saveToStore(DATABASE_NAME);

  const runtime = mobileRuntime();
  runtime.marinex360 ??= {};
  runtime.marinex360.db = createMobileSqlAdapter(connection, sqlite);
}
