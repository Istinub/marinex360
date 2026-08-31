// =====================================================================
// MarineX360 — mobile offline execution composable scenarios
// Focuses on useOfflineExecution.ts behaviors that need Capacitor/runtime
// adapters in production, using in-memory SQLite and mocked network/files.
// =====================================================================

import { DatabaseSync } from 'node:sqlite';
import { useOfflineExecution } from './src/composables/useOfflineExecution.ts';

const AUTH_TOKEN = 'test-access-token';
const API_BASE = 'https://api.example.test/api/v1';

let pass = 0;
let fail = 0;

function check(name, cond, detail = '') {
  if (cond) {
    pass += 1;
    console.log(`  ✓ ${name}`);
  } else {
    fail += 1;
    console.log(`  ✗ ${name} ${detail}`);
  }
}

class TestDb {
  constructor() {
    this.db = new DatabaseSync(':memory:');
    this.db.exec(`
      CREATE TABLE binary_upload (
        id TEXT PRIMARY KEY,
        entity TEXT NOT NULL,
        local_path TEXT NOT NULL,
        byte_size INTEGER,
        content_type TEXT,
        s3_key TEXT,
        upload_state TEXT NOT NULL DEFAULT 'PENDING',
        attempts INTEGER NOT NULL DEFAULT 0,
        next_attempt_at TEXT,
        last_error TEXT
      );
      CREATE TABLE photo (
        id TEXT PRIMARY KEY,
        job_order_id TEXT NOT NULL,
        s3_key TEXT,
        op_id TEXT
      );
      CREATE TABLE esignature (
        id TEXT PRIMARY KEY,
        job_order_id TEXT NOT NULL,
        image_s3_key TEXT,
        op_id TEXT
      );
      CREATE TABLE op_queue (
        op_id TEXT PRIMARY KEY,
        entity TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        job_order_id TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        blocks_on_op TEXT,
        status TEXT NOT NULL DEFAULT 'PENDING',
        updated_at TEXT
      );
    `);
  }

  async select(sql, params = []) {
    return this.db.prepare(sql).all(...params);
  }

  async execute(sql, params = []) {
    this.db.prepare(sql).run(...params);
  }

