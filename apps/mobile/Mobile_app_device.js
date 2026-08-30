'use strict';
// =====================================================================
// MarineX360 — DEVICE (S0-6 prototype)
// Real on-device SQLite (node:sqlite) loaded from device-sqlite-schema.sql.
// Implements the op-queue, the sync engine (push → apply results → pull),
// backoff, and the OD-05 reload-and-reapply conflict path.
// In production the same logic runs over @capacitor-community/sqlite.
// =====================================================================

const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const uuid = () => crypto.randomUUID();
const nowIso = () => new Date().toISOString();

class Device {
  constructor(userId, { schemaPath } = {}) {
    this.userId = userId;
    this.db = new DatabaseSync(':memory:');
    const ddl = fs.readFileSync(schemaPath || path.join(__dirname, 'Mobile_app_device-sqlite-schema.sql'), 'utf8');
    this.db.exec(ddl);
    this.log = [];                       // human-readable trace for the scenario runner
    this.events = [];                    // machine-readable per-op outcomes for QA harness
  }
  _trace(m) { this.log.push(m); }
  schemaVersion() {
    return Number(this.db.prepare(`SELECT v FROM app_meta WHERE k='schema_version'`).get().v);
  }

  // ---- PRE-FETCH: persist GET /sync/assigned payload into the read cache ----
  applyPull(changes, cursor) {
    const upJo = this.db.prepare(`INSERT INTO jo_cache
      (id,jo_number,branch,client_name,vessel_name,imo_number,port,scope_summary,service_categories,
       state,execution_owner_id,assigned_technician_ids,planned_start_date,
       labour_rate_amount_minor,labour_rate_currency,version,header_locked,pulled_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET state=excluded.state, version=excluded.version,
        assigned_technician_ids=excluded.assigned_technician_ids,
        execution_owner_id=excluded.execution_owner_id, header_locked=excluded.header_locked,
        labour_rate_amount_minor=excluded.labour_rate_amount_minor,
        labour_rate_currency=excluded.labour_rate_currency, pulled_at=excluded.pulled_at`);
    for (const c of changes) {
      if (c.entity === 'JobOrder') {
        const jo = c.row;
        upJo.run(jo.id, jo.joNumber, jo.branch, jo.clientName ?? null, jo.vesselName ?? null, jo.imoNumber ?? null,
          jo.port ?? null, jo.scopeSummary ?? null, JSON.stringify(jo.serviceCategories ?? []),
          jo.state, jo.executionOwnerId ?? null, JSON.stringify(jo.assignedTechnicianIds ?? []),
          jo.plannedStartDate ?? null, jo.labourRateAmountMinor ?? 9000, jo.labourRateCurrency ?? 'SGD',
          jo.version, jo.state === 'IN_PROGRESS' ? 1 : 0, nowIso());
      }
      // (worklog/photo/etc. server-side deltas would refresh those caches too; elided for the spike)
    }
    if (cursor != null) {
      if (typeof cursor !== 'string') throw new Error('sync cursor must be a string or null');
      this.db.prepare(`UPDATE sync_cursor SET cursor=?, last_pull_at=? WHERE id=1`).run(cursor, nowIso());
    }
    this._trace(`pull: applied ${changes.length} change(s), cursor→${cursor}`);
  }
  /** @returns {string | null} D-053: opaque changeSeq string. Never parse or compare client-side. */
  cursor() { const r = this.db.prepare(`SELECT cursor FROM sync_cursor WHERE id=1`).get(); return r?.cursor ?? null; }
  assignedPullQuery() {
    const cursor = this.cursor();
    return cursor == null ? {} : { since: cursor };
  }

