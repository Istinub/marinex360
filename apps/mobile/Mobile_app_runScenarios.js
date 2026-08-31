'use strict';
// =====================================================================
// MarineX360 — S0-6 SCENARIO RUNNER
// Drives the Device sync engine against the MockServer end-to-end and
// asserts the disposition table in SYNC_ENGINE_DESIGN §4.2. This is the
// oracle QA's sync-simulation harness should also assert against.
// =====================================================================

const { MockServer } = require('./Mobile_app_mockServer');
const { Device } = require('./Mobile_app_device');

// Transport shim — lets a scenario inject a network failure or a 401 on the
// NEXT call only, otherwise forwards to the in-process server (transport-agnostic).
function makeTransport(server, faults = {}) {
  return {
    batch(req, auth) {
      if (faults.networkOnce) { faults.networkOnce = false; const e = new Error('ECONNRESET'); e.code = 'ECONNRESET'; throw e; }
      if (faults.authFailOnce) { faults.authFailOnce = false; return { httpStatus: 401, error: { code: 'UNAUTHORIZED' } }; }
      return server.handleSyncBatch(req, auth);
    },
    assigned(q, auth) { return server.handleSyncAssigned(q, auth); },
  };
}
function makePerOpStatusTransport(server, status) {
  return {
    batch(req) {
      return { httpStatus: 200, results: req.ops.map(op => ({ opId: op.opId, status, error: { code: status, message: status } })) };
    },
    assigned(q, auth) { return server.handleSyncAssigned(q, auth); },
  };
}

const TECH = 'user-tech-001';
const JO_ID = 'jo-1111';
const AUTH_OK = { valid: true, userId: TECH };

let pass = 0, fail = 0;
function check(name, cond, detail = '') {
  (cond ? (pass++, console.log(`  ✓ ${name}`)) : (fail++, console.log(`  ✗ ${name}  ${detail}`)));
}
function freshWorld() {
  const server = new MockServer();
  server.seedJobOrder({ id: JO_ID, joNumber: 'SG-JO-0001', branch: 'SG', state: 'IN_PROGRESS',
    assignedTechnicianIds: [TECH], executionOwnerId: TECH, scopeSummary: 'Main engine survey' });
  const device = new Device(TECH);
  // pre-fetch the JO into the device read cache
  const pull = server.handleSyncAssigned({}, AUTH_OK);
  device.applyPull(pull.changes, pull.cursor);
  return { server, device };
}
function opStatus(device, opId) { return device.db.prepare(`SELECT status FROM op_queue WHERE op_id=?`).get(opId).status; }

console.log('\n══════════ MarineX360 · S0-6 offline-sync prototype ══════════');

// ── Scenario 1: APPLIED (clean offline write → reconnect → applied) ──
(() => {
  console.log('\n[1] APPLIED — offline write, reconnect, push');
  const { server, device } = freshWorld();
  const { opId } = device.authorObservation(JO_ID, 'Cylinder head torque verified');
  check('queued as PENDING before sync', opStatus(device, opId) === 'PENDING');
  device.syncOnce(makeTransport(server), AUTH_OK);
  check('op → SYNCED', opStatus(device, opId) === 'SYNCED');
  check('server stored the row', server.rows.has(`Observation:${device.db.prepare(`SELECT result_ref FROM op_queue WHERE op_id=?`).get(opId).result_ref}`));
})();

// ── Scenario 2: IDEMPOTENT_REPLAY (same opId resent) ──
(() => {
  console.log('\n[2] IDEMPOTENT_REPLAY — resend the same op (e.g. ack lost)');
  const { server, device } = freshWorld();
  const { opId } = device.authorObservation(JO_ID, 'Bearing clearance within spec');
  device.syncOnce(makeTransport(server), AUTH_OK);              // first send → APPLIED
  // force a resend by re-queuing the SAME opId
  device.db.prepare(`UPDATE op_queue SET status='PENDING' WHERE op_id=?`).run(opId);
  const before = server.rows.size;
  device.syncOnce(makeTransport(server), AUTH_OK);              // resend → IDEMPOTENT_REPLAY
  const replay = device.events.filter(e => e.opId === opId).pop();
  check('second send → IDEMPOTENT_REPLAY', replay.status === 'IDEMPOTENT_REPLAY');
  check('no duplicate row created', server.rows.size === before);
  check('UI shows Synced (not error)', opStatus(device, opId) === 'SYNCED');
})();

