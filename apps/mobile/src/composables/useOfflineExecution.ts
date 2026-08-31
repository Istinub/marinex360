import { Device as CapacitorDevice } from '@capacitor/device';

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

interface AppMetaRow {
  v: string;
}

interface JoOwnerRow {
  id: string;
  execution_owner_id: string | null;
}

interface MobileSqlAdapter {
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
    };
  };
}

function mobileRuntime(): MobileRuntime {
  return globalThis as typeof globalThis & MobileRuntime;
}

function nowIso(): string {
  return new Date().toISOString();
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
    authorChecklistSubmit,
    authorPhotoCapture,
    authorESignature,
  };
}
