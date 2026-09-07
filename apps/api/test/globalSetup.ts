import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { forceTestDatabaseEnv, testDatabaseUrls } from './testDatabase.js';

function run(command: string, args: string[], env: NodeJS.ProcessEnv, input?: string, inherit = true): void {
  execFileSync(command, args, {
    cwd: new URL('../../..', import.meta.url),
    env,
    input,
    stdio: input ? ['pipe', inherit ? 'inherit' : 'pipe', inherit ? 'inherit' : 'pipe'] : (inherit ? 'inherit' : 'pipe'),
  });
}

function databaseName(url: string): string {
  return new URL(url).pathname.replace(/^\//, '');
}

function runPsql(url: string, args: string[], env: NodeJS.ProcessEnv, input?: string): void {
  try {
    run('psql', [url, ...args], env, input, false);
    return;
  } catch {
    // Local devcontainers often have the pg_wrapper shim but not the client package.
    // Fall back to the Postgres service's bundled psql when the Docker stack is present.
  }

  run('docker', [
    'compose',
    'exec',
    '-T',
    'postgres',
    'psql',
    '--username',
    'marinex',
    '--dbname',
    databaseName(url),
    ...args,
  ], env, input);
}

export default function setup(): void {
  if (!process.env.RUN_DB_TESTS) return;

  forceTestDatabaseEnv();
  const { databaseUrl, directDatabaseUrl, maintenanceUrl } = testDatabaseUrls();
  const env = {
    ...process.env,
    DATABASE_URL: directDatabaseUrl,
    DIRECT_DATABASE_URL: directDatabaseUrl,
  };
  const appPassword = new URL(databaseUrl).password || 'localdev_app';
  const appPasswordVar = `app_password='${appPassword.replace(/'/g, "''")}'`;
  const provisionSql = readFileSync(new URL('../../../infra/postgres/provision-app-role.sql', import.meta.url), 'utf8');

  runPsql(maintenanceUrl, ['-v', 'ON_ERROR_STOP=1'], env, `
SELECT 'CREATE DATABASE marinex360_test'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'marinex360_test')\\gexec
`);

  runPsql(directDatabaseUrl, ['-v', 'ON_ERROR_STOP=1', '-v', appPasswordVar], env, provisionSql);
  run('npx', ['prisma', 'migrate', 'deploy', '--schema', 'prisma/schema.prisma'], env);
  runPsql(directDatabaseUrl, ['-v', 'ON_ERROR_STOP=1', '-v', appPasswordVar], env, provisionSql);
  run('npx', ['prisma', 'db', 'seed', '--schema', 'prisma/schema.prisma'], env);

  process.env.DATABASE_URL = databaseUrl;
  process.env.DIRECT_DATABASE_URL = directDatabaseUrl;
}
