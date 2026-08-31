// =====================================================================
// MarineX360 — S0-6 SCENARIO RUNNER
// Drives the Device sync engine against the MockServer end-to-end and
// asserts the disposition table in SYNC_ENGINE_DESIGN §4.2. This is the
// oracle QA's sync-simulation harness should also assert against.
// =====================================================================

import { Device } from './Mobile_app_device.js';
import { MockServer } from './Mobile_app_mockServer.js';

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
function queueCount(device) { return device.db.prepare(`SELECT COUNT(*) n FROM op_queue`).get().n; }
async function sha256Hex(text) {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

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

// ── Scenario 10: Checklist submit CREATE → APPLIED ──
(() => {
  console.log('\n[10] Checklist submit — CREATE ChecklistInstance with results → APPLIED');
  const { server, device } = freshWorld();
  const results = [
    { itemId: 'visual-check', value: true },
    { itemId: 'pressure-reading', value: 12.4 },
    { itemId: 'notes', value: 'No leaks observed' },
  ];
  const { id, opId } = device.authorChecklistSubmit(JO_ID, 'tmpl-main-engine', results);
  const row = device.db.prepare(`SELECT * FROM checklist_instance WHERE id=?`).get(id);
  check('checklist row stores results_json', JSON.stringify(results) === row.results_json);
  device.syncOnce(makeTransport(server), AUTH_OK);
  check('ChecklistInstance CREATE → SYNCED', opStatus(device, opId) === 'SYNCED');
  check('server stored checklist results', JSON.stringify(server.rows.get(`ChecklistInstance:${id}`).results) === JSON.stringify(results));
})();

// ── Scenario 11: Photo two-phase upload → metadata unblocks → APPLIED ──
(() => {
  console.log('\n[11] Photo capture — binary upload first, then metadata op unblocks');
  const { server, device } = freshWorld();
  const { id, opId, uploadId } = device.authorPhotoCapture(JO_ID, 'DURING', '/local/photos/pump-before.jpg', null, null);
  check('metadata op is blocked before upload', device.readyOps().length === 0);
  check('binary upload row is PENDING', device.db.prepare(`SELECT upload_state FROM binary_upload WHERE id=?`).get(uploadId).upload_state === 'PENDING');
  device.syncOnce(makeTransport(server), AUTH_OK);
  check('blocked photo op remains PENDING', opStatus(device, opId) === 'PENDING');
  device.completeBinaryUpload(uploadId, 'photos/jo-1111/pump-before.jpg');
  const op = device.db.prepare(`SELECT blocks_on_op,payload_json FROM op_queue WHERE op_id=?`).get(opId);
  const photo = device.db.prepare(`SELECT s3_key FROM photo WHERE id=?`).get(id);
  check('binary upload unblocks metadata op', op.blocks_on_op === null && photo.s3_key === 'photos/jo-1111/pump-before.jpg');
  check('metadata payload carries s3Key', JSON.parse(op.payload_json).s3Key === 'photos/jo-1111/pump-before.jpg');
  device.syncOnce(makeTransport(server), AUTH_OK);
  check('Photo metadata CREATE → SYNCED', opStatus(device, opId) === 'SYNCED');
  check('server stored photo s3Key', server.rows.get(`Photo:${id}`).s3Key === 'photos/jo-1111/pump-before.jpg');
})();

// ── Scenario 12: ESignature non-owner fails locally, never queued ──
await (async () => {
  console.log('\n[12] ESignature non-owner — local UX guard throws before queueing');
  const server = new MockServer();
  const nonOwner = 'user-tech-002';
  server.seedJobOrder({ id: JO_ID, joNumber: 'SG-JO-0001', branch: 'SG', state: 'IN_PROGRESS',
    assignedTechnicianIds: [TECH, nonOwner], executionOwnerId: TECH, scopeSummary: 'Main engine survey' });
  const device = new Device(nonOwner);
  const pull = server.handleSyncAssigned({}, { valid: true, userId: nonOwner });
  device.applyPull(pull.changes, pull.cursor);
  let threw = false;
  try {
    await device.authorESignature(JO_ID, 'Client Witness', 'Chief Engineer', null, null, '/local/signatures/non-owner.png');
  } catch (e) {
    threw = e.message.includes('execution owner');
  }
  check('non-owner sign attempt throws locally', threw);
  check('no ESignature op reaches queue', queueCount(device) === 0);
  check('server received no ESignature row', ![...server.rows.keys()].some(k => k.startsWith('ESignature:')));
})();

// ── Scenario 13: ESignature owner two-phase upload → APPLIED with D-060 documentHash ──
await (async () => {
  console.log('\n[13] ESignature owner — immutable CREATE with D-060 documentHash + snapshot_json');
  const { server, device } = freshWorld();
  const checklist = device.authorChecklistSubmit(JO_ID, 'tmpl-signature-evidence', [{ itemId: 'visual-check', value: true }]);
  const photo = device.authorPhotoCapture(JO_ID, 'DURING', '/local/photos/signature-evidence.jpg', 1.31, 103.77);
  device.db.prepare(`INSERT INTO material_line
    (id,job_order_id,description,quantity,unit,unit_cost_amount_minor,unit_cost_currency,source,added_by_id,op_id,sync_state)
    VALUES ('mat-signature-evidence', ?, 'Gasket set', '1.000', 'set', 2500, 'SGD', 'FIELD', ?, NULL, 'PENDING')`)
    .run(JO_ID, TECH);
  const { id, opId, uploadId, documentHash, snapshotJson } = await device.authorESignature(
    JO_ID, 'Tariq Technician', 'Execution owner', 1.3521, 103.8198, '/local/signatures/owner.png');
  check('signature metadata waits for binary upload', !device.readyOps().some(o => o.op_id === opId));
  const localRow = device.db.prepare(`SELECT document_hash,snapshot_json FROM esignature WHERE id=?`).get(id);
  const snapshot = JSON.parse(localRow.snapshot_json);
  check('local document_hash is a real SHA-256 hex digest', /^[a-f0-9]{64}$/.test(localRow.document_hash));
  check('snapshot_json is stored exactly as hashed', localRow.snapshot_json === snapshotJson && localRow.document_hash === documentHash);
  check('document_hash matches snapshot_json re-hash', await sha256Hex(localRow.snapshot_json) === localRow.document_hash);
  check('snapshot includes actual checklist ids', JSON.stringify(snapshot.checklistInstanceIds) === JSON.stringify([checklist.id]));
  check('snapshot includes actual photo opIds', JSON.stringify(snapshot.photoOpIds) === JSON.stringify([photo.opId]));
  check('snapshot includes actual material ids', JSON.stringify(snapshot.materialLineIds) === JSON.stringify(['mat-signature-evidence']));
  device.completeBinaryUpload(uploadId, 'signatures/jo-1111/owner.png');
  device.syncOnce(makeTransport(server), AUTH_OK);
  const serverRow = server.rows.get(`ESignature:${id}`);
  check('ESignature CREATE → SYNCED', opStatus(device, opId) === 'SYNCED');
  check('server stored imageS3Key', serverRow.imageS3Key === 'signatures/jo-1111/owner.png');
  check('server stored documentHash', serverRow.documentHash === documentHash);
})();

console.log(`\n══════════ RESULT: ${pass} passed, ${fail} failed ══════════\n`);
process.exit(fail === 0 ? 0 : 1);
