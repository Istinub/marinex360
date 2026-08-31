import { Device as CapacitorDevice } from '@capacitor/device';
import { Filesystem } from '@capacitor/filesystem';

export type ChecklistItemType = 'bool' | 'text' | 'number' | 'select' | 'photo';
export type PhotoPhase = 'BEFORE' | 'DURING' | 'AFTER';

export interface ChecklistItemDef {
  id: string;
  label: string;
  type: ChecklistItemType;
  required: boolean;
  options?: string[];
  unit?: string;
}

export interface ChecklistItemResult {
  itemId: string;
  value: boolean | string | number | null;
  photoOpId?: string;
  na?: boolean;
}

export interface QueuedOfflineCreate {
  id: string;
  opId: string;
  uploadId?: string;
  documentHash?: string;
  snapshotJson?: string;
}

type BinaryUploadEntity = 'Photo' | 'ESignature';

interface AppMetaRow {
  v: string;
}

interface JoOwnerRow {
  id: string;
  execution_owner_id: string | null;
}

interface BinaryUploadRow {
  id: string;
  entity: string;
  local_path: string;
  byte_size: number | null;
  content_type: string | null;
  upload_state: string;
  attempts: number;
  next_attempt_at: string | null;
  last_error: string | null;
}

interface EntityJobOrderRow {
  job_order_id: string;
}

interface OpPayloadRow {
  op_id: string;
  payload_json: string;
}

interface PresignResponse {
  uploadUrl: string;
  s3Key: string;
  method?: string;
  headers?: Record<string, string> | null;
}

export interface MobileSqlAdapter {
  select<T>(sql: string, params?: unknown[]): Promise<T[]>;
  execute(sql: string, params?: unknown[]): Promise<void>;
  transaction?<T>(work: () => Promise<T>): Promise<T>;
}

interface MobileRuntime {
  marinex360?: {
    db?: MobileSqlAdapter;
    auth?: {
      userId?: string | null;
      userName?: string | null;
      name?: string | null;
      displayName?: string | null;
      accessToken?: string | null;
    };
    apiBase?: string | null;
    files?: {
      readBinaryFile?(localPath: string): Promise<BodyInit>;
    };
  };
}

function mobileRuntime(): MobileRuntime {
  return globalThis as typeof globalThis & MobileRuntime;
}

function nowIso(): string {
  return new Date().toISOString();
}

export function apiBase(): string {
  const viteEnv = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;
  return (mobileRuntime().marinex360?.apiBase ?? viteEnv?.VITE_API_BASE ?? '/api/v1').replace(/\/$/, '');
}

export function authHeaders(): HeadersInit {
  const accessToken = mobileRuntime().marinex360?.auth?.accessToken;
  return accessToken ? { Authorization: `Bearer ${accessToken}` } : {};
}

function createUuid(): string {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  if (!globalThis.crypto?.getRandomValues) throw new Error('Secure UUID generation is not available.');

  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  return [...bytes].map((byte, index) => {
    const value = byte.toString(16).padStart(2, '0');
    return [4, 6, 8, 10].includes(index) ? `-${value}` : value;
  }).join('');
}

function sortedStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item) => sortedStringify(item)).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const entries = Object.keys(record)
      .sort()
      .filter((key) => record[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${sortedStringify(record[key])}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value);
}

async function sha256Hex(text: string): Promise<string> {
  if (!globalThis.crypto?.subtle) throw new Error('Web Crypto SHA-256 is not available.');
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function backoff(attempts: number): string {
  const base = 2000;
  const cap = 300000;
  const delay = Math.min(cap, base * 2 ** attempts) * (0.5 + Math.random() * 0.5);
  return new Date(Date.now() + delay).toISOString();
}

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return 'Binary upload failed.';
}

