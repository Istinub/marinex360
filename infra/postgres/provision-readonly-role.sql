-- MarineX360 — provision the read-only role `marinex_readonly`.
-- Read-only role for the admin dev-tools table browser + SQL console. GRANTs are the REAL
-- enforcement boundary; app-level SELECT validation is defense-in-depth on top of this.
--
-- Idempotent: safe to run on a fresh OR an already-migrated database.
-- Must be run by an owner/superuser (locally: `marinex`).
-- The password is passed as a quoted psql variable, e.g.:
--   psql "$DIRECT_DATABASE_URL" -v readonly_password="'localdev_readonly'" -f provision-readonly-role.sql

\set ON_ERROR_STOP on

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'marinex_readonly') THEN
    CREATE ROLE marinex_readonly LOGIN
      NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOINHERIT;
  END IF;
END $$;

ALTER ROLE marinex_readonly WITH PASSWORD :readonly_password;

SELECT format('GRANT CONNECT ON DATABASE %I TO marinex_readonly', current_database())\gexec
GRANT USAGE ON SCHEMA public TO marinex_readonly;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO marinex_readonly;

ALTER DEFAULT PRIVILEGES FOR ROLE marinex IN SCHEMA public
  GRANT SELECT ON TABLES TO marinex_readonly;

-- No INSERT/UPDATE/DELETE/TRUNCATE/CREATE/DROP grants — omission IS the restriction.
