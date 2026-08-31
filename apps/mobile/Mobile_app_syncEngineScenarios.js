// =====================================================================
// MarineX360 — mobile sync-engine composable scenarios
// Exercises useSyncEngine.ts through a MobileSqlAdapter-shaped in-memory
// test double. This is the runtime-path companion to the node:sqlite spike.
// =====================================================================

import { MockServer } from './Mobile_app_mockServer.js';
import { useSyncEngine } from './src/composables/useSyncEngine.ts';

const TECH = 'user-tech-001';
const JO_ID = 'jo-1111';
const AUTH_OK = { valid: true, userId: TECH };

let idSeq = 0;
let pass = 0;
let fail = 0;

function nowIso() {
  return new Date().toISOString();
}

function nextId(prefix) {
  idSeq += 1;
  return `${prefix}-${String(idSeq).padStart(4, '0')}`;
}

function check(name, cond, detail = '') {
  if (cond) {
    pass += 1;
    console.log(`  ✓ ${name}`);
  } else {
    fail += 1;
    console.log(`  ✗ ${name}  ${detail}`);
  }
}

function compact(sql) {
  return sql.replace(/\s+/g, ' ').trim();
}

class MemorySqlAdapter {
  constructor() {
    this.seq = 0;
    this.app_meta = new Map([['schema_version', '1']]);
    this.sync_cursor = { cursor: null, last_pull_at: null };
    this.jo_cache = new Map();
    this.op_queue = [];
    this.observation = new Map();
    this.worklog = new Map();
    this.photo = new Map();
    this.checklist_instance = new Map();
    this.material_line = new Map();
    this.esignature = new Map();
    this.binary_upload = new Map();
  }

  table(name) {
    const table = this[name];
    if (!(table instanceof Map)) throw new Error(`unsupported table ${name}`);
    return table;
  }

  async select(sql, params = []) {
    const q = compact(sql);

    if (q === 'SELECT cursor FROM sync_cursor WHERE id=1') {
      return [{ cursor: this.sync_cursor.cursor }];
    }
    if (q === "SELECT * FROM op_queue WHERE status='CONFLICT'") {
      return this.op_queue.filter((row) => row.status === 'CONFLICT').map((row) => ({ ...row }));
    }
    if (q.startsWith("SELECT * FROM op_queue WHERE status='PENDING'")) {
      return this.op_queue
        .filter((row) => row.status === 'PENDING' && (row.next_attempt_at == null || row.next_attempt_at <= params[0]) && row.blocks_on_op == null)
        .sort((a, b) => a.seq - b.seq)
        .map((row) => ({ ...row }));
    }
    if (q === 'SELECT status, COUNT(*) n FROM op_queue GROUP BY status') {
      const counts = new Map();
      for (const row of this.op_queue) counts.set(row.status, (counts.get(row.status) ?? 0) + 1);
      return [...counts.entries()].map(([status, n]) => ({ status, n }));
    }
    if (q === 'SELECT * FROM op_queue WHERE op_id=?') {
      const row = this.op_queue.find((op) => op.op_id === params[0]);
      return row ? [{ ...row }] : [];
    }
    throw new Error(`unsupported select: ${q}`);
  }