  // ---- AUTHOR an offline write: entity row + op_queue row in ONE transaction ----
  authorObservation(jobOrderId, body, templateKey = null) {
    const id = uuid(), opId = uuid();
    const payload = { id, jobOrderId, templateKey, body, authorId: this.userId, opId, createdAt: nowIso() };
    this.db.exec('BEGIN');
    try {
      this.db.prepare(`INSERT INTO observation (id,job_order_id,template_key,body,author_id,created_at,op_id,sync_state)
        VALUES (?,?,?,?,?,?,?, 'PENDING')`).run(id, jobOrderId, templateKey, body, this.userId, payload.createdAt, opId);
      this._enqueue({ opId, entity: 'Observation', action: 'CREATE', entityId: id, jobOrderId, payload, baseVersion: null });
      this.db.exec('COMMIT');
    } catch (e) { this.db.exec('ROLLBACK'); throw e; }
    this._trace(`author Observation ${id.slice(0,8)} (op ${opId.slice(0,8)}) → PENDING`);
    return { id, opId };
  }
  /** Technician starts work offline: CREATE a WorkLog, snapshotting D-004 labourRate from jo_cache. */
  authorWorklogStart(jobOrderId) {
    const jo = this.db.prepare(`SELECT labour_rate_amount_minor, labour_rate_currency FROM jo_cache WHERE id=?`).get(jobOrderId);
    if (!jo) throw new Error('JO not pre-fetched: ' + jobOrderId);
    const id = uuid(), opId = uuid(), startedAt = nowIso();
    const payload = {
      id, jobOrderId, technicianId: this.userId, startedAt, opId,
      labourRateAmountMinor: jo.labour_rate_amount_minor, labourRateCurrency: jo.labour_rate_currency,
    };
    this.db.exec('BEGIN');
    try {
      this.db.prepare(`INSERT INTO worklog
        (id,job_order_id,technician_id,started_at,labour_rate_amount_minor,labour_rate_currency,op_id,sync_state)
        VALUES (?,?,?,?,?,?,?, 'PENDING')`).run(
        id, jobOrderId, this.userId, startedAt, jo.labour_rate_amount_minor, jo.labour_rate_currency, opId);
      this._enqueue({ opId, entity: 'WorkLog', action: 'CREATE', entityId: id, jobOrderId, payload, baseVersion: null });
      this.db.exec('COMMIT');
    } catch (e) { this.db.exec('ROLLBACK'); throw e; }
    this._trace(`author WorkLog CREATE ${id.slice(0,8)} rate=${jo.labour_rate_amount_minor}${jo.labour_rate_currency} (snapshotted, D-004) → PENDING`);
    return { id, opId };
  }
  /** Author an UPDATE to an existing worklog row (to exercise the conflict path). */
  authorWorklogUpdate(worklogId, jobOrderId, patch, baseVersion) {
    const opId = uuid();
    const payload = { id: worklogId, jobOrderId, ...patch, opId };
    this.db.exec('BEGIN');
    try {
      const sets = Object.keys(patch).map(k => `${k}=?`).join(',');
      this.db.prepare(`UPDATE worklog SET ${sets}, op_id=?, sync_state='PENDING' WHERE id=?`)
        .run(...Object.values(patch), opId, worklogId);
      this._enqueue({ opId, entity: 'WorkLog', action: 'UPDATE', entityId: worklogId, jobOrderId, payload, baseVersion });
      this.db.exec('COMMIT');
    } catch (e) { this.db.exec('ROLLBACK'); throw e; }
    this._trace(`author WorkLog UPDATE ${worklogId.slice(0,8)} baseVersion=${baseVersion} → PENDING`);
    return { opId };
  }
  /** Seed a worklog already known to the device (pre-fetched), so an UPDATE has a base. */
  seedLocalWorklog(row) {
    this.db.prepare(`INSERT INTO worklog (id,job_order_id,technician_id,started_at,ended_at,version,op_id,sync_state)
      VALUES (?,?,?,?,?,?,?, 'SYNCED')`).run(row.id, row.jobOrderId, row.technicianId, row.startedAt,
      row.endedAt ?? null, row.version ?? 0, null);
  }

  _enqueue(op) {
    this.db.prepare(`INSERT INTO op_queue
      (op_id,entity,action,entity_id,job_order_id,payload_json,base_version,schema_version,client_time,status,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?, 'PENDING', ?, ?)`).run(
      op.opId, op.entity, op.action, op.entityId, op.jobOrderId, JSON.stringify(op.payload),
      op.baseVersion ?? null, this.schemaVersion(), nowIso(), nowIso(), nowIso());
  }

  // ---- which ops are ready to send right now ----
  readyOps() {
    const now = nowIso();
    return this.db.prepare(`SELECT * FROM op_queue
      WHERE status='PENDING' AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
        AND blocks_on_op IS NULL
      ORDER BY seq ASC`).all(now);
  }
  queueSummary() {
    const rows = this.db.prepare(`SELECT status, COUNT(*) n FROM op_queue GROUP BY status`).all();
    return Object.fromEntries(rows.map(r => [r.status, r.n]));
  }

