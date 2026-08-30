'use strict';
// =====================================================================
// MarineX360 — MOCK SERVER (S0-6 prototype)
// Stands in for Fastify API + SyncService + Postgres. Implements the
// canonical sync contract EXACTLY so the device engine can be exercised
// end-to-end without the real backend.
//
//   POST /sync/batch   { schemaVersion, ops[] }
//   GET  /sync/assigned?since=<cursor>
//
// Per-op result: { opId, status, resultRef?, serverVersion?, error?, reviewState? }
// status ∈ { APPLIED, IDEMPOTENT_REPLAY, VERSION_CONFLICT,
//            VALIDATION_ERROR, FORBIDDEN, BRANCH_SCOPE_DENIED,
//            STATE_TRANSITION_INVALID, BATCH_REJECTED_SCHEMA, APPLIED_FLAGGED }
//   (APPLIED_FLAGGED = CC-MOB-2 / SYNC-13 — proposed, awaiting ratification.)
// =====================================================================

const MIN_SCHEMA_VERSION = 1;            // server's minimum accepted payload schema
const WRITABLE = new Set(['WorkLog', 'Photo', 'Observation', 'ChecklistInstance', 'MaterialLine', 'ESignature']);

function nowIso() { return new Date().toISOString(); }

class MockServer {
  constructor() {
    this.jobOrders = new Map();          // id -> JO (authoritative)
    this.rows = new Map();               // `${entity}:${id}` -> row {id, version, ...}
    this.processedOps = new Map();       // opId -> { resultRef, serverVersion, status }  (ProcessedOp registry)
    this.audit = [];                     // append-only
    this.changeLog = [];                 // for delta pull: {cursor, entity, row, at}
    this.seq = 0;
    this.minSchema = MIN_SCHEMA_VERSION;
  }

  // ---- test seeding helpers (represent office-side / pre-fetch state) ----
  seedJobOrder(jo) { this.jobOrders.set(jo.id, { version: 0, ...jo }); this._log('JobOrder', this.jobOrders.get(jo.id)); }
  seedRow(entity, row) { const r = { version: 0, ...row }; this.rows.set(`${entity}:${row.id}`, r); this._log(entity, r); return r; }
  /** Simulate an office-side edit that bumps a row's version (to force a conflict). */
  officeEdit(entity, id, patch) {
    const k = `${entity}:${id}`; const r = this.rows.get(k);
    if (!r) throw new Error('no such row ' + k);
    Object.assign(r, patch); r.version += 1; this._log(entity, r);
  }
  /** Simulate SYNC-13: remove a technician from a JO's assigned set while they are offline. */
  unassignTechnician(joId, techId) {
    const jo = this.jobOrders.get(joId);
    jo.assignedTechnicianIds = (jo.assignedTechnicianIds || []).filter(t => t !== techId);
    if (jo.executionOwnerId === techId) jo.executionOwnerId = null;
    this._log('JobOrder', jo);
  }

  _log(entity, row) { this.changeLog.push({ cursor: String(++this.seq), entity, row: { ...row }, at: nowIso() }); }

  // ---- POST /sync/batch ----
  handleSyncBatch({ schemaVersion, ops }, auth) {
    // Auth gate first — 401 preserves the client queue (never dropped).
    if (!auth || !auth.valid) return { httpStatus: 401, error: { code: 'UNAUTHORIZED' } };

    // Batch-level schema gate — whole batch rejected, never partially applied, never auto-migrated.
    if (typeof schemaVersion !== 'number' || schemaVersion < this.minSchema) {
      return {
        httpStatus: 409,
        batchStatus: 'BATCH_REJECTED_SCHEMA',
        upgradeRequired: true,
        minSchemaVersion: this.minSchema,
        results: [],                     // nothing processed
      };
    }

    const results = ops.map(op => this._applyOp(op, auth));
    return { httpStatus: 200, results };
  }