  async execute(sql, params = []) {
    const q = compact(sql);

    if (q.startsWith('INSERT INTO jo_cache')) {
      const [
        id,
        jo_number,
        branch,
        client_name,
        vessel_name,
        imo_number,
        port,
        scope_summary,
        service_categories,
        state,
        execution_owner_id,
        assigned_technician_ids,
        planned_start_date,
        labour_rate_amount_minor,
        labour_rate_currency,
        version,
        header_locked,
        pulled_at,
      ] = params;
      const previous = this.jo_cache.get(id) ?? {};
      this.jo_cache.set(id, {
        ...previous,
        id,
        jo_number,
        branch,
        client_name,
        vessel_name,
        imo_number,
        port,
        scope_summary,
        service_categories,
        state,
        execution_owner_id,
        assigned_technician_ids,
        planned_start_date,
        labour_rate_amount_minor,
        labour_rate_currency,
        version,
        header_locked,
        pulled_at,
      });
      return;
    }

    if (q === 'UPDATE sync_cursor SET cursor=?, last_pull_at=? WHERE id=1') {
      this.sync_cursor = { cursor: params[0], last_pull_at: params[1] };
      return;
    }

    if (q === "UPDATE op_queue SET status='SYNCING', attempts=attempts+1, updated_at=? WHERE op_id=?") {
      const row = this.op(params[1]);
      row.status = 'SYNCING';
      row.attempts += 1;
      row.updated_at = params[0];
      return;
    }

    if (q === "UPDATE op_queue SET status='SYNCED', server_version=?, result_ref=?, last_error=NULL, updated_at=? WHERE op_id=?") {
      const row = this.op(params[3]);
      row.status = 'SYNCED';
      row.server_version = params[0];
      row.result_ref = params[1];
      row.last_error = null;
      row.updated_at = params[2];
      return;
    }

    if (q === "UPDATE op_queue SET status='FLAGGED', server_version=?, result_ref=?, last_error=NULL, updated_at=? WHERE op_id=?") {
      const row = this.op(params[3]);
      row.status = 'FLAGGED';
      row.server_version = params[0];
      row.result_ref = params[1];
      row.last_error = null;
      row.updated_at = params[2];
      return;
    }

    if (q === "UPDATE op_queue SET status='CONFLICT', server_version=?, updated_at=? WHERE op_id=?") {
      const row = this.op(params[2]);
      row.status = 'CONFLICT';
      row.server_version = params[0];
      row.updated_at = params[1];
      return;
    }

    if (q === "UPDATE op_queue SET status='ERROR', last_error=?, updated_at=? WHERE op_id=?") {
      const row = this.op(params[2]);
      row.status = 'ERROR';
      row.last_error = params[0];
      row.updated_at = params[1];
      return;
    }

    if (q === "UPDATE op_queue SET status='PENDING', next_attempt_at=?, last_error=?, updated_at=? WHERE op_id=?") {
      const row = this.op(params[3]);
      row.status = 'PENDING';
      row.next_attempt_at = params[0];
      row.last_error = params[1];
      row.updated_at = params[2];
      return;
    }

    if (q === "UPDATE op_queue SET status='PENDING', last_error='401 — re-auth required', updated_at=? WHERE op_id=?") {
      const row = this.op(params[1]);
      row.status = 'PENDING';
      row.last_error = '401 — re-auth required';
      row.updated_at = params[0];
      return;
    }

    if (q === "UPDATE op_queue SET status='PENDING', last_error=?, updated_at=? WHERE op_id=?") {
      const row = this.op(params[2]);
      row.status = 'PENDING';
      row.last_error = params[0];
      row.updated_at = params[1];
      return;
    }

    if (q === "UPDATE op_queue SET base_version=?, status='PENDING', next_attempt_at=NULL, updated_at=? WHERE op_id=?") {
      const row = this.op(params[2]);
      row.base_version = params[0];
      row.status = 'PENDING';
      row.next_attempt_at = null;
      row.updated_at = params[1];
      return;
    }

    if (q === "INSERT OR REPLACE INTO app_meta (k,v) VALUES ('upgrade_required','1')") {
      this.app_meta.set('upgrade_required', '1');
      return;
    }

    const versioned = q.match(/^UPDATE ([a-z_]+) SET sync_state=\?, version=\? WHERE id=\?$/);
    if (versioned) {
      const row = this.table(versioned[1]).get(params[2]);
      if (row) {
        row.sync_state = params[0];
        row.version = params[1];
      }
      return;
    }

    const stateOnly = q.match(/^UPDATE ([a-z_]+) SET sync_state=\? WHERE id=\?$/);
    if (stateOnly) {
      const row = this.table(stateOnly[1]).get(params[1]);
      if (row) row.sync_state = params[0];
      return;
    }

    throw new Error(`unsupported execute: ${q}`);
  }

  op(opId) {
    const row = this.op_queue.find((op) => op.op_id === opId);
    if (!row) throw new Error(`missing op ${opId}`);
    return row;
  }

