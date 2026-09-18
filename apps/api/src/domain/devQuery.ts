import { AppError } from '../lib/errors.js';

// Admin dev-tools SQL console — SELECT-only. The readonly DB role is the REAL enforcement
// boundary; this validation is defense-in-depth on top of it.
const FORBIDDEN_KEYWORDS = /\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|GRANT|REVOKE|CREATE|EXECUTE|CALL|COPY|VACUUM|MERGE)\b/i;

export function validateReadOnlySelect(sqlRaw: string): string {
  const sql = sqlRaw.trim();
  if (!sql) throw new AppError('VALIDATION_ERROR', 'query is empty');

  const stripped = sql.endsWith(';') ? sql.slice(0, -1) : sql;
  if (stripped.includes(';')) throw new AppError('VALIDATION_ERROR', 'only a single statement is allowed');
  if (stripped.includes('--') || stripped.includes('/*')) {
    throw new AppError('VALIDATION_ERROR', 'comments are not allowed in dev-tools queries');
  }
  if (!/^\s*SELECT\s/i.test(stripped)) throw new AppError('VALIDATION_ERROR', 'only SELECT statements are allowed');
  if (FORBIDDEN_KEYWORDS.test(stripped)) throw new AppError('VALIDATION_ERROR', 'query contains a disallowed keyword');

  return stripped;
}

export function wrapWithLimit(sql: string, maxRows = 500): string {
  return `SELECT * FROM (${sql}) AS _dev_query_wrapper LIMIT ${maxRows}`;
}