  async transaction(work) {
    this.db.exec('BEGIN');
    try {
      const result = await work();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  get(sql, params = []) {
    return this.db.prepare(sql).get(...params);
  }

  run(sql, params = []) {
    this.db.prepare(sql).run(...params);
  }
}

function installRuntime(db) {
  globalThis.marinex360 = {
    db,
    auth: {
      userId: 'user-tech-001',
      accessToken: AUTH_TOKEN,
    },
    apiBase: API_BASE,
    files: {
      readBinaryFile: async () => new Blob(['abc'], { type: 'application/octet-stream' }),
    },
  };
}

function seedPhotoUpload(db, { id = 'photo-upload-1', opId = 'op-photo-1' } = {}) {
  db.run(
    `INSERT INTO binary_upload
       (id, entity, local_path, byte_size, content_type, upload_state)
     VALUES (?, 'Photo', ?, 3, 'image/jpeg', 'PENDING')`,
    [id, '/local/photos/pump.jpg'],
  );
  db.run(
    `INSERT INTO photo (id, job_order_id, s3_key, op_id)
     VALUES (?, 'jo-1', NULL, ?)`,
    [id, opId],
  );
  db.run(
    `INSERT INTO op_queue (op_id, entity, entity_id, job_order_id, payload_json, blocks_on_op, status)
     VALUES (?, 'Photo', ?, 'jo-1', ?, ?, 'PENDING')`,
    [opId, id, JSON.stringify({ id, jobOrderId: 'jo-1', s3Key: null }), id],
  );
}

function seedESignatureUpload(db, { id = 'signature-upload-1', opId = 'op-signature-1' } = {}) {
  db.run(
    `INSERT INTO binary_upload
       (id, entity, local_path, byte_size, content_type, upload_state)
     VALUES (?, 'ESignature', ?, 9, 'image/png', 'PENDING')`,
    [id, '/local/signatures/owner.png'],
  );
  db.run(
    `INSERT INTO esignature (id, job_order_id, image_s3_key, op_id)
     VALUES (?, 'jo-1', NULL, ?)`,
    [id, opId],
  );
  db.run(
    `INSERT INTO op_queue (op_id, entity, entity_id, job_order_id, payload_json, blocks_on_op, status)
     VALUES (?, 'ESignature', ?, 'jo-1', ?, ?, 'PENDING')`,
    [opId, id, JSON.stringify({ id, jobOrderId: 'jo-1', imageS3Key: null }), id],
  );
}

function jsonResponse(body, init = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

console.log('\n══════════ MarineX360 · useOfflineExecution drainBinaryUploads ══════════');

// ── Scenario 1: Photo pending upload → presign → PUT succeeds → unblocked ──
await (async () => {
  console.log('\n[1] Photo upload drain — presign + PUT success unblocks metadata op');
  const db = new TestDb();
  installRuntime(db);
  seedPhotoUpload(db);

  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if (String(url) === `${API_BASE}/uploads/presign`) {
      return jsonResponse({
        uploadUrl: 'https://s3.example.test/photo-put',
        s3Key: 'SG/jo-1/photo/photo-upload-1',
        method: 'PUT',
        headers: { 'Content-Type': 'image/jpeg' },
      });
    }
    if (String(url) === 'https://s3.example.test/photo-put') return new Response('', { status: 200 });
    return new Response('', { status: 404 });
  };

  await useOfflineExecution().drainBinaryUploads('jo-1');

  const upload = db.get(`SELECT upload_state, attempts, s3_key, next_attempt_at, last_error FROM binary_upload WHERE id='photo-upload-1'`);
  const photo = db.get(`SELECT s3_key FROM photo WHERE id='photo-upload-1'`);
  const op = db.get(`SELECT payload_json, blocks_on_op FROM op_queue WHERE op_id='op-photo-1'`);
  const presignBody = JSON.parse(calls[0].init.body);

  check('presign request hits /uploads/presign', calls[0].url === `${API_BASE}/uploads/presign`);
  check('presign request uses bearer auth', calls[0].init.headers.Authorization === `Bearer ${AUTH_TOKEN}`);
  check('presign body uses Photo/entity/job/content type/byte size', presignBody.entity === 'Photo' && presignBody.jobOrderId === 'jo-1' && presignBody.contentType === 'image/jpeg' && presignBody.byteSize === 3);
  check('PUT uses returned URL and method', calls[1].url === 'https://s3.example.test/photo-put' && calls[1].init.method === 'PUT');
  check('binary_upload → DONE', upload.upload_state === 'DONE' && upload.attempts === 0 && upload.next_attempt_at === null && upload.last_error === null);
  check('binary_upload stores returned s3_key', upload.s3_key === 'SG/jo-1/photo/photo-upload-1');
  check('photo row stores s3_key', photo.s3_key === 'SG/jo-1/photo/photo-upload-1');
  check('op_queue blocks_on_op cleared', op.blocks_on_op === null);
  check('payload patched with s3Key', JSON.parse(op.payload_json).s3Key === 'SG/jo-1/photo/photo-upload-1');
})();

// ── Scenario 2: ESignature pending upload → presign → PUT succeeds → imageS3Key patched ──
await (async () => {
  console.log('\n[2] ESignature upload drain — imageS3Key patched to match backend buildCreateData');
  const db = new TestDb();
  installRuntime(db);
  seedESignatureUpload(db);

  globalThis.fetch = async (url) => {
    if (String(url) === `${API_BASE}/uploads/presign`) {
      return jsonResponse({
        uploadUrl: 'https://s3.example.test/signature-put',
        s3Key: 'SG/jo-1/esignature/signature-upload-1',
        method: 'PUT',
        headers: { 'Content-Type': 'image/png' },
      });
    }
    if (String(url) === 'https://s3.example.test/signature-put') return new Response(null, { status: 204 });
    return new Response('', { status: 404 });
  };

  await useOfflineExecution().drainBinaryUploads('jo-1');

  const signature = db.get(`SELECT image_s3_key FROM esignature WHERE id='signature-upload-1'`);
  const op = db.get(`SELECT payload_json, blocks_on_op FROM op_queue WHERE op_id='op-signature-1'`);

  check('esignature row stores image_s3_key', signature.image_s3_key === 'SG/jo-1/esignature/signature-upload-1');
  check('op_queue blocks_on_op cleared', op.blocks_on_op === null);
  check('payload patched with imageS3Key', JSON.parse(op.payload_json).imageS3Key === 'SG/jo-1/esignature/signature-upload-1');
})();

// ── Scenario 3: PUT failure → ERROR + backoff, metadata op remains blocked ──
await (async () => {
  console.log('\n[3] Upload drain failure — ERROR state + backoff, metadata remains blocked');
  const db = new TestDb();
  installRuntime(db);
  seedPhotoUpload(db);

  globalThis.fetch = async (url) => {
    if (String(url) === `${API_BASE}/uploads/presign`) {
      return jsonResponse({
        uploadUrl: 'https://s3.example.test/photo-put-fails',
        s3Key: 'SG/jo-1/photo/photo-upload-1',
        method: 'PUT',
      });
    }
    if (String(url) === 'https://s3.example.test/photo-put-fails') return new Response('', { status: 503 });
    return new Response('', { status: 404 });
  };

  await useOfflineExecution().drainBinaryUploads('jo-1');

  const upload = db.get(`SELECT upload_state, attempts, next_attempt_at, last_error FROM binary_upload WHERE id='photo-upload-1'`);
  const op = db.get(`SELECT payload_json, blocks_on_op FROM op_queue WHERE op_id='op-photo-1'`);

  check('binary_upload → ERROR', upload.upload_state === 'ERROR');
  check('attempts incremented', upload.attempts === 1);
  check('next_attempt_at populated', typeof upload.next_attempt_at === 'string' && upload.next_attempt_at.length > 0);
  check('last_error recorded', upload.last_error === 'Binary PUT failed (503).');
  check('op_queue remains blocked', op.blocks_on_op === 'photo-upload-1');
  check('payload remains unpatched', JSON.parse(op.payload_json).s3Key === null);
})();

console.log(`\n══════════ RESULT: ${pass} passed, ${fail} failed ══════════\n`);
process.exit(fail === 0 ? 0 : 1);