// ── Scenario 3: VERSION_CONFLICT → reload+reapply → APPLIED ──
(() => {
  console.log('\n[3] VERSION_CONFLICT — office edits row mid-offline (OD-05 reload+reapply)');
  const { server, device } = freshWorld();
  const wl = server.seedRow('WorkLog', { id: 'wl-1', jobOrderId: JO_ID, technicianId: TECH, startedAt: '2026-06-20T01:00:00Z' });
  device.seedLocalWorklog({ id: 'wl-1', jobOrderId: JO_ID, technicianId: TECH, startedAt: '2026-06-20T01:00:00Z', version: 0 });
  // technician edits offline against baseVersion 0
  const { opId } = device.authorWorklogUpdate('wl-1', JO_ID, { ended_at: '2026-06-20T05:00:00Z' }, 0);
  // meanwhile the office edits the same row → server version becomes 1
  server.officeEdit('WorkLog', 'wl-1', { note: 'office correction' });
  device.syncOnce(makeTransport(server), AUTH_OK);             // → VERSION_CONFLICT
  check('first push → CONFLICT', opStatus(device, opId) === 'CONFLICT');
  device.reconcileConflicts();                                 // re-stage on fresh server version
  check('after reconcile → PENDING', opStatus(device, opId) === 'PENDING');
  device.clearBackoff();
  device.syncOnce(makeTransport(server), AUTH_OK);             // re-push → APPLIED
  check('re-push → SYNCED', opStatus(device, opId) === 'SYNCED');
  check('technician edit preserved on server', server.rows.get('WorkLog:wl-1').ended_at === '2026-06-20T05:00:00Z');
})();

// ── Scenario 4: VALIDATION_ERROR (not auto-retried) ──
(() => {
  console.log('\n[4] VALIDATION_ERROR — malformed op is surfaced, not looped');
  const { server, device } = freshWorld();
  // author an observation then corrupt its payload to drop the required body
  const { opId } = device.authorObservation(JO_ID, 'temp');
  const p = JSON.parse(device.db.prepare(`SELECT payload_json FROM op_queue WHERE op_id=?`).get(opId).payload_json);
  delete p.body;
  device.db.prepare(`UPDATE op_queue SET payload_json=? WHERE op_id=?`).run(JSON.stringify(p), opId);
  device.syncOnce(makeTransport(server), AUTH_OK);
  check('op → ERROR', opStatus(device, opId) === 'ERROR');
  const attemptsBefore = device.db.prepare(`SELECT attempts FROM op_queue WHERE op_id=?`).get(opId).attempts;
  device.clearBackoff();
  device.syncOnce(makeTransport(server), AUTH_OK);             // must NOT pick it up again
  const attemptsAfter = device.db.prepare(`SELECT attempts FROM op_queue WHERE op_id=?`).get(opId).attempts;
  check('ERROR op is not auto-retried', attemptsBefore === attemptsAfter, `(${attemptsBefore}→${attemptsAfter})`);
})();

// ── Scenario 4b: BRANCH_SCOPE_DENIED (not auto-retried) ──
(() => {
  console.log('\n[4b] BRANCH_SCOPE_DENIED — branch-scoped denial is surfaced, not looped');
  const { server, device } = freshWorld();
  const { opId } = device.authorObservation(JO_ID, 'Wrong branch payload');
  device.syncOnce(makePerOpStatusTransport(server, 'BRANCH_SCOPE_DENIED'), AUTH_OK);
  check('op → ERROR', opStatus(device, opId) === 'ERROR');
  check('trace identifies BRANCH_SCOPE_DENIED',
    device.log.some(line => line.includes('BRANCH_SCOPE_DENIED') && line.includes('Branch scope denied')));
})();