  enqueue({ opId, entity, action, entityId, jobOrderId, payload, baseVersion = null, blocksOnOp = null }) {
    const at = nowIso();
    this.op_queue.push({
      seq: ++this.seq,
      op_id: opId,
      entity,
      action,
      entity_id: entityId,
      job_order_id: jobOrderId,
      payload_json: JSON.stringify(payload),
      base_version: baseVersion,
      schema_version: Number(this.app_meta.get('schema_version')),
      client_time: at,
      status: 'PENDING',
      attempts: 0,
      next_attempt_at: null,
      server_version: null,
      result_ref: null,
      last_error: null,
      blocks_on_op: blocksOnOp,
      created_at: at,
      updated_at: at,
    });
  }

  clearBackoff() {
    for (const row of this.op_queue) {
      if (row.status === 'PENDING') row.next_attempt_at = null;
    }
  }
}

function installRuntime(db, userId = TECH) {
  globalThis.marinex360 = {
    db,
    auth: { userId },
  };
}

function makeTransport(server, faults = {}) {
  return {
    batch(req, auth) {
      if (faults.networkOnce) {
        faults.networkOnce = false;
        const error = new Error('ECONNRESET');
        error.code = 'ECONNRESET';
        throw error;
      }
      if (faults.authFailOnce) {
        faults.authFailOnce = false;
        return { httpStatus: 401, error: { code: 'UNAUTHORIZED' }, results: [] };
      }
      return server.handleSyncBatch(req, auth);
    },
    assigned(query, auth) {
      return server.handleSyncAssigned(query, auth);
    },
  };
}

function makePerOpStatusTransport(server, status) {
  return {
    batch(req) {
      return { httpStatus: 200, results: req.ops.map((op) => ({ opId: op.opId, status, error: { code: status, message: status } })) };
    },
    assigned(query, auth) {
      return server.handleSyncAssigned(query, auth);
    },
  };
}

function seedJobOrderCache(db, jo) {
  db.jo_cache.set(jo.id, {
    id: jo.id,
    jo_number: jo.joNumber,
    branch: jo.branch,
    client_name: jo.clientName ?? null,
    vessel_name: jo.vesselName ?? null,
    imo_number: jo.imoNumber ?? null,
    port: jo.port ?? null,
    scope_summary: jo.scopeSummary ?? null,
    service_categories: JSON.stringify(jo.serviceCategories ?? []),
    state: jo.state,
    execution_owner_id: jo.executionOwnerId ?? null,
    assigned_technician_ids: JSON.stringify(jo.assignedTechnicianIds ?? []),
    planned_start_date: jo.plannedStartDate ?? null,
    labour_rate_amount_minor: jo.labourRateAmountMinor ?? 9000,
    labour_rate_currency: jo.labourRateCurrency ?? 'SGD',
    version: jo.version ?? 0,
    header_locked: jo.state === 'IN_PROGRESS' ? 1 : 0,
    pulled_at: nowIso(),
  });
}

function freshWorld(userId = TECH) {
  const server = new MockServer();
  server.seedJobOrder({
    id: JO_ID,
    joNumber: 'SG-JO-0001',
    branch: 'SG',
    state: 'IN_PROGRESS',
    assignedTechnicianIds: [TECH],
    executionOwnerId: TECH,
    scopeSummary: 'Main engine survey',
  });
  const db = new MemorySqlAdapter();
  seedJobOrderCache(db, server.jobOrders.get(JO_ID));
  installRuntime(db, userId);
  return { server, db, sync: useSyncEngine() };
}

function opStatus(db, opId) {
  return db.op(opId).status;
}

function entityState(db, table, id) {
  return db.table(table).get(id)?.sync_state;
}

function opErrorCode(db, opId) {
  const raw = db.op(opId).last_error;
  if (!raw) return null;
  const parsed = JSON.parse(raw);
  return typeof parsed === 'string' ? parsed : parsed.code;
}

function queueCount(db) {
  return db.op_queue.length;
}

function authorObservation(db, jobOrderId, body, templateKey = null, userId = TECH) {
  const id = nextId('obs');
  const opId = nextId('op');
  const createdAt = nowIso();
  const payload = { id, jobOrderId, templateKey, body, authorId: userId, opId, createdAt };
  db.observation.set(id, { id, job_order_id: jobOrderId, template_key: templateKey, body, author_id: userId, created_at: createdAt, op_id: opId, sync_state: 'PENDING' });
  db.enqueue({ opId, entity: 'Observation', action: 'CREATE', entityId: id, jobOrderId, payload });
  return { id, opId };
}