function binaryEntity(entity: string): BinaryUploadEntity {
  if (entity === 'Photo' || entity === 'ESignature') return entity;
  throw new Error(`Unsupported binary upload entity: ${entity}`);
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = globalThis.atob
    ? globalThis.atob(base64)
    : Buffer.from(base64, 'base64').toString('binary');
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

async function localFileBody(localPath: string): Promise<BodyInit> {
  const runtimeReader = mobileRuntime().marinex360?.files?.readBinaryFile;
  if (runtimeReader) return runtimeReader(localPath);

  const result = await Filesystem.readFile({ path: localPath });
  const data = result.data;

  if (data instanceof Blob) return data;
  if (typeof data !== 'string') throw new Error('Unsupported local file data.');
  if (data.startsWith('data:')) return (await fetch(data)).blob();
  const bytes = base64ToBytes(data);
  return new Blob([bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer]);
}

function requireDb(): MobileSqlAdapter {
  const db = mobileRuntime().marinex360?.db;
  if (!db) throw new Error('Offline queue is not available on this device.');
  return db;
}

function requireCurrentUserId(): string {
  const userId = mobileRuntime().marinex360?.auth?.userId;
  if (!userId) throw new Error('Current user is not available.');
  return userId;
}

export function currentUserDisplayName(): string {
  const auth = mobileRuntime().marinex360?.auth;
  return auth?.userName ?? auth?.displayName ?? auth?.name ?? auth?.userId ?? '';
}

async function withTransaction<T>(db: MobileSqlAdapter, work: () => Promise<T>): Promise<T> {
  if (db.transaction) return db.transaction(work);

  await db.execute('BEGIN');
  try {
    const result = await work();
    await db.execute('COMMIT');
    return result;
  } catch (error) {
    await db.execute('ROLLBACK');
    throw error;
  }
}

async function schemaVersion(db: MobileSqlAdapter): Promise<number> {
  const rows = await db.select<AppMetaRow>("SELECT v FROM app_meta WHERE k='schema_version'");
  const version = Number(rows[0]?.v);
  if (!Number.isInteger(version)) throw new Error('Offline schema version is not available.');
  return version;
}

async function prefetchedJobOrder(db: MobileSqlAdapter, jobOrderId: string): Promise<JoOwnerRow> {
  const rows = await db.select<JoOwnerRow>('SELECT id, execution_owner_id FROM jo_cache WHERE id=?', [jobOrderId]);
  const row = rows[0];
  if (!row) throw new Error('Job order is not available offline.');
  return row;
}

async function sortedColumnValues(db: MobileSqlAdapter, sql: string, params: unknown[], column: string): Promise<string[]> {
  const rows = await db.select<Record<string, string | null>>(sql, params);
  return rows.map((row) => row[column]).filter((value): value is string => value != null).sort();
}

async function signatureSnapshot(
  db: MobileSqlAdapter,
  jobOrderId: string,
  signerName: string,
  signerRole: string,
  signedAt: string,
): Promise<Record<string, unknown>> {
  const checklistInstanceIds = await sortedColumnValues(
    db,
    'SELECT id FROM checklist_instance WHERE job_order_id=?',
    [jobOrderId],
    'id',
  );
  const photoOpIds = await sortedColumnValues(
    db,
    'SELECT op_id FROM photo WHERE job_order_id=? AND op_id IS NOT NULL',
    [jobOrderId],
    'op_id',
  );
  const materialLineIds = await sortedColumnValues(
    db,
    'SELECT id FROM material_line WHERE job_order_id=?',
    [jobOrderId],
    'id',
  );

  return { jobOrderId, checklistInstanceIds, photoOpIds, materialLineIds, signerName, signerRole, signedAt };
}

async function pendingUploads(db: MobileSqlAdapter): Promise<BinaryUploadRow[]> {
  return db.select<BinaryUploadRow>(
    `SELECT id, entity, local_path, byte_size, content_type, upload_state, attempts, next_attempt_at, last_error
     FROM binary_upload
     WHERE upload_state='PENDING'
       AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
     ORDER BY rowid ASC`,
    [nowIso()],
  );
}

async function uploadJobOrderId(db: MobileSqlAdapter, upload: BinaryUploadRow): Promise<string> {
  const entity = binaryEntity(upload.entity);
  const table = entity === 'Photo' ? 'photo' : 'esignature';
  const rows = await db.select<EntityJobOrderRow>(`SELECT job_order_id FROM ${table} WHERE id=?`, [upload.id]);
  const jobOrderId = rows[0]?.job_order_id;
  if (!jobOrderId) throw new Error(`Missing ${entity} metadata row for binary upload ${upload.id}.`);
  return jobOrderId;
}

async function presignUpload(upload: BinaryUploadRow, jobOrderId: string, entity: BinaryUploadEntity): Promise<PresignResponse> {
  if (!upload.content_type) throw new Error('Binary upload content_type is required.');

  const response = await fetch(`${apiBase()}/uploads/presign`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...authHeaders(),
    },
    body: JSON.stringify({
      entity,
      jobOrderId,
      contentType: upload.content_type,
      byteSize: upload.byte_size ?? undefined,
    }),
  });

  if (!response.ok) throw new Error(`Presign failed (${response.status}).`);

  const presign = await response.json() as PresignResponse;
  if (!presign.uploadUrl || !presign.s3Key) throw new Error('Presign response missing uploadUrl or s3Key.');
  return presign;
}