  // ---- THE SYNC ENGINE: one drain cycle ----
  // transport.batch(req) and transport.assigned(query) may throw {httpStatus} or network errors.
  syncOnce(transport, auth) {
    const ops = this.readyOps();
    if (ops.length === 0) { this._trace('sync: nothing ready'); return { pushed: 0 }; }

    const req = {
      schemaVersion: ops[0].schema_version,           // batch carries one schema version
      ops: ops.map(o => ({
        opId: o.op_id, entity: o.entity, action: o.action, entityId: o.entity_id,
        jobOrderId: o.job_order_id, payload: JSON.parse(o.payload_json),
        baseVersion: o.base_version, actorId: this.userId,
      })),
    };
    this._markSyncing(ops);

    let resp;
    try { resp = transport.batch(req, auth); }
    catch (netErr) { this._onNetworkFailure(ops, netErr); return { pushed: 0, networkError: true }; }

    // 401 — preserve queue, requeue exact opIds, signal re-auth. NEVER drop.
    if (resp.httpStatus === 401) { this._onAuthFailure(ops); return { pushed: 0, authRequired: true }; }

    // Batch schema rejection — preserve queue, raise upgrade gate, never migrate.
    if (resp.batchStatus === 'BATCH_REJECTED_SCHEMA') { this._onSchemaReject(ops, resp); return { pushed: 0, upgradeRequired: true }; }

    // Apply per-op results.
    for (const r of resp.results) this._applyResult(r);

    // Trailing delta pull (learn server-side changes; also fetches rows needed for conflict reconcile).
    try {
      const pull = transport.assigned(this.assignedPullQuery(), auth);
      if (pull.httpStatus === 200) this.applyPull(pull.changes, pull.cursor);
    } catch (_) { /* pull is best-effort; ops already settled */ }

    return { pushed: resp.results.length };
  }

  _markSyncing(ops) {
    const u = this.db.prepare(`UPDATE op_queue SET status='SYNCING', attempts=attempts+1, updated_at=? WHERE op_id=?`);
    for (const o of ops) u.run(nowIso(), o.op_id);
  }

  _applyResult(r) {
    const op = this.db.prepare(`SELECT * FROM op_queue WHERE op_id=?`).get(r.opId);
    if (!op) return;
    const setEntity = (state, version) => this._setEntityState(op.entity, op.entity_id, state, version);
    this.events.push({ opId: r.opId, entity: op.entity, status: r.status });

    switch (r.status) {
      case 'APPLIED':
      case 'IDEMPOTENT_REPLAY':
        this.db.prepare(`UPDATE op_queue SET status='SYNCED', server_version=?, result_ref=?, last_error=NULL, updated_at=? WHERE op_id=?`)
          .run(r.serverVersion ?? null, r.resultRef ?? null, nowIso(), r.opId);
        setEntity('SYNCED', r.serverVersion);
        this._trace(`  ${r.opId.slice(0,8)} ${op.entity} → ${r.status} (Synced)`);
        break;
      case 'APPLIED_FLAGGED': // CC-MOB-2 / SYNC-13
        this.db.prepare(`UPDATE op_queue SET status='FLAGGED', server_version=?, result_ref=?, last_error=NULL, updated_at=? WHERE op_id=?`)
          .run(r.serverVersion ?? null, r.resultRef ?? null, nowIso(), r.opId);
        setEntity('FLAGGED', r.serverVersion);
        this._trace(`  ${r.opId.slice(0,8)} ${op.entity} → APPLIED_FLAGGED (Sent — pending review)`);
        break;
      case 'VERSION_CONFLICT':
        this.db.prepare(`UPDATE op_queue SET status='CONFLICT', server_version=?, updated_at=? WHERE op_id=?`)
          .run(r.serverVersion ?? null, nowIso(), r.opId);
        setEntity('CONFLICT', null);
        this._trace(`  ${r.opId.slice(0,8)} ${op.entity} → VERSION_CONFLICT (server v${r.serverVersion}) — will reload+reapply`);
        break;
      case 'VALIDATION_ERROR':
        this._markResultError(op, r, 'Validation error');
        break;
      case 'FORBIDDEN':
        this._markResultError(op, r, 'Forbidden');
        break;
      case 'BRANCH_SCOPE_DENIED':
        this._markResultError(op, r, 'Branch scope denied');
        break;
      case 'STATE_TRANSITION_INVALID':
        this._markResultError(op, r, 'Invalid state transition');
        break;
      default:
        this._trace(`  ${r.opId.slice(0,8)} ${op.entity} → UNKNOWN ${r.status}`);
    }
  }

