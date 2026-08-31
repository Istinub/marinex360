-- MarineX360 — provision the non-owner application role `marinex_app`.
-- OPS/DevOps owned (S0-7). This is the mechanism that makes DB-level audit immutability
-- REAL: the app runtime connects as a role that does NOT own the tables, so the
-- REVOKE UPDATE/DELETE in Backend's audit-immutability migration is actually enforced
-- (table OWNERS bypass GRANT/REVOKE in Postgres).
--
-- Idempotent: safe to run on a fresh OR an already-migrated database.
-- Must be run by an owner/superuser (locally: `marinex`).
-- The password is passed as a quoted psql variable, e.g.:
--   psql "$DIRECT_DATABASE_URL" -v app_password="'localdev_app'" -f provision-app-role.sql

\set ON_ERROR_STOP on

-- 1. Role: create if missing, then (re)assert password + least-privilege attributes.
--    LOGIN, but never SUPERUSER / CREATEDB / CREATEROLE / BYPASSRLS.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'marinex_app') THEN
    CREATE ROLE marinex_app LOGIN
      NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOINHERIT;
  END IF;
END $$;

ALTER ROLE marinex_app WITH PASSWORD :app_password;

-- 2. Connect + read the schema. CRITICAL: revoke CREATE on the schema so the app can
--    never create (and therefore own) a table — an owner would bypass immutability.
GRANT CONNECT ON DATABASE marinex360 TO marinex_app;
GRANT USAGE ON SCHEMA public TO marinex_app;
REVOKE CREATE ON SCHEMA public FROM marinex_app;

-- 3. Baseline DML on EXISTING objects. Backend's audit-immutability migration then
--    REVOKEs UPDATE, DELETE on the append-only / immutable tables FROM marinex_app.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO marinex_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO marinex_app;

-- 4. Same baseline for FUTURE objects created by the migration owner (marinex), so new
--    tables from later migrations are usable without re-running this script.
ALTER DEFAULT PRIVILEGES FOR ROLE marinex IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO marinex_app;
ALTER DEFAULT PRIVILEGES FOR ROLE marinex IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO marinex_app;

-- Defensive backstop (2026-08-30): the blanket GRANT above would silently re-grant
-- UPDATE/DELETE on immutable tables if this file is ever re-run against an existing
-- database (e.g. the documented "keep-data, no reset" re-provisioning path). These
-- are NOT a substitute for the versioned migrations that own this decision
-- (audit_immutability and payment_immutability migrations) — they guarantee
-- re-running this file can never undo those migrations' intent. Guarded with
-- to_regclass() so this is also safe on a FRESH volume, before Prisma has created
-- any tables yet.
DO $$
BEGIN
  IF to_regclass('public."AuditEntry"') IS NOT NULL THEN
    EXECUTE 'REVOKE UPDATE, DELETE ON "AuditEntry" FROM marinex_app';
  END IF;
  IF to_regclass('public."JobStatusHistory"') IS NOT NULL THEN
    EXECUTE 'REVOKE UPDATE, DELETE ON "JobStatusHistory" FROM marinex_app';
  END IF;
  IF to_regclass('public."Payment"') IS NOT NULL THEN
    EXECUTE 'REVOKE UPDATE, DELETE ON "Payment" FROM marinex_app';
  END IF;
END $$;
