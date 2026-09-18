import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { AppError } from '../lib/errors.js';
import { appendAudit } from '../services/audit.js';
import { assertFeatureEnabled } from '../services/featureFlags.js';
import { validateReadOnlySelect, wrapWithLimit } from '../domain/devQuery.js';

function createReadonlyPool(): Pool {
  if (!process.env.DATABASE_URL_READONLY) {
    throw new AppError('FORBIDDEN', 'read-only database connection is not configured');
  }
  return new Pool({ connectionString: process.env.DATABASE_URL_READONLY, statement_timeout: 5000 });
}

function quoteIdent(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

export function adminDevToolsRoutes(app: FastifyInstance, prisma: PrismaClient): void {
  const w = { preHandler: [app.authenticate, app.requireMfaEnrolled, app.requireAction('admin:devTools')] };
  let pool: Pool | null = null;
  const readonlyPool = () => {
    pool ??= createReadonlyPool();
    return pool;
  };

  app.addHook('onClose', async () => {
    await pool?.end();
  });

  app.get('/api/v1/admin/dev/tables', w, async (req) => {
    await assertFeatureEnabled(prisma, 'DEV_TOOLS');
    const { rows } = await readonlyPool().query(`
      SELECT c.relname AS table_name, c.reltuples::bigint AS approx_row_count
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r'
      ORDER BY c.relname;
    `);
    await appendAudit(prisma as any, req.ctx, { entityType: 'DevTools', entityId: 'tables', action: 'LIST', diff: {} });
    return rows;
  });

  app.get('/api/v1/admin/dev/tables/:table', w, async (req) => {
    await assertFeatureEnabled(prisma, 'DEV_TOOLS');
    const { table } = req.params as { table: string };
    const { page = '1', pageSize = '50' } = (req.query as { page?: string; pageSize?: string }) ?? {};
    const allowlist = await readonlyPool().query(`
      SELECT relname
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname = $1;
    `, [table]);
    if (allowlist.rowCount === 0) throw new AppError('NOT_FOUND', `no such table: ${table}`);

    const limit = Math.min(Number(pageSize) || 50, 200);
    const offset = (Math.max(Number(page) || 1, 1) - 1) * limit;
    const { rows } = await readonlyPool().query(`SELECT * FROM ${quoteIdent(table)} LIMIT $1 OFFSET $2`, [limit, offset]);
    await appendAudit(prisma as any, req.ctx, { entityType: 'DevTools', entityId: table, action: 'BROWSE', diff: { page, pageSize } });
    return rows;
  });

  app.post('/api/v1/admin/dev/query', w, async (req) => {
    await assertFeatureEnabled(prisma, 'DEV_TOOLS');
    const { sql } = (req.body ?? {}) as { sql?: unknown };
    if (typeof sql !== 'string') throw new AppError('VALIDATION_ERROR', 'sql (string) required');

    const validated = validateReadOnlySelect(sql);
    const wrapped = wrapWithLimit(validated);
    const start = Date.now();
    try {
      const result = await readonlyPool().query(wrapped);
      await appendAudit(prisma as any, req.ctx, {
        entityType: 'DevTools',
        entityId: 'query',
        action: 'EXECUTE',
        diff: { sql: validated, rowCount: result.rowCount, ms: Date.now() - start },
      });
      return { rows: result.rows, rowCount: result.rowCount };
    } catch (error) {
      await appendAudit(prisma as any, req.ctx, {
        entityType: 'DevTools',
        entityId: 'query',
        action: 'EXECUTE_FAILED',
        diff: { sql: validated, error: error instanceof Error ? error.message : String(error) },
      });
      throw new AppError('VALIDATION_ERROR', error instanceof Error ? error.message : 'query failed');
    }
  });
}
