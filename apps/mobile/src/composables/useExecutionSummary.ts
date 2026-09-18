import { computed, ref } from 'vue';
import type { MobileSqlAdapter } from './useOfflineExecution.ts';

export interface ExecutionChecklistSummary {
  id: string;
  templateId: string;
  results: unknown[];
  completedAt: string | null;
  syncState: string;
}

export interface ExecutionCheckedChecklistItemSummary {
  id: string;
  label: string;
  updatedAt: string | null;
}

export interface ExecutionMaterialSummary {
  id: string;
  description: string;
  quantity: string;
  unit: string;
  unitCostAmountMinor: number;
  unitCostCurrency: string;
  syncState: string;
}

export interface ExecutionObservationSummary {
  id: string;
  body: string;
  createdAt: string;
  syncState: string;
}

export interface ExecutionPhotoSummary {
  id: string;
  phase: string;
  localPath: string | null;
  s3Key: string | null;
  takenAt: string;
  syncState: string;
}

export interface ExecutionSignatureSummary {
  id: string;
  signerName: string | null;
  signerRole: string | null;
  signedAt: string | null;
  documentHash: string | null;
  syncState: string;
}

export interface ExecutionSummary {
  checklists: ExecutionChecklistSummary[];
  checkedChecklistItems: ExecutionCheckedChecklistItemSummary[];
  materials: ExecutionMaterialSummary[];
  observations: ExecutionObservationSummary[];
  photos: ExecutionPhotoSummary[];
  signatures: ExecutionSignatureSummary[];
}

interface MobileRuntime {
  marinex360?: {
    db?: MobileSqlAdapter;
  };
}

interface ChecklistRow {
  id: string;
  template_id: string;
  results_json: string;
  completed_at: string | null;
  sync_state: string;
}

interface CheckedChecklistItemRow {
  id: string;
  label: string;
  updated_at: string | null;
}

interface MaterialRow {
  id: string;
  description: string;
  quantity: string;
  unit: string;
  unit_cost_amount_minor: number;
  unit_cost_currency: string;
  sync_state: string;
}

interface ObservationRow {
  id: string;
  body: string;
  created_at: string;
  sync_state: string;
}

interface PhotoRow {
  id: string;
  phase: string;
  local_path: string | null;
  s3_key: string | null;
  taken_at: string;
  sync_state: string;
}

interface SignatureRow {
  id: string;
  signer_name: string | null;
  signer_role: string | null;
  signed_at: string | null;
  document_hash: string | null;
  sync_state: string;
}

interface ExecutionDetailChecklistItem {
  id: string;
  jobOrderId?: string | null;
  label: string;
  checked: boolean;
  createdAt?: string | null;
  updatedAt?: string | null;
}

interface ExecutionDetailObservation {
  id: string;
  jobOrderId?: string | null;
  templateKey?: string | null;
  body: string;
  authorId?: string | null;
  reviewState?: string | null;
  createdAt?: string | null;
}

interface ExecutionDetailPhoto {
  id: string;
  jobOrderId?: string | null;
  s3Key?: string | null;
  phase: string;
  geoLat?: number | null;
  geoLng?: number | null;
  takenAt?: string | null;
  capturedById?: string | null;
  reviewState?: string | null;
}

interface ExecutionDetailMaterial {
  id: string;
  jobOrderId?: string | null;
  partCatalogId?: string | null;
  description: string;
  quantity: string | number;
  unit: string;
  unitCostAmountMinor: number;
  unitCostCurrency: string;
  source?: string | null;
  addedById?: string | null;
  reviewState?: string | null;
  version?: number | null;
}

interface ExecutionDetailSignature {
  id: string;
  jobOrderId?: string | null;
  imageS3Key?: string | null;
  signerName?: string | null;
  signerRole?: string | null;
  signedAt?: string | null;
  deviceId?: string | null;
  geoLat?: number | null;
  geoLng?: number | null;
  documentHash?: string | null;
  reviewState?: string | null;
}

export interface ExecutionDetailJobOrder {
  id: string;
  checklistItems?: ExecutionDetailChecklistItem[];
  observations?: ExecutionDetailObservation[];
  photos?: ExecutionDetailPhoto[];
  materials?: ExecutionDetailMaterial[];
  signature?: ExecutionDetailSignature | null;
}

type PullChange = { entity: string; row: Record<string, unknown> };

function mobileRuntime(): MobileRuntime {
  return globalThis as typeof globalThis & MobileRuntime;
}

function requireDb(): MobileSqlAdapter {
  const db = mobileRuntime().marinex360?.db;
  if (!db) throw new Error('Offline execution data is not available on this device.');
  return db;
}