  _markResultError(op, r, label) {
    this.db.prepare(`UPDATE op_queue SET status='ERROR', last_error=?, updated_at=? WHERE op_id=?`)
      .run(JSON.stringify(r.error ?? r.status), nowIso(), r.opId);
    this._setEntityState(op.entity, op.entity_id, 'ERROR', null);
    this._trace(`  ${r.opId.slice(0,8)} ${op.entity} → ${r.status} (${label}; Retry needed; not auto-retried)`);
  }

  _setEntityState(entity, id, state, version) {
    const tbl = { WorkLog:'worklog', Photo:'photo', Observation:'observation',
                  ChecklistInstance:'checklist_instance', MaterialLine:'material_line', ESignature:'esignature' }[entity];
    if (!tbl) return;
    if (version != null && ['worklog','checklist_instance','material_line'].includes(tbl))
      this.db.prepare(`UPDATE ${tbl} SET sync_state=?, version=? WHERE id=?`).run(state, version, id);
    else
      this.db.prepare(`UPDATE ${tbl} SET sync_state=? WHERE id=?`).run(state, id);
  }

  // ---- OD-05 reload-and-reapply for conflicted ops (uses freshly pulled server version) ----
  reconcileConflicts() {
    const conflicts = this.db.prepare(`SELECT * FROM op_queue WHERE status='CONFLICT'`).all();
    for (const op of conflicts) {
      // The trailing pull refreshed jo_cache; for a worklog we re-stage onto the new server version.
      const newBase = op.server_version;   // version the server reported
      this.db.prepare(`UPDATE op_queue SET base_version=?, status='PENDING', next_attempt_at=NULL, updated_at=? WHERE op_id=?`)
        .run(newBase, nowIso(), op.op_id);
      this._setEntityState(op.entity, op.entity_id, 'PENDING', null);
      this._trace(`  reconcile ${op.op_id.slice(0,8)}: re-stage on server v${newBase}, re-queue PENDING`);
    }
    return conflicts.length;
  }

  _onNetworkFailure(ops, err) {
    const u = this.db.prepare(`UPDATE op_queue SET status='PENDING', next_attempt_at=?, last_error=?, updated_at=? WHERE op_id=?`);
    for (const o of ops) u.run(this._backoff(o.attempts), 'network: ' + (err.code || err.message), nowIso(), o.op_id);
    this._trace(`sync: NETWORK FAILURE — ${ops.length} op(s) re-queued under backoff (queue preserved)`);
  }
  _onAuthFailure(ops) {
    const u = this.db.prepare(`UPDATE op_queue SET status='PENDING', last_error='401 — re-auth required', updated_at=? WHERE op_id=?`);
    for (const o of ops) u.run(nowIso(), o.op_id);            // no backoff; gated on re-auth
    this._trace(`sync: 401 UNAUTHORIZED — queue PRESERVED, ${ops.length} op(s) await re-auth (same opIds)`);
  }
  _onSchemaReject(ops, resp) {
    const u = this.db.prepare(`UPDATE op_queue SET status='PENDING', last_error=?, updated_at=? WHERE op_id=?`);
    for (const o of ops) u.run(`BATCH_REJECTED_SCHEMA min=${resp.minSchemaVersion}`, nowIso(), o.op_id);
    this.db.prepare(`UPDATE app_meta SET v='1' WHERE k='upgrade_required'`); // (no-op insert below)
    this.db.prepare(`INSERT OR REPLACE INTO app_meta (k,v) VALUES ('upgrade_required','1')`).run();
    this._trace(`sync: BATCH_REJECTED_SCHEMA (server min ${resp.minSchemaVersion}) — queue PRESERVED, upgrade gate raised, no auto-migrate`);
  }
  _backoff(attempts) {
    const base = 2000, cap = 300000;
    const delay = Math.min(cap, base * 2 ** attempts) * (0.5 + Math.random() * 0.5);
    return new Date(Date.now() + delay).toISOString();
  }
  /** test helper: clear backoff gates so the next syncOnce sees the ops immediately */
  clearBackoff() { this.db.prepare(`UPDATE op_queue SET next_attempt_at=NULL WHERE status='PENDING'`).run(); }
}

module.exports = { Device };