function authorWorklogStart(db, jobOrderId, userId = TECH) {
  const jo = db.jo_cache.get(jobOrderId);
  if (!jo) throw new Error(`JO not pre-fetched: ${jobOrderId}`);
  const id = nextId('wl');
  const opId = nextId('op');
  const startedAt = nowIso();
  const payload = {
    id,
    jobOrderId,
    technicianId: userId,
    startedAt,
    opId,
    labourRateAmountMinor: jo.labour_rate_amount_minor,
    labourRateCurrency: jo.labour_rate_currency,
  };
  db.worklog.set(id, {
    id,
    job_order_id: jobOrderId,
    technician_id: userId,
    started_at: startedAt,
    ended_at: null,
    labour_rate_amount_minor: jo.labour_rate_amount_minor,
    labour_rate_currency: jo.labour_rate_currency,
    version: 0,
    op_id: opId,
    sync_state: 'PENDING',
  });
  db.enqueue({ opId, entity: 'WorkLog', action: 'CREATE', entityId: id, jobOrderId, payload });
  return { id, opId };
}

function seedLocalWorklog(db, row) {
  db.worklog.set(row.id, {
    id: row.id,
    job_order_id: row.jobOrderId,
    technician_id: row.technicianId,
    started_at: row.startedAt,
    ended_at: row.endedAt ?? null,
    version: row.version ?? 0,
    op_id: null,
    sync_state: 'SYNCED',
  });
}

function authorWorklogUpdate(db, worklogId, jobOrderId, patch, baseVersion) {
  const opId = nextId('op');
  const row = db.worklog.get(worklogId);
  Object.assign(row, patch, { op_id: opId, sync_state: 'PENDING' });
  db.enqueue({ opId, entity: 'WorkLog', action: 'UPDATE', entityId: worklogId, jobOrderId, payload: { id: worklogId, jobOrderId, ...patch, opId }, baseVersion });
  return { opId };
}

function authorChecklistSubmit(db, jobOrderId, templateId, results, userId = TECH) {
  const id = nextId('checklist');
  const opId = nextId('op');
  const completedAt = nowIso();
  const payload = { id, jobOrderId, templateId, results, completedById: userId, completedAt, opId };
  db.checklist_instance.set(id, {
    id,
    job_order_id: jobOrderId,
    template_id: templateId,
    results_json: JSON.stringify(results),
    completed_by_id: userId,
    completed_at: completedAt,
    version: 0,
    op_id: opId,
    sync_state: 'PENDING',
  });
  db.enqueue({ opId, entity: 'ChecklistInstance', action: 'CREATE', entityId: id, jobOrderId, payload });
  return { id, opId };
}

function authorPhotoCapture(db, jobOrderId, phase, localPath, geoLat = null, geoLng = null, userId = TECH) {
  const id = nextId('photo');
  const opId = nextId('op');
  const takenAt = nowIso();
  const payload = { id, jobOrderId, s3Key: null, phase, geoLat, geoLng, takenAt, capturedById: userId, opId };
  db.binary_upload.set(id, { id, entity: 'Photo', local_path: localPath, upload_state: 'PENDING' });
  db.photo.set(id, { id, job_order_id: jobOrderId, s3_key: null, phase, geo_lat: geoLat, geo_lng: geoLng, taken_at: takenAt, captured_by_id: userId, op_id: opId, sync_state: 'PENDING' });
  db.enqueue({ opId, entity: 'Photo', action: 'CREATE', entityId: id, jobOrderId, payload, blocksOnOp: id });
  return { id, opId, uploadId: id };
}

function authorESignature(db, jobOrderId, signerName, signerRole, documentHash = 'a'.repeat(64)) {
  const id = nextId('sign');
  const opId = nextId('op');
  const signedAt = nowIso();
  const payload = { id, jobOrderId, imageS3Key: null, signerName, signerRole, signedAt, deviceId: null, geoLat: null, geoLng: null, documentHash, opId };
  db.binary_upload.set(id, { id, entity: 'ESignature', local_path: '/local/signature.png', upload_state: 'PENDING' });
  db.esignature.set(id, { id, job_order_id: jobOrderId, image_s3_key: null, signer_name: signerName, signer_role: signerRole, signed_at: signedAt, document_hash: documentHash, op_id: opId, sync_state: 'PENDING' });
  db.enqueue({ opId, entity: 'ESignature', action: 'CREATE', entityId: id, jobOrderId, payload, blocksOnOp: id });
  return { id, opId, uploadId: id, documentHash };
}

