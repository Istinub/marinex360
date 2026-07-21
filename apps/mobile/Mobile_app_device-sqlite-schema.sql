-- =====================================================================
-- MarineX360 — ON-DEVICE SQLite schema  (S0-6 spike, v0.1)
-- Owner: Mobile. Mirrors schema.prisma row shapes for the technician's
-- OWN assigned jobs only (OD-04). Runs under @capacitor-community/sqlite.
--
-- DESIGN RULES (must match server conventions):
--  - Money is ALWAYS two columns: <field>_amount_minor INT + <field>_currency TEXT.
--  - Every row that the server treats as mutable carries `version` (server's value).
--  - Every offline-authored row carries `op_id` (client UUID) + a client-generated
--    `id` (UUID). We send the id; the server persists it; resultRef == id. This
--    removes temp-id remapping. (CC-MOB-1 — pending TL/BE ratification.)
--  - `sync_state` is the device-side lifecycle for the UI <SyncStatusChip>:
--    SYNCED | PENDING | SYNCING | CONFLICT | ERROR | FLAGGED.
--  - The op_queue is the source of truth for what to PUSH. Entity tables are the
--    materialised current state the UI reads. They are kept consistent in one txn.
-- =====================================================================

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------------
-- 0. Sync control
-- ---------------------------------------------------------------------

-- Single-row delta cursor for GET /sync/assigned?since=<cursor>
CREATE TABLE IF NOT EXISTS sync_cursor (
  id            INTEGER PRIMARY KEY CHECK (id = 1),
  cursor        TEXT,                 -- opaque server cursor; NULL = full prefetch
  last_pull_at  TEXT
);
INSERT OR IGNORE INTO sync_cursor (id, cursor, last_pull_at) VALUES (1, NULL, NULL);

-- On-device payload schema version. Sent on every /sync/batch as schemaVersion.
-- If the server's minimum exceeds this, the batch is rejected (BATCH_REJECTED_SCHEMA),
-- the queue is preserved, and the app signals "update required". Never auto-migrate.
CREATE TABLE IF NOT EXISTS app_meta (
  k TEXT PRIMARY KEY,
  v TEXT
);
INSERT OR IGNORE INTO app_meta (k, v) VALUES ('schema_version', '1');

-- ---------------------------------------------------------------------
-- 1. The op-queue — ordered, append-only journal of writes to PUSH
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS op_queue (
  seq           INTEGER PRIMARY KEY AUTOINCREMENT, -- preserves authoring order
  op_id         TEXT NOT NULL UNIQUE,              -- client UUID — idempotency key (OD-04)
  entity        TEXT NOT NULL,                     -- WorkLog | Photo | Observation | ChecklistInstance | MaterialLine | ESignature
  action        TEXT NOT NULL,                     -- CREATE | UPDATE
  entity_id     TEXT NOT NULL,                     -- client-generated UUID row id (CC-MOB-1)
  job_order_id  TEXT NOT NULL,                     -- always attaches to a pre-fetched JO (OD-02/04)
  payload_json  TEXT NOT NULL,                     -- the op body sent to the server
  base_version  INTEGER,                           -- loaded version for UPDATE (OD-05); NULL for CREATE
  schema_version INTEGER NOT NULL,                 -- snapshot of app_meta.schema_version at enqueue
  client_time   TEXT NOT NULL,                     -- device clock at authoring (audit/order only)
  status        TEXT NOT NULL DEFAULT 'PENDING',   -- PENDING|SYNCING|SYNCED|CONFLICT|ERROR|FLAGGED
  attempts      INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT,                            -- backoff gate (ISO); NULL = ready now
  server_version INTEGER,                          -- returned on APPLIED
  result_ref    TEXT,                              -- server row id on APPLIED/REPLAY
  last_error    TEXT,
  blocks_on_op  TEXT,                              -- op_id this op depends on (e.g. Photo meta waits on binary upload)
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_op_queue_status ON op_queue (status, next_attempt_at);
CREATE INDEX IF NOT EXISTS idx_op_queue_job ON op_queue (job_order_id);

-- ---------------------------------------------------------------------
-- 2. Binary upload queue — photos / signature images (two-phase sync)
--    Binaries go to S3 via a presigned PUT (BE endpoint owed) BEFORE the
--    metadata op is pushed. The metadata op blocks_on this until s3_key is known.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS binary_upload (
  id            TEXT PRIMARY KEY,        -- == entity_id of the Photo/ESignature row
  entity        TEXT NOT NULL,           -- Photo | ESignature
  local_path    TEXT NOT NULL,           -- Capacitor Filesystem path on device
  byte_size     INTEGER,
  content_type  TEXT,
  s3_key        TEXT,                    -- set once uploaded
  upload_state  TEXT NOT NULL DEFAULT 'PENDING', -- PENDING|UPLOADING|DONE|ERROR
  attempts      INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT,
  last_error    TEXT
);

-- ---------------------------------------------------------------------
-- 3. PRE-FETCHED READ CACHE (owner's assigned jobs only — OD-04 guardrail)
--    Pulled by GET /sync/assigned. Server `version` retained for OD-05.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS jo_cache (
  id                TEXT PRIMARY KEY,
  jo_number         TEXT NOT NULL,
  branch            TEXT NOT NULL,
  client_name       TEXT,               -- denormalised display copy (read-only)
  vessel_name       TEXT,
  imo_number        TEXT,
  port              TEXT,
  scope_summary     TEXT,
  service_categories TEXT,              -- JSON array
  state             TEXT NOT NULL,      -- JobState; header locks at IN_PROGRESS
  execution_owner_id TEXT,              -- must equal this device's user (OD-05) — else not prefetched
  assigned_technician_ids TEXT,         -- JSON array (SYNC-13 detection: unassign = our id removed)
  planned_start_date TEXT,
  -- D-004: per-job labourRate (default SGD 90/hr at JO creation, overridable office-side).
  labour_rate_amount_minor INTEGER,
  labour_rate_currency     TEXT,
  version           INTEGER NOT NULL,
  header_locked     INTEGER NOT NULL DEFAULT 0,
  pulled_at         TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS checklist_template_cache (
  id                TEXT PRIMARY KEY,
  name              TEXT,
  service_category  TEXT,
  job_type          TEXT,
  items_json        TEXT NOT NULL,      -- ordered item definitions (offline)
  version           INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS document_cache (   -- metadata + locally cached file path
  id            TEXT PRIMARY KEY,
  owner_type    TEXT NOT NULL,          -- JOB | VESSEL
  owner_id      TEXT NOT NULL,
  filename      TEXT,
  mime_type     TEXT,
  s3_key        TEXT,
  local_path    TEXT,                   -- cached for offline view
  pulled_at     TEXT
);

-- ---------------------------------------------------------------------
-- 4. OFFLINE-AUTHORED EXECUTION ROWS (materialised UI state)
--    Each carries sync_state + op_id; mirrors schema.prisma field-for-field.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS worklog (
  id            TEXT PRIMARY KEY,
  job_order_id  TEXT NOT NULL,
  technician_id TEXT NOT NULL,
  started_at    TEXT NOT NULL,
  ended_at      TEXT,
  -- D-004: labourRate is per-job, default SGD 90/hr, overridable. Snapshotted at
  -- authoring time (from jo_cache) so an office-side rate change never retroactively
  -- alters an already-authored/synced WorkLog (OD-03 immutability).
  labour_rate_amount_minor INTEGER,
  labour_rate_currency     TEXT,
  version       INTEGER NOT NULL DEFAULT 0,
  op_id         TEXT,
  sync_state    TEXT NOT NULL DEFAULT 'PENDING'
);

CREATE TABLE IF NOT EXISTS photo (
  id            TEXT PRIMARY KEY,
  job_order_id  TEXT NOT NULL,
  s3_key        TEXT,                   -- null until binary uploaded
  phase         TEXT NOT NULL,          -- BEFORE | DURING | AFTER
  geo_lat       REAL,
  geo_lng       REAL,
  taken_at      TEXT NOT NULL,
  captured_by_id TEXT NOT NULL,
  op_id         TEXT,
  sync_state    TEXT NOT NULL DEFAULT 'PENDING'
);

CREATE TABLE IF NOT EXISTS observation (
  id            TEXT PRIMARY KEY,
  job_order_id  TEXT NOT NULL,
  template_key  TEXT,
  body          TEXT NOT NULL,
  author_id     TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  op_id         TEXT,
  sync_state    TEXT NOT NULL DEFAULT 'PENDING'
);

CREATE TABLE IF NOT EXISTS checklist_instance (
  id            TEXT PRIMARY KEY,
  job_order_id  TEXT NOT NULL,
  template_id   TEXT NOT NULL,
  results_json  TEXT NOT NULL,
  completed_by_id TEXT,
  completed_at  TEXT,
  version       INTEGER NOT NULL DEFAULT 0,
  op_id         TEXT,
  sync_state    TEXT NOT NULL DEFAULT 'PENDING'
);

CREATE TABLE IF NOT EXISTS material_line (   -- OD-01 record-keeping only; source=FIELD offline
  id            TEXT PRIMARY KEY,
  job_order_id  TEXT,
  part_catalog_id TEXT,
  description   TEXT NOT NULL,
  quantity      TEXT NOT NULL,          -- decimal-as-text to avoid float drift
  unit          TEXT NOT NULL,
  unit_cost_amount_minor INTEGER NOT NULL,
  unit_cost_currency     TEXT NOT NULL,
  source        TEXT NOT NULL DEFAULT 'FIELD',
  added_by_id   TEXT NOT NULL,
  version       INTEGER NOT NULL DEFAULT 0,
  op_id         TEXT,
  sync_state    TEXT NOT NULL DEFAULT 'PENDING'
);

-- OD-06 PENDING: evidence columns are reserved but NOT populated until ratified.
CREATE TABLE IF NOT EXISTS esignature (
  id            TEXT PRIMARY KEY,
  job_order_id  TEXT NOT NULL UNIQUE,
  image_s3_key  TEXT,                   -- null until binary uploaded
  signer_name   TEXT,                   -- OD-06 reserved
  signer_role   TEXT,                   -- OD-06 reserved
  signed_at     TEXT,                   -- OD-06 reserved
  device_id     TEXT,                   -- OD-06 reserved (Mobile feasibility CONFIRMED — see design §8)
  geo_lat       REAL,                   -- OD-06 reserved
  geo_lng       REAL,                   -- OD-06 reserved
  document_hash TEXT,                   -- OD-06 reserved (SHA-256 of signed PDF)
  op_id         TEXT,
  sync_state    TEXT NOT NULL DEFAULT 'PENDING'
);