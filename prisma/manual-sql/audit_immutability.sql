-- ============================================================================
-- MarineX360 · S0-7 follow-up migration · DB-LEVEL AUDIT IMMUTABILITY
-- Satisfies: QA Part-F AUDIT-3, INTERFACE_CONTRACT v1.1 ADR-7 ("audit/status-history
-- immutable at DB level, not app-only"). NON-NEGOTIABLE per the S0-7 work order.
--
-- HOW TO ADD THIS AS A PRISMA MIGRATION (do NOT hand-place the folder):
--   1) after `prisma migrate dev --name init` succeeds,
--   2) run:  npx prisma migrate dev --create-only --name audit_immutability
--   3) paste the body below into the generated migration.sql, then
--   4) run:  npx prisma migrate dev      (applies it; Prisma manages the checksum)
--
-- WHY A SEPARATE ROLE (coordination item -> DevOps): a table owner and superusers
-- BYPASS table privileges, so REVOKE only bites when the app connects as a NON-OWNER,
-- NON-SUPERUSER role. Today docker-compose/ci connect as `marinex` (the owner/superuser),
-- so this REVOKE is cosmetic until the APP RUNTIME connects as `marinex_app`.
-- Migrations must keep running as the owner `marinex`.
-- ============================================================================

-- Idempotent role creation. NOLOGIN here: DevOps attaches LOGIN + password out-of-band
-- (compose init SQL / injected secret) so no credential literal lands in a committed file.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'marinex_app') THEN
    CREATE ROLE marinex_app NOLOGIN;
  END IF;
END$$;

GRANT USAGE ON SCHEMA public TO marinex_app;

-- App role gets full DML on all CURRENT tables (soft-delete needs UPDATE on operational rows)...
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES    IN SCHEMA public TO marinex_app;
GRANT USAGE, SELECT               ON ALL SEQUENCES IN SCHEMA public TO marinex_app;

-- ...and on tables created by FUTURE migrations (which run as owner `marinex`).
ALTER DEFAULT PRIVILEGES FOR ROLE marinex IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO marinex_app;
ALTER DEFAULT PRIVILEGES FOR ROLE marinex IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO marinex_app;

-- The guarantee: strip UPDATE/DELETE on the append-only ledgers. INSERT + SELECT remain,
-- so the service layer can still append audit rows and status-history rows, but nothing the
-- app connects as can mutate or erase them. (Also blocks a future ALTER DEFAULT re-grant from
-- silently re-adding them, since this REVOKE is explicit on the concrete tables.)
REVOKE UPDATE, DELETE ON "AuditEntry"       FROM marinex_app;
REVOKE UPDATE, DELETE ON "JobStatusHistory" FROM marinex_app;

-- Acceptance (AUDIT-3): connected as marinex_app,
--   INSERT INTO "AuditEntry" ...            -> OK
--   UPDATE "AuditEntry" SET ...             -> ERROR: permission denied
--   DELETE FROM "JobStatusHistory" ...      -> ERROR: permission denied
