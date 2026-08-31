-- Extends D-014 DB-level audit immutability to the Payment ledger, per D-035/CC-12
-- (TL, 2026-08-08): a payment ledger is exactly the kind of record D-014 exists to
-- protect. Corrections happen via a new reversing Payment row (negative amountMinor),
-- never by editing or deleting an existing row — same pattern as D-021.
--
-- marinex_app already has baseline SELECT/INSERT/UPDATE/DELETE on this table via
-- provision-app-role.sql's ALTER DEFAULT PRIVILEGES (applies automatically to every
-- new table). This migration is the table-specific carve-out, applied the same way
-- as the existing audit_immutability migration for AuditEntry and JobStatusHistory.

REVOKE UPDATE, DELETE ON "Payment" FROM marinex_app;