// ── Scenario 4c: STATE_TRANSITION_INVALID (not auto-retried) ──
(() => {
  console.log('\n[4c] STATE_TRANSITION_INVALID — illegal lifecycle move is surfaced, not looped');
  const { server, device } = freshWorld();
  const { opId } = device.authorObservation(JO_ID, 'Illegal transition payload');
  device.syncOnce(makePerOpStatusTransport(server, 'STATE_TRANSITION_INVALID'), AUTH_OK);
  check('op → ERROR', opStatus(device, opId) === 'ERROR');
  check('trace identifies STATE_TRANSITION_INVALID',
    device.log.some(line => line.includes('STATE_TRANSITION_INVALID') && line.includes('Invalid state transition')));
})();

// ── Scenario 4d: UNAUTHORIZED (per-op; not auto-retried) ──
(() => {
  console.log('\n[4d] UNAUTHORIZED — per-op auth denial is surfaced, not looped');
  const { server, device } = freshWorld();
  const { opId } = device.authorObservation(JO_ID, 'Unauthorized payload');
  device.syncOnce(makePerOpStatusTransport(server, 'UNAUTHORIZED'), AUTH_OK);
  check('op → ERROR', opStatus(device, opId) === 'ERROR');
  check('trace identifies UNAUTHORIZED',
    device.log.some(line => line.includes('UNAUTHORIZED') && line.includes('Unauthorized')));
})();

// ── Scenario 4e: NOT_FOUND (not auto-retried) ──
(() => {
  console.log('\n[4e] NOT_FOUND — missing target is surfaced, not looped');
  const { server, device } = freshWorld();
  const { opId } = device.authorObservation(JO_ID, 'Missing target payload');
  device.syncOnce(makePerOpStatusTransport(server, 'NOT_FOUND'), AUTH_OK);
  check('op → ERROR', opStatus(device, opId) === 'ERROR');
  check('trace identifies NOT_FOUND',
    device.log.some(line => line.includes('NOT_FOUND') && line.includes('Not found')));
})();

// ── Scenario 5: BATCH_REJECTED_SCHEMA (queue preserved, no migrate) ──
(() => {
  console.log('\n[5] BATCH_REJECTED_SCHEMA — stale app schema, whole batch rejected');
  const { server, device } = freshWorld();
  server.minSchema = 2;                                         // server now requires v2; device is v1
  const { opId } = device.authorObservation(JO_ID, 'Coupling alignment recorded');
  const res = device.syncOnce(makeTransport(server), AUTH_OK);
  check('batch rejected → upgradeRequired', res.upgradeRequired === true);
  check('op stays PENDING (preserved)', opStatus(device, opId) === 'PENDING');
  check('upgrade gate raised', device.db.prepare(`SELECT v FROM app_meta WHERE k='upgrade_required'`).get()?.v === '1');
  check('row NOT applied on server', server.rows.size === 0);
})();

// ── Scenario 6: 401 mid-sync (queue never dropped) ──
(() => {
  console.log('\n[6] 401 UNAUTHORIZED mid-offline — re-auth, retry same opIds');
  const { server, device } = freshWorld();
  const { opId } = device.authorObservation(JO_ID, 'Lube oil sample taken');
  const faults = { authFailOnce: true };
  const res1 = device.syncOnce(makeTransport(server, faults), AUTH_OK);
  check('first attempt → authRequired', res1.authRequired === true);
  check('op PRESERVED as PENDING', opStatus(device, opId) === 'PENDING');
  // simulate biometric/PIN re-auth → refresh rotation succeeds, retry SAME opId
  device.syncOnce(makeTransport(server), AUTH_OK);
  check('after re-auth → SYNCED (same opId)', opStatus(device, opId) === 'SYNCED');
})();