async function putUploadBytes(presign: PresignResponse, body: BodyInit): Promise<void> {
  const response = await fetch(presign.uploadUrl, {
    method: presign.method ?? 'PUT',
    headers: presign.headers ?? {},
    body,
  });

  if (!response.ok) throw new Error(`Binary PUT failed (${response.status}).`);
}

async function completeUpload(db: MobileSqlAdapter, upload: BinaryUploadRow, entity: BinaryUploadEntity, s3Key: string): Promise<void> {
  const field = entity === 'Photo' ? 's3Key' : 'imageS3Key';
  const entityTable = entity === 'Photo' ? 'photo' : 'esignature';
  const entityColumn = entity === 'Photo' ? 's3_key' : 'image_s3_key';
  const rows = await db.select<OpPayloadRow>(
    `SELECT op_id, payload_json
     FROM op_queue
     WHERE entity=? AND entity_id=? AND blocks_on_op=?`,
    [entity, upload.id, upload.id],
  );
  const op = rows[0];
  if (!op) throw new Error(`Missing blocked metadata op for binary upload ${upload.id}.`);

  const payload = JSON.parse(op.payload_json) as Record<string, unknown>;
  payload[field] = s3Key;

  await withTransaction(db, async () => {
    await db.execute(
      `UPDATE binary_upload
       SET upload_state='DONE', s3_key=?, next_attempt_at=NULL, last_error=NULL
       WHERE id=?`,
      [s3Key, upload.id],
    );
    await db.execute(`UPDATE ${entityTable} SET ${entityColumn}=? WHERE id=?`, [s3Key, upload.id]);
    await db.execute(
      `UPDATE op_queue
       SET payload_json=?, blocks_on_op=NULL, updated_at=?
       WHERE op_id=?`,
      [JSON.stringify(payload), nowIso(), op.op_id],
    );
  });
}

async function failUpload(db: MobileSqlAdapter, upload: BinaryUploadRow, error: unknown): Promise<void> {
  await db.execute(
    `UPDATE binary_upload
     SET upload_state='ERROR', attempts=attempts+1, next_attempt_at=?, last_error=?
     WHERE id=?`,
    [backoff(upload.attempts), errorText(error), upload.id],
  );
}

async function currentDeviceId(): Promise<string | null> {
  try {
    const id = await CapacitorDevice.getId();
    return id.identifier ?? null;
  } catch {
    return null;
  }
}

async function enqueueCreate(
  db: MobileSqlAdapter,
  input: {
    opId: string;
    entity: string;
    entityId: string;
    jobOrderId: string;
    payload: Record<string, unknown>;
    clientTime: string;
    blocksOnOp?: string | null;
  },
): Promise<void> {
  await db.execute(
    `INSERT INTO op_queue
      (op_id, entity, action, entity_id, job_order_id, payload_json, base_version,
       schema_version, client_time, status, blocks_on_op, created_at, updated_at)
     VALUES (?, ?, 'CREATE', ?, ?, ?, NULL, ?, ?, 'PENDING', ?, ?, ?)`,
    [
      input.opId,
      input.entity,
      input.entityId,
      input.jobOrderId,
      JSON.stringify(input.payload),
      await schemaVersion(db),
      input.clientTime,
      input.blocksOnOp ?? null,
      input.clientTime,
      input.clientTime,
    ],
  );
}