function completeBinaryUpload(db, uploadId, s3Key) {
  const upload = db.binary_upload.get(uploadId);
  const op = db.op_queue.find((row) => row.entity_id === uploadId && row.blocks_on_op === uploadId);
  const payload = JSON.parse(op.payload_json);

  upload.upload_state = 'DONE';
  upload.s3_key = s3Key;
  if (upload.entity === 'Photo') {
    payload.s3Key = s3Key;
    db.photo.get(uploadId).s3_key = s3Key;
  } else {
    payload.imageS3Key = s3Key;
    db.esignature.get(uploadId).image_s3_key = s3Key;
  }
  op.payload_json = JSON.stringify(payload);
  op.blocks_on_op = null;
  op.updated_at = nowIso();
}

console.log('\n══════════ MarineX360 · async useSyncEngine runtime path ══════════');

await (async () => {
  console.log('\n[1] APPLIED — offline write, reconnect, push');
  const { server, db, sync } = freshWorld();
  const { opId } = authorObservation(db, JO_ID, 'Cylinder head torque verified');
  check('queued as PENDING before sync', opStatus(db, opId) === 'PENDING');
  await sync.syncOnce(makeTransport(server), AUTH_OK);
  check('op → SYNCED', opStatus(db, opId) === 'SYNCED');
  check('entity row → SYNCED', entityState(db, 'observation', db.op(opId).entity_id) === 'SYNCED');
  check('server stored the row', server.rows.has(`Observation:${db.op(opId).result_ref}`));
})();

await (async () => {
  console.log('\n[2] IDEMPOTENT_REPLAY — resend the same op');
  const { server, db, sync } = freshWorld();
  const { opId } = authorObservation(db, JO_ID, 'Bearing clearance within spec');
  await sync.syncOnce(makeTransport(server), AUTH_OK);
  db.op(opId).status = 'PENDING';
  const before = server.rows.size;
  await sync.syncOnce(makeTransport(server), AUTH_OK);
  check('no duplicate row created', server.rows.size === before);
  check('UI shows Synced (not error)', opStatus(db, opId) === 'SYNCED');
})();

await (async () => {
  console.log('\n[3] VERSION_CONFLICT — reload+reapply');
  const { server, db, sync } = freshWorld();
  server.seedRow('WorkLog', { id: 'wl-1', jobOrderId: JO_ID, technicianId: TECH, startedAt: '2026-06-20T01:00:00Z' });
  seedLocalWorklog(db, { id: 'wl-1', jobOrderId: JO_ID, technicianId: TECH, startedAt: '2026-06-20T01:00:00Z', version: 0 });
  const { opId } = authorWorklogUpdate(db, 'wl-1', JO_ID, { ended_at: '2026-06-20T05:00:00Z' }, 0);
  server.officeEdit('WorkLog', 'wl-1', { note: 'office correction' });
  await sync.syncOnce(makeTransport(server), AUTH_OK);
  check('first push → CONFLICT', opStatus(db, opId) === 'CONFLICT');
  check('entity row → CONFLICT', entityState(db, 'worklog', 'wl-1') === 'CONFLICT');
  await sync.reconcileConflicts();
  check('after reconcile → PENDING', opStatus(db, opId) === 'PENDING');
  await sync.syncOnce(makeTransport(server), AUTH_OK);
  check('re-push → SYNCED', opStatus(db, opId) === 'SYNCED');
  check('technician edit preserved on server', server.rows.get('WorkLog:wl-1').ended_at === '2026-06-20T05:00:00Z');
})();

await (async () => {
  console.log('\n[4] VALIDATION_ERROR — surfaced, not looped');
  const { server, db, sync } = freshWorld();
  const { opId } = authorObservation(db, JO_ID, 'temp');
  const payload = JSON.parse(db.op(opId).payload_json);
  delete payload.body;
  db.op(opId).payload_json = JSON.stringify(payload);
  await sync.syncOnce(makeTransport(server), AUTH_OK);
  check('op → ERROR', opStatus(db, opId) === 'ERROR');
  check('entity row → ERROR', entityState(db, 'observation', db.op(opId).entity_id) === 'ERROR');
  const attemptsBefore = db.op(opId).attempts;
  db.clearBackoff();
  await sync.syncOnce(makeTransport(server), AUTH_OK);
  check('ERROR op is not auto-retried', attemptsBefore === db.op(opId).attempts);
})();

