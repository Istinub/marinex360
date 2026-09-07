import {
  CapacitorSQLite,
  SQLiteConnection,
  type SQLiteDBConnection,
} from '@capacitor-community/sqlite';
import type { MobileSqlAdapter } from '../composables/useOfflineExecution';
import deviceSchema from '../../Mobile_app_device-sqlite-schema.sql?raw';

const DATABASE_NAME = 'marinex360-mobile';
const DATABASE_VERSION = 3;

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

async function migrateLocalSchema(connection: SQLiteDBConnection): Promise<void> {
  const result = await connection.query('PRAGMA table_info(jo_cache)');
  const columns = new Set((result.values ?? [])
    .map((row) => row.name)
    .filter((name): name is string => typeof name === 'string'));

  if (!columns.has('deadline')) {
    await connection.execute('ALTER TABLE jo_cache ADD COLUMN deadline TEXT', false);
  }
  if (!columns.has('client_id')) {
    await connection.execute('ALTER TABLE jo_cache ADD COLUMN client_id TEXT', false);
  }
  if (!columns.has('vessel_id')) {
    await connection.execute('ALTER TABLE jo_cache ADD COLUMN vessel_id TEXT', false);
  }
  if (!columns.has('vendor_id')) {
    await connection.execute('ALTER TABLE jo_cache ADD COLUMN vendor_id TEXT', false);
  }
  if (!columns.has('is_subcontracted')) {
    await connection.execute('ALTER TABLE jo_cache ADD COLUMN is_subcontracted INTEGER NOT NULL DEFAULT 0', false);
  }
  if (!columns.has('quoted_currency')) {
    await connection.execute('ALTER TABLE jo_cache ADD COLUMN quoted_currency TEXT', false);
  }
  await connection.execute(
    `CREATE TABLE IF NOT EXISTS job_order_checklist_item_cache (
      id            TEXT PRIMARY KEY,
      job_order_id  TEXT NOT NULL,
      label         TEXT NOT NULL,
      sort_order    INTEGER NOT NULL DEFAULT 0,
      checked       INTEGER NOT NULL DEFAULT 0,
      created_at    TEXT,
      updated_at    TEXT,
      pulled_at     TEXT NOT NULL
    )`,
    false,
  );
  await connection.execute('CREATE INDEX IF NOT EXISTS idx_job_order_checklist_item_cache_job ON job_order_checklist_item_cache (job_order_id, sort_order)', false);
  await connection.execute(`PRAGMA user_version = ${DATABASE_VERSION}`, false);
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
  await migrateLocalSchema(connection);
  await sqlite.saveToStore(DATABASE_NAME);

  const runtime = mobileRuntime();
  runtime.marinex360 ??= {};
  runtime.marinex360.db = createMobileSqlAdapter(connection, sqlite);
}