export function useOfflineExecution() {
  async function drainBinaryUploads(jobOrderId?: string): Promise<void> {
    const db = requireDb();
    const uploads = await pendingUploads(db);

    for (const upload of uploads) {
      try {
        const entity = binaryEntity(upload.entity);
        const ownerJobOrderId = await uploadJobOrderId(db, upload);
        if (jobOrderId && ownerJobOrderId !== jobOrderId) continue;

        await db.execute(
          `UPDATE binary_upload
           SET upload_state='UPLOADING', last_error=NULL
           WHERE id=? AND upload_state='PENDING'`,
          [upload.id],
        );

        const presign = await presignUpload(upload, ownerJobOrderId, entity);
        await putUploadBytes(presign, await localFileBody(upload.local_path));
        await completeUpload(db, upload, entity, presign.s3Key);
      } catch (error) {
        await failUpload(db, upload, error);
      }
    }
  }

  async function authorChecklistSubmit(
    jobOrderId: string,
    templateId: string,
    results: ChecklistItemResult[],
  ): Promise<QueuedOfflineCreate> {
    const db = requireDb();
    const completedById = requireCurrentUserId();
    const id = createUuid();
    const opId = createUuid();
    const completedAt = nowIso();
    const payload = { id, jobOrderId, templateId, results, completedById, completedAt, opId };

    await withTransaction(db, async () => {
      await prefetchedJobOrder(db, jobOrderId);
      await db.execute(
        `INSERT INTO checklist_instance
          (id, job_order_id, template_id, results_json, completed_by_id, completed_at, op_id, sync_state)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING')`,
        [id, jobOrderId, templateId, JSON.stringify(results), completedById, completedAt, opId],
      );
      await enqueueCreate(db, {
        opId,
        entity: 'ChecklistInstance',
        entityId: id,
        jobOrderId,
        payload,
        clientTime: completedAt,
      });
    });

    return { id, opId };
  }

  async function authorPhotoCapture(
    jobOrderId: string,
    phase: PhotoPhase,
    localPath: string,
    geoLat: number | null,
    geoLng: number | null,
  ): Promise<QueuedOfflineCreate> {
    if (!localPath) throw new Error('Photo path is not available.');

    const db = requireDb();
    const capturedById = requireCurrentUserId();
    const id = createUuid();
    const opId = createUuid();
    const takenAt = nowIso();
    const payload = {
      id,
      jobOrderId,
      s3Key: null,
      phase,
      geoLat: geoLat ?? null,
      geoLng: geoLng ?? null,
      takenAt,
      capturedById,
      opId,
    };

    await withTransaction(db, async () => {
      await prefetchedJobOrder(db, jobOrderId);
      await db.execute(
        `INSERT INTO binary_upload (id, entity, local_path, content_type, upload_state)
         VALUES (?, 'Photo', ?, 'image/jpeg', 'PENDING')`,
        [id, localPath],
      );
      await db.execute(
        `INSERT INTO photo
          (id, job_order_id, s3_key, phase, geo_lat, geo_lng, taken_at, captured_by_id, op_id, sync_state)
         VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, 'PENDING')`,
        [id, jobOrderId, phase, geoLat ?? null, geoLng ?? null, takenAt, capturedById, opId],
      );
      await enqueueCreate(db, {
        opId,
        entity: 'Photo',
        entityId: id,
        jobOrderId,
        payload,
        clientTime: takenAt,
        blocksOnOp: id,
      });
    });

    return { id, opId, uploadId: id };
  }

  async function authorESignature(
    jobOrderId: string,
    signerName: string,
    signerRole: string,
    geoLat: number | null,
    geoLng: number | null,
    imageLocalPath: string,
  ): Promise<QueuedOfflineCreate> {
    if (!imageLocalPath) throw new Error('Signature image path is not available.');

    const db = requireDb();
    const currentUserId = requireCurrentUserId();
    const jobOrder = await prefetchedJobOrder(db, jobOrderId);
    if (jobOrder.execution_owner_id !== currentUserId) {
      throw new Error('Only the assigned execution owner can sign this job');
    }

    const id = createUuid();
    const opId = createUuid();
    const signedAt = nowIso();
    const deviceId = await currentDeviceId();
    const cleanSignerName = signerName.trim();
    const cleanSignerRole = signerRole.trim();
    const snapshotJson = sortedStringify(await signatureSnapshot(db, jobOrderId, cleanSignerName, cleanSignerRole, signedAt));
    const documentHash = await sha256Hex(snapshotJson);
    const payload = {
      id,
      jobOrderId,
      imageS3Key: null,
      signerName: cleanSignerName,
      signerRole: cleanSignerRole,
      signedAt,
      deviceId,
      geoLat: geoLat ?? null,
      geoLng: geoLng ?? null,
      documentHash,
      opId,
    };

    await withTransaction(db, async () => {
      await db.execute(
        `INSERT INTO binary_upload (id, entity, local_path, content_type, upload_state)
         VALUES (?, 'ESignature', ?, 'image/png', 'PENDING')`,
        [id, imageLocalPath],
      );
      await db.execute(
        `INSERT INTO esignature
          (id, job_order_id, image_s3_key, signer_name, signer_role, signed_at, device_id,
           geo_lat, geo_lng, document_hash, snapshot_json, op_id, sync_state)
         VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING')`,
        [
          id,
          jobOrderId,
          cleanSignerName,
          cleanSignerRole,
          signedAt,
          deviceId,
          geoLat ?? null,
          geoLng ?? null,
          documentHash,
          snapshotJson,
          opId,
        ],
      );
      await enqueueCreate(db, {
        opId,
        entity: 'ESignature',
        entityId: id,
        jobOrderId,
        payload,
        clientTime: signedAt,
        blocksOnOp: id,
      });
    });

    return { id, opId, uploadId: id, documentHash, snapshotJson };
  }

  return {
    drainBinaryUploads,
    authorChecklistSubmit,
    authorPhotoCapture,
    authorESignature,
  };
}