for (const [label, status] of [
  ['4b', 'BRANCH_SCOPE_DENIED'],
  ['4c', 'STATE_TRANSITION_INVALID'],
  ['4d', 'UNAUTHORIZED'],
  ['4e', 'NOT_FOUND'],
  ['4f', 'FORBIDDEN'],
]) {
  await (async () => {
    console.log(`\n[${label}] ${status} — per-op denial surfaced, not looped`);
    const { server, db, sync } = freshWorld();
    const { opId } = authorObservation(db, JO_ID, `${status} payload`);
    await sync.syncOnce(makePerOpStatusTransport(server, status), AUTH_OK);
    check('op → ERROR', opStatus(db, opId) === 'ERROR');
    check(`last_error carries ${status}`, opErrorCode(db, opId) === status);
  })();
}

await (async () => {
  console.log('\n[5] BATCH_REJECTED_SCHEMA — queue preserved, no migrate');
  const { server, db, sync } = freshWorld();
  server.minSchema = 2;
  const { opId } = authorObservation(db, JO_ID, 'Coupling alignment recorded');
  const result = await sync.syncOnce(makeTransport(server), AUTH_OK);
  check('batch rejected → upgradeRequired', result.upgradeRequired === true);
  check('op stays PENDING', opStatus(db, opId) === 'PENDING');
  check('upgrade gate raised', db.app_meta.get('upgrade_required') === '1');
  check('row NOT applied on server', server.rows.size === 0);
})();

await (async () => {
  console.log('\n[6] 401 UNAUTHORIZED mid-offline — queue preserved');
  const { server, db, sync } = freshWorld();
  const { opId } = authorObservation(db, JO_ID, 'Lube oil sample taken');
  const result = await sync.syncOnce(makeTransport(server, { authFailOnce: true }), AUTH_OK);
  check('first attempt → authRequired', result.authRequired === true);
  check('op PRESERVED as PENDING', opStatus(db, opId) === 'PENDING');
  await sync.syncOnce(makeTransport(server), AUTH_OK);
  check('after re-auth → SYNCED', opStatus(db, opId) === 'SYNCED');
})();

await (async () => {
  console.log('\n[7] SYNC-13 — unassigned while offline → APPLIED_FLAGGED');
  const { server, db, sync } = freshWorld();
  const { opId } = authorObservation(db, JO_ID, 'Final visual inspection complete');
  server.unassignTechnician(JO_ID, TECH);
  await sync.syncOnce(makeTransport(server), AUTH_OK);
  check('queue row FLAGGED', opStatus(db, opId) === 'FLAGGED');
  check('entity row FLAGGED', entityState(db, 'observation', db.op(opId).entity_id) === 'FLAGGED');
  check('server STORED the row', [...server.rows.keys()].some((key) => key.startsWith('Observation:')));
  check('server flagged for supervisor review', [...server.rows.values()].some((row) => row.reviewState === 'PENDING_SUPERVISOR_REVIEW'));
})();

await (async () => {
  console.log('\n[8] NETWORK failure then recovery — backoff, no duplicate');
  const { server, db, sync } = freshWorld();
  const { opId } = authorObservation(db, JO_ID, 'Tank pressure test logged');
  await sync.syncOnce(makeTransport(server, { networkOnce: true }), AUTH_OK);
  check('after network fail → PENDING', opStatus(db, opId) === 'PENDING');
  check('backoff gate set', db.op(opId).next_attempt_at != null);
  db.clearBackoff();
  await sync.syncOnce(makeTransport(server), AUTH_OK);
  check('after recovery → SYNCED', opStatus(db, opId) === 'SYNCED');
  check('exactly one row on server', [...server.rows.keys()].filter((key) => key.startsWith('Observation:')).length === 1);
})();

