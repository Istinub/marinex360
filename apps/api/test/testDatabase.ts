import dotenv from 'dotenv';

dotenv.config({ path: new URL('../../../.env', import.meta.url) });

const TEST_DB_NAME = 'marinex360_test';

function withDatabaseName(url: string, databaseName: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${databaseName}`;
  return parsed.toString();
}

function databaseName(url: string): string {
  const parsed = new URL(url);
  return parsed.pathname.replace(/^\//, '');
}

export function testDatabaseUrls(): { databaseUrl: string; directDatabaseUrl: string; maintenanceUrl: string; readonlyDatabaseUrl: string } {
  const directBase = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;
  const appBase = process.env.DATABASE_URL;
  if (!directBase || !appBase) throw new Error('DATABASE_URL and DIRECT_DATABASE_URL are required for DB-backed tests.');

  const directDatabaseUrl = process.env.DIRECT_DATABASE_URL_TEST ?? withDatabaseName(directBase, TEST_DB_NAME);
  const databaseUrl = process.env.DATABASE_URL_TEST ?? withDatabaseName(appBase, TEST_DB_NAME);
  const readonlyDatabaseUrl = process.env.DATABASE_URL_READONLY_TEST
    ?? process.env.DATABASE_URL_READONLY
    ?? 'postgresql://marinex_readonly:localdev_readonly@localhost:5432/marinex360_test';
  const maintenanceUrl = withDatabaseName(directBase, 'postgres');

  const directDbName = databaseName(directDatabaseUrl);
  const appDbName = databaseName(databaseUrl);
  const readonlyDbName = databaseName(readonlyDatabaseUrl);
  if (directDbName !== TEST_DB_NAME || appDbName !== TEST_DB_NAME || readonlyDbName !== TEST_DB_NAME || !directDbName.endsWith('_test')) {
    throw new Error(`Refusing to run DB tests outside ${TEST_DB_NAME}. Got DATABASE_URL=${appDbName}, DIRECT_DATABASE_URL=${directDbName}, DATABASE_URL_READONLY=${readonlyDbName}.`);
  }

  return { databaseUrl, directDatabaseUrl, maintenanceUrl, readonlyDatabaseUrl };
}

export function forceTestDatabaseEnv(): void {
  if (!process.env.RUN_DB_TESTS) return;
  const { databaseUrl, directDatabaseUrl, readonlyDatabaseUrl } = testDatabaseUrls();
  process.env.DATABASE_URL = databaseUrl;
  process.env.DIRECT_DATABASE_URL = directDatabaseUrl;
  process.env.DATABASE_URL_READONLY = readonlyDatabaseUrl;
}
