import { describe, expect, it } from 'vitest';
import { validateReadOnlySelect, wrapWithLimit } from '../src/domain/devQuery.js';

describe('validateReadOnlySelect', () => {
  it('allows a plain SELECT', () => {
    expect(validateReadOnlySelect('SELECT * FROM "User"')).toBe('SELECT * FROM "User"');
  });

  it('strips exactly one trailing semicolon', () => {
    expect(validateReadOnlySelect('SELECT 1;')).toBe('SELECT 1');
  });

  it.each([
    'INSERT INTO "User" VALUES (1)',
    'DROP TABLE "User"',
    'UPDATE "User" SET x=1',
    'SELECT 1; DROP TABLE "User"',
  ])('rejects %s', (sql) => {
    expect(() => validateReadOnlySelect(sql)).toThrow();
  });

  it('rejects comments (bypass vector for the semicolon check)', () => {
    expect(() => validateReadOnlySelect('SELECT 1 --; DROP TABLE "User"')).toThrow();
  });

  it('rejects empty input', () => {
    expect(() => validateReadOnlySelect('   ')).toThrow();
  });
});

describe('wrapWithLimit', () => {
  it('wraps with a subquery and LIMIT', () => {
    expect(wrapWithLimit('SELECT * FROM "User"', 10)).toBe('SELECT * FROM (SELECT * FROM "User") AS _dev_query_wrapper LIMIT 10');
  });
});