await (async () => {
  console.log('\n[9] D-004 — WorkLog snapshots labourRate offline');
  const { server, db, sync } = freshWorld();
  const { id, opId } = authorWorklogStart(db, JO_ID);
  const wl = db.worklog.get(id);
  check('WorkLog snapshotted default rate 9000 SGD', wl.labour_rate_amount_minor === 9000 && wl.labour_rate_currency === 'SGD');
  await sync.syncOnce(makeTransport(server), AUTH_OK);
  check('WorkLog CREATE → SYNCED', opStatus(db, opId) === 'SYNCED');
  server.jobOrders.get(JO_ID).labourRateAmountMinor = 11000;
  server.jobOrders.get(JO_ID).labourRateCurrency = 'SGD';
  server._log('JobOrder', server.jobOrders.get(JO_ID));
  authorObservation(db, JO_ID, 'Trigger pull after office rate edit');
  await sync.syncOnce(makeTransport(server), AUTH_OK);
  check('already-authored WorkLog rate NOT retro-altered', db.worklog.get(id).labour_rate_amount_minor === 9000);
  check('jo_cache reflects new rate for the NEXT worklog', db.jo_cache.get(JO_ID).labour_rate_amount_minor === 11000);
})();

await (async () => {
  console.log('\n[10] Checklist submit — CREATE ChecklistInstance → APPLIED');
  const { server, db, sync } = freshWorld();
  const results = [{ itemId: 'visual-check', value: true }];
  const { id, opId } = authorChecklistSubmit(db, JO_ID, 'tmpl-main-engine', results);
  check('checklist row stores results_json', db.checklist_instance.get(id).results_json === JSON.stringify(results));
  await sync.syncOnce(makeTransport(server), AUTH_OK);
  check('ChecklistInstance CREATE → SYNCED', opStatus(db, opId) === 'SYNCED');
  check('server stored checklist results', JSON.stringify(server.rows.get(`ChecklistInstance:${id}`).results) === JSON.stringify(results));
})();

await (async () => {
  console.log('\n[11] Photo capture — blocks_on_op gates metadata until binary completes');
  const { server, db, sync } = freshWorld();
  const { id, opId, uploadId } = authorPhotoCapture(db, JO_ID, 'DURING', '/local/photos/pump-before.jpg');
  check('metadata op is blocked before upload', (await sync.readyOps()).length === 0);
  await sync.syncOnce(makeTransport(server), AUTH_OK);
  check('blocked photo op remains PENDING', opStatus(db, opId) === 'PENDING');
  completeBinaryUpload(db, uploadId, 'photos/jo-1111/pump-before.jpg');
  const op = db.op(opId);
  check('binary upload unblocks metadata op', op.blocks_on_op === null && db.photo.get(id).s3_key === 'photos/jo-1111/pump-before.jpg');
  check('metadata payload carries s3Key', JSON.parse(op.payload_json).s3Key === 'photos/jo-1111/pump-before.jpg');
  await sync.syncOnce(makeTransport(server), AUTH_OK);
  check('Photo metadata CREATE → SYNCED', opStatus(db, opId) === 'SYNCED');
  check('server stored photo s3Key', server.rows.get(`Photo:${id}`).s3Key === 'photos/jo-1111/pump-before.jpg');
})();

await (async () => {
  console.log('\n[12] ESignature metadata — immutable CREATE payload syncs after binary completes');
  const { server, db, sync } = freshWorld();
  const { id, opId, uploadId, documentHash } = authorESignature(db, JO_ID, 'Tariq Technician', 'Execution owner');
  check('signature metadata waits for binary upload', !(await sync.readyOps()).some((op) => op.op_id === opId));
  completeBinaryUpload(db, uploadId, 'signatures/jo-1111/owner.png');
  await sync.syncOnce(makeTransport(server), AUTH_OK);
  const serverRow = server.rows.get(`ESignature:${id}`);
  check('ESignature CREATE → SYNCED', opStatus(db, opId) === 'SYNCED');
  check('server stored imageS3Key', serverRow.imageS3Key === 'signatures/jo-1111/owner.png');
  check('server stored documentHash', serverRow.documentHash === documentHash);
})();

console.log(`\n══════════ RESULT: ${pass} passed, ${fail} failed ══════════\n`);
process.exit(fail === 0 ? 0 : 1);