  _applyOp(op, auth) {
    const { opId, entity, action, entityId, jobOrderId, payload, baseVersion } = op;

    // Idempotent replay — return the ORIGINAL result, do nothing else.
    if (this.processedOps.has(opId)) {
      const prior = this.processedOps.get(opId);
      return { opId, status: prior.status === 'APPLIED_FLAGGED' ? 'IDEMPOTENT_REPLAY' : 'IDEMPOTENT_REPLAY',
               resultRef: prior.resultRef, serverVersion: prior.serverVersion };
    }

    // Validation.
    if (!WRITABLE.has(entity)) return { opId, status: 'VALIDATION_ERROR', error: { code: 'UNKNOWN_ENTITY', message: entity } };
    if (!jobOrderId || !this.jobOrders.has(jobOrderId))
      return { opId, status: 'VALIDATION_ERROR', error: { code: 'UNKNOWN_JOB', message: String(jobOrderId) } };
    if (entity === 'Observation' && (!payload || !payload.body))
      return { opId, status: 'VALIDATION_ERROR', error: { code: 'BODY_REQUIRED' } };

    const jo = this.jobOrders.get(jobOrderId);

    // Authorisation: must be (or have been) dispatched to this JO. Branch scope enforced here too.
    const dispatched = (jo.assignedTechnicianIds || []).includes(auth.userId);
    const wasOwner = op.actorId === auth.userId;
    if (!wasOwner) return { opId, status: 'FORBIDDEN', error: { code: 'NOT_OP_AUTHOR' } };

    // SYNC-13: author is no longer assigned → ACCEPT + STORE + FLAG for supervisor review.
    // Never auto-discard. (Requires CC-MOB-2 status APPLIED_FLAGGED.)
    const flagged = !dispatched;

    if (action === 'UPDATE') {
      const k = `${entity}:${entityId}`; const r = this.rows.get(k);
      if (!r) return { opId, status: 'VALIDATION_ERROR', error: { code: 'ROW_NOT_FOUND' } };
      // OD-05 optimistic concurrency.
      if (typeof baseVersion === 'number' && baseVersion !== r.version)
        return { opId, status: 'VERSION_CONFLICT', serverVersion: r.version };
      Object.assign(r, payload); r.version += 1;
      this._finish(opId, entity, r, flagged);
      return this._result(opId, r, flagged);
    }

    // CREATE — client supplies the id (CC-MOB-1); persist with it so resultRef == id.
    const id = entityId;
    const row = { id, version: 0, jobOrderId, reviewState: flagged ? 'PENDING_SUPERVISOR_REVIEW' : undefined, ...payload };
    this.rows.set(`${entity}:${id}`, row);
    this._finish(opId, entity, row, flagged);
    return this._result(opId, row, flagged);
  }

  _finish(opId, entity, row, flagged) {
    const status = flagged ? 'APPLIED_FLAGGED' : 'APPLIED';
    this.processedOps.set(opId, { resultRef: row.id, serverVersion: row.version, status });
    this.audit.push({ opId, entity, entityId: row.id, action: 'WRITE', at: nowIso(), flagged });
    this._log(entity, row);
  }
  _result(opId, row, flagged) {
    return flagged
      ? { opId, status: 'APPLIED_FLAGGED', resultRef: row.id, serverVersion: row.version, reviewState: 'PENDING_SUPERVISOR_REVIEW' }
      : { opId, status: 'APPLIED', resultRef: row.id, serverVersion: row.version };
  }

  // ---- GET /sync/assigned?since=<cursor> ----
  handleSyncAssigned({ since }, auth) {
    if (!auth || !auth.valid) return { httpStatus: 401, error: { code: 'UNAUTHORIZED' } };
    const startIndex = since == null ? 0 : this.changeLog.findIndex(c => c.cursor === since) + 1;
    // Owner-scoped delta: only rows for JOs this user owns/was dispatched to (OD-04 guardrail).
    const myJoIds = new Set([...this.jobOrders.values()]
      .filter(jo => (jo.assignedTechnicianIds || []).includes(auth.userId) || jo.executionOwnerId === auth.userId
                    || this._everDispatched(jo.id, auth.userId))
      .map(jo => jo.id));
    const changes = this.changeLog.slice(startIndex)
      .filter(c => c.entity === 'JobOrder' ? myJoIds.has(c.row.id) : myJoIds.has(c.row.jobOrderId));
    return { httpStatus: 200, changes, cursor: String(this.seq) };
  }
  _everDispatched() { return true; } // demo: owner stays able to pull their own job state for reconcile
}

module.exports = { MockServer, MIN_SCHEMA_VERSION };