// ── Scenario 7: SYNC-13 (unassigned-while-offline → APPLIED_FLAGGED, never discarded) ──
(() => {
  console.log('\n[7] SYNC-13 — technician unassigned while offline; ops accepted + flagged');
  const { server, device } = freshWorld();
  const { opId } = device.authorObservation(JO_ID, 'Final visual inspection complete');
  server.unassignTechnician(JO_ID, TECH);                      // office removes them while at sea
  device.syncOnce(makeTransport(server), AUTH_OK);
  const ev = device.events.filter(e => e.opId === opId).pop();
  check('op → APPLIED_FLAGGED (CC-MOB-2)', ev.status === 'APPLIED_FLAGGED');
  check('queue row FLAGGED (not ERROR, not discarded)', opStatus(device, opId) === 'FLAGGED');
  check('server STORED the row', [...server.rows.keys()].some(k => k.startsWith('Observation:')));
  check('server flagged for supervisor review',
    [...server.rows.values()].some(r => r.reviewState === 'PENDING_SUPERVISOR_REVIEW'));
})();

// ── Scenario 8: NETWORK failure then recovery (idempotent-safe retry) ──
(() => {
  console.log('\n[8] NETWORK failure then recovery — backoff, no duplicate');
  const { server, device } = freshWorld();
  const { opId } = device.authorObservation(JO_ID, 'Tank pressure test logged');
  const faults = { networkOnce: true };
  device.syncOnce(makeTransport(server, faults), AUTH_OK);     // throws → re-queued under backoff
  check('after network fail → PENDING (preserved)', opStatus(device, opId) === 'PENDING');
  device.clearBackoff();
  device.syncOnce(makeTransport(server), AUTH_OK);             // recovers
  check('after recovery → SYNCED', opStatus(device, opId) === 'SYNCED');
  check('exactly one row on server', [...server.rows.keys()].filter(k => k.startsWith('Observation:')).length === 1);
})();

// ── Scenario 9: D-004 — labourRate snapshotted at authoring, immutable after office edit ──
(() => {
  console.log('\n[9] D-004 — WorkLog snapshots labourRate offline; later office change does not retro-alter it');
  const { server, device } = freshWorld(); // JO seeded without an explicit rate → jo_cache defaults 9000 SGD (90.00/hr)
  const { id, opId } = device.authorWorklogStart(JO_ID);
  const wl = device.db.prepare(`SELECT labour_rate_amount_minor, labour_rate_currency FROM worklog WHERE id=?`).get(id);
  check('WorkLog snapshotted default rate 9000 SGD', wl.labour_rate_amount_minor === 9000 && wl.labour_rate_currency === 'SGD');
  device.syncOnce(makeTransport(server), AUTH_OK);
  check('WorkLog CREATE → SYNCED', opStatus(device, opId) === 'SYNCED');
  // Office overrides the JO's rate AFTER this WorkLog was authored/synced.
  server.jobOrders.get(JO_ID).labourRateAmountMinor = 11000; server.jobOrders.get(JO_ID).labourRateCurrency = 'SGD';
  server._log('JobOrder', server.jobOrders.get(JO_ID));
  const pull = server.handleSyncAssigned(device.assignedPullQuery(), AUTH_OK);
  device.applyPull(pull.changes, pull.cursor);
  const wlAfter = device.db.prepare(`SELECT labour_rate_amount_minor FROM worklog WHERE id=?`).get(id);
  check('already-authored WorkLog rate NOT retro-altered', wlAfter.labour_rate_amount_minor === 9000);
  const joCache = device.db.prepare(`SELECT labour_rate_amount_minor FROM jo_cache WHERE id=?`).get(JO_ID);
  check('jo_cache reflects new rate for the NEXT worklog', joCache.labour_rate_amount_minor === 11000);
})();

console.log(`\n══════════ RESULT: ${pass} passed, ${fail} failed ══════════\n`);
process.exit(fail === 0 ? 0 : 1);