function parseResults(value: string): unknown[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function stringField(row: Record<string, unknown>, camel: string, snake = camel): string | null {
  const value = row[camel] ?? row[snake];
  return typeof value === 'string' ? value : null;
}

function numberField(row: Record<string, unknown>, camel: string, snake = camel): number | null {
  const value = row[camel] ?? row[snake];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function booleanField(row: Record<string, unknown>, camel: string, snake = camel): boolean {
  const value = row[camel] ?? row[snake];
  return value === true || value === 1;
}

function nowIso(): string {
  return new Date().toISOString();
}

async function cacheChecklistItem(db: MobileSqlAdapter, jobOrderId: string, item: ExecutionDetailChecklistItem): Promise<void> {
  await db.execute(
    `INSERT INTO job_order_checklist_item_cache
      (id, job_order_id, label, checked, created_at, updated_at, pulled_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       job_order_id=excluded.job_order_id,
       label=excluded.label,
       checked=excluded.checked,
       created_at=excluded.created_at,
       updated_at=excluded.updated_at,
       pulled_at=excluded.pulled_at`,
    [
      item.id,
      item.jobOrderId ?? jobOrderId,
      item.label,
      item.checked ? 1 : 0,
      item.createdAt ?? null,
      item.updatedAt ?? null,
      nowIso(),
    ],
  );
}

async function cacheObservation(db: MobileSqlAdapter, jobOrderId: string, observation: ExecutionDetailObservation): Promise<void> {
  await db.execute(
    `INSERT INTO observation
      (id, job_order_id, template_key, body, author_id, created_at, op_id, sync_state)
     VALUES (?, ?, ?, ?, ?, ?, NULL, 'SYNCED')
     ON CONFLICT(id) DO UPDATE SET
       job_order_id=excluded.job_order_id,
       template_key=excluded.template_key,
       body=excluded.body,
       author_id=excluded.author_id,
       created_at=excluded.created_at,
       sync_state='SYNCED'`,
    [
      observation.id,
      observation.jobOrderId ?? jobOrderId,
      observation.templateKey ?? null,
      observation.body,
      observation.authorId ?? 'server',
      observation.createdAt ?? nowIso(),
    ],
  );
}

async function cachePhoto(db: MobileSqlAdapter, jobOrderId: string, photo: ExecutionDetailPhoto): Promise<void> {
  await db.execute(
    `INSERT INTO photo
      (id, job_order_id, s3_key, phase, geo_lat, geo_lng, taken_at, captured_by_id, op_id, sync_state)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, 'SYNCED')
     ON CONFLICT(id) DO UPDATE SET
       job_order_id=excluded.job_order_id,
       s3_key=excluded.s3_key,
       phase=excluded.phase,
       geo_lat=excluded.geo_lat,
       geo_lng=excluded.geo_lng,
       taken_at=excluded.taken_at,
       captured_by_id=excluded.captured_by_id,
       sync_state='SYNCED'`,
    [
      photo.id,
      photo.jobOrderId ?? jobOrderId,
      photo.s3Key ?? null,
      photo.phase,
      photo.geoLat ?? null,
      photo.geoLng ?? null,
      photo.takenAt ?? nowIso(),
      photo.capturedById ?? 'server',
    ],
  );
}

async function cacheMaterial(db: MobileSqlAdapter, jobOrderId: string, material: ExecutionDetailMaterial): Promise<void> {
  await db.execute(
    `INSERT INTO material_line
      (id, job_order_id, part_catalog_id, description, quantity, unit, unit_cost_amount_minor,
       unit_cost_currency, source, added_by_id, version, op_id, sync_state)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 'SYNCED')
     ON CONFLICT(id) DO UPDATE SET
       job_order_id=excluded.job_order_id,
       part_catalog_id=excluded.part_catalog_id,
       description=excluded.description,
       quantity=excluded.quantity,
       unit=excluded.unit,
       unit_cost_amount_minor=excluded.unit_cost_amount_minor,
       unit_cost_currency=excluded.unit_cost_currency,
       source=excluded.source,
       added_by_id=excluded.added_by_id,
       version=excluded.version,
       sync_state='SYNCED'`,
    [
      material.id,
      material.jobOrderId ?? jobOrderId,
      material.partCatalogId ?? null,
      material.description,
      String(material.quantity),
      material.unit,
      material.unitCostAmountMinor,
      material.unitCostCurrency,
      material.source ?? 'FIELD',
      material.addedById ?? 'server',
      material.version ?? 0,
    ],
  );
}

async function cacheSignature(db: MobileSqlAdapter, jobOrderId: string, signature: ExecutionDetailSignature): Promise<void> {
  await db.execute(
    `INSERT INTO esignature
      (id, job_order_id, image_s3_key, signer_name, signer_role, signed_at, device_id,
       geo_lat, geo_lng, document_hash, snapshot_json, op_id, sync_state)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, 'SYNCED')
     ON CONFLICT(job_order_id) DO UPDATE SET
       id=excluded.id,
       image_s3_key=excluded.image_s3_key,
       signer_name=excluded.signer_name,
       signer_role=excluded.signer_role,
       signed_at=excluded.signed_at,
       device_id=excluded.device_id,
       geo_lat=excluded.geo_lat,
       geo_lng=excluded.geo_lng,
       document_hash=excluded.document_hash,
       sync_state='SYNCED'`,
    [
      signature.id,
      signature.jobOrderId ?? jobOrderId,
      signature.imageS3Key ?? null,
      signature.signerName ?? null,
      signature.signerRole ?? null,
      signature.signedAt ?? null,
      signature.deviceId ?? null,
      signature.geoLat ?? null,
      signature.geoLng ?? null,
      signature.documentHash ?? null,
    ],
  );
}

export async function cacheExecutionDetailsFromJobOrder(job: ExecutionDetailJobOrder): Promise<void> {
  const db = requireDb();
  await Promise.all([
    ...(job.checklistItems ?? []).map((item) => cacheChecklistItem(db, job.id, item)),
    ...(job.observations ?? []).map((observation) => cacheObservation(db, job.id, observation)),
    ...(job.photos ?? []).map((photo) => cachePhoto(db, job.id, photo)),
    ...(job.materials ?? []).map((material) => cacheMaterial(db, job.id, material)),
    ...(job.signature ? [cacheSignature(db, job.id, job.signature)] : []),
  ]);
}

export async function cacheExecutionPullChange(db: MobileSqlAdapter, change: PullChange): Promise<void> {
  const row = change.row;
  const id = stringField(row, 'id');
  const jobOrderId = stringField(row, 'jobOrderId', 'job_order_id');
  if (!id || !jobOrderId) return;

  switch (change.entity) {
    case 'Observation':
      return cacheObservation(db, jobOrderId, {
        id,
        jobOrderId,
        templateKey: stringField(row, 'templateKey', 'template_key'),
        body: stringField(row, 'body') ?? '',
        authorId: stringField(row, 'authorId', 'author_id'),
        createdAt: stringField(row, 'createdAt', 'created_at'),
      });
    case 'Photo':
      return cachePhoto(db, jobOrderId, {
        id,
        jobOrderId,
        s3Key: stringField(row, 's3Key', 's3_key'),
        phase: stringField(row, 'phase') ?? 'DURING',
        geoLat: numberField(row, 'geoLat', 'geo_lat'),
        geoLng: numberField(row, 'geoLng', 'geo_lng'),
        takenAt: stringField(row, 'takenAt', 'taken_at'),
        capturedById: stringField(row, 'capturedById', 'captured_by_id'),
      });
    case 'MaterialLine':
      return cacheMaterial(db, jobOrderId, {
        id,
        jobOrderId,
        partCatalogId: stringField(row, 'partCatalogId', 'part_catalog_id'),
        description: stringField(row, 'description') ?? '',
        quantity: stringField(row, 'quantity') ?? String(row.quantity ?? '0'),
        unit: stringField(row, 'unit') ?? '',
        unitCostAmountMinor: numberField(row, 'unitCostAmountMinor', 'unit_cost_amount_minor') ?? 0,
        unitCostCurrency: stringField(row, 'unitCostCurrency', 'unit_cost_currency') ?? 'SGD',
        source: stringField(row, 'source') ?? 'FIELD',
        addedById: stringField(row, 'addedById', 'added_by_id'),
        version: numberField(row, 'version') ?? 0,
      });
    case 'ESignature':
      return cacheSignature(db, jobOrderId, {
        id,
        jobOrderId,
        imageS3Key: stringField(row, 'imageS3Key', 'image_s3_key'),
        signerName: stringField(row, 'signerName', 'signer_name'),
        signerRole: stringField(row, 'signerRole', 'signer_role'),
        signedAt: stringField(row, 'signedAt', 'signed_at'),
        deviceId: stringField(row, 'deviceId', 'device_id'),
        geoLat: numberField(row, 'geoLat', 'geo_lat'),
        geoLng: numberField(row, 'geoLng', 'geo_lng'),
        documentHash: stringField(row, 'documentHash', 'document_hash'),
      });
    case 'JobOrderChecklistItem':
      return cacheChecklistItem(db, jobOrderId, {
        id,
        jobOrderId,
        label: stringField(row, 'label') ?? '',
        checked: booleanField(row, 'checked'),
        createdAt: stringField(row, 'createdAt', 'created_at'),
        updatedAt: stringField(row, 'updatedAt', 'updated_at'),
      });
  }
}

export async function loadExecutionSummary(jobOrderId: string): Promise<ExecutionSummary> {
  const db = requireDb();
  const [checklists, checkedChecklistItems, materials, observations, photos, signatures] = await Promise.all([
    db.select<ChecklistRow>(
      `SELECT id, template_id, results_json, completed_at, sync_state
       FROM checklist_instance
       WHERE job_order_id=?
       ORDER BY completed_at DESC, id ASC`,
      [jobOrderId],
    ),
    db.select<CheckedChecklistItemRow>(
      `SELECT id, label, updated_at
       FROM job_order_checklist_item_cache
       WHERE job_order_id=? AND checked=1
       ORDER BY updated_at DESC, created_at ASC, label ASC`,
      [jobOrderId],
    ),
    db.select<MaterialRow>(
      `SELECT id, description, quantity, unit, unit_cost_amount_minor, unit_cost_currency, sync_state
       FROM material_line
       WHERE job_order_id=?
       ORDER BY rowid ASC`,
      [jobOrderId],
    ),
    db.select<ObservationRow>(
      `SELECT id, body, created_at, sync_state
       FROM observation
       WHERE job_order_id=?
       ORDER BY created_at DESC, id ASC`,
      [jobOrderId],
    ),
    db.select<PhotoRow>(
      `SELECT p.id, p.phase, b.local_path, p.s3_key, p.taken_at, p.sync_state
       FROM photo p
       LEFT JOIN binary_upload b ON b.id=p.id
       WHERE p.job_order_id=?
       ORDER BY p.taken_at DESC, p.id ASC`,
      [jobOrderId],
    ),
    db.select<SignatureRow>(
      `SELECT id, signer_name, signer_role, signed_at, document_hash, sync_state
       FROM esignature
       WHERE job_order_id=?
       ORDER BY signed_at DESC, id ASC`,
      [jobOrderId],
    ),
  ]);

  return {
    checklists: checklists.map((row) => ({
      id: row.id,
      templateId: row.template_id,
      results: parseResults(row.results_json),
      completedAt: row.completed_at,
      syncState: row.sync_state,
    })),
    checkedChecklistItems: checkedChecklistItems.map((row) => ({
      id: row.id,
      label: row.label,
      updatedAt: row.updated_at,
    })),
    materials: materials.map((row) => ({
      id: row.id,
      description: row.description,
      quantity: row.quantity,
      unit: row.unit,
      unitCostAmountMinor: row.unit_cost_amount_minor,
      unitCostCurrency: row.unit_cost_currency,
      syncState: row.sync_state,
    })),
    observations: observations.map((row) => ({
      id: row.id,
      body: row.body,
      createdAt: row.created_at,
      syncState: row.sync_state,
    })),
    photos: photos.map((row) => ({
      id: row.id,
      phase: row.phase,
      localPath: row.local_path,
      s3Key: row.s3_key,
      takenAt: row.taken_at,
      syncState: row.sync_state,
    })),
    signatures: signatures.map((row) => ({
      id: row.id,
      signerName: row.signer_name,
      signerRole: row.signer_role,
      signedAt: row.signed_at,
      documentHash: row.document_hash,
      syncState: row.sync_state,
    })),
  };
}

export function useExecutionSummary(jobOrderId: () => string) {
  const summary = ref<ExecutionSummary | null>(null);
  const isLoading = ref(false);
  const errorMessage = ref<string | null>(null);
  const hasContent = computed(() => {
    const data = summary.value;
    return Boolean(data && (
      data.checklists.length > 0 ||
      data.checkedChecklistItems.length > 0 ||
      data.materials.length > 0 ||
      data.observations.length > 0 ||
      data.photos.length > 0 ||
      data.signatures.length > 0
    ));
  });

  async function load(): Promise<void> {
    isLoading.value = true;
    errorMessage.value = null;
    try {
      summary.value = await loadExecutionSummary(jobOrderId());
    } catch (error) {
      summary.value = null;
      errorMessage.value = error instanceof Error ? error.message : 'Unable to load execution summary.';
    } finally {
      isLoading.value = false;
    }
  }

  return { summary, isLoading, errorMessage, hasContent, load };
}
