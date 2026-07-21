# S0-6 Offline-Sync Engine — Spike & Prototype

De-risks the highest-risk part of MarineX360 (OD-04) before the Phase 2 commit. Built to
INTERFACE_CONTRACT v1.0, `schema.prisma`, and SYSTEM_DESIGN_MODELS §6 (the sync sequence
diagram is the build reference).

## Contents
- `device-sqlite-schema.sql` — on-device SQLite schema + the local op-queue + binary-upload queue.
- `SYNC_ENGINE_DESIGN.md` — the written engine design (idempotency, delta cursors, schema-version
  rejection, retry/backoff, the SYNC-13 flagged-review path, OD-06 feasibility finding).
- `OPEN_RISKS.md` — risk register.
- `prototype/` — a runnable end-to-end demo:
  - `device.js` — real on-device SQLite (node:sqlite) loaded from the DDL above + the sync engine.
  - `mockServer.js` — stands in for Fastify + SyncService + Postgres; implements `/sync/batch`
    and `/sync/assigned` exactly per contract (ProcessedOp registry, version-check, schema gate).
  - `runScenarios.js` — drives the engine and asserts the §4.2 disposition table.

## Run
```
cd prototype && node runScenarios.js      # Node ≥ 22 (uses built-in node:sqlite)
```

## What it proves (8 scenarios, 26 assertions, all green)
1. **APPLIED** — offline write → reconnect → applied, row on server.
2. **IDEMPOTENT_REPLAY** — same `opId` resent → no duplicate, shown as Synced.
3. **VERSION_CONFLICT** — office edits the row mid-offline → conflict → reload+reapply (OD-05) →
   applied, technician's edit preserved.
4. **VALIDATION_ERROR** — malformed op surfaced, **not** auto-retried (no loop).
5. **BATCH_REJECTED_SCHEMA** — stale app schema → whole batch rejected, queue preserved, upgrade
   gate raised, **no auto-migrate**.
6. **401 mid-offline** — queue preserved, re-auth, retry the **same** opIds → applied.
7. **SYNC-13** — technician unassigned while offline → ops **accepted + flagged** for supervisor
   review, **never discarded** (needs `APPLIED_FLAGGED`, CC-MOB-2).
8. **Network failure → recovery** — backoff, idempotent retry, exactly one row.

## Production mapping
Same engine logic runs over `@capacitor-community/sqlite` with the identical DDL; the in-process
`mockServer` is replaced by the real `/sync/*` endpoints. Binary (photo/signature) upload is a
two-phase channel (presigned S3 PUT → then metadata op) — endpoint owed by BE.
