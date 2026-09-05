import { computed, ref } from 'vue';

export interface ExecutionChecklistSummary {
  id: string;
  templateId: string;
  results: unknown[];
  completedAt: string | null;
  syncState: string;
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
  materials: ExecutionMaterialSummary[];
  observations: ExecutionObservationSummary[];
  photos: ExecutionPhotoSummary[];
  signatures: ExecutionSignatureSummary[];
}

interface MobileSqlAdapter {
  select<T>(sql: string, params?: unknown[]): Promise<T[]>;
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

export async function loadExecutionSummary(jobOrderId: string): Promise<ExecutionSummary> {
  const db = requireDb();
  const [checklists, materials, observations, photos, signatures] = await Promise.all([
    db.select<ChecklistRow>(
      `SELECT id, template_id, results_json, completed_at, sync_state
       FROM checklist_instance
       WHERE job_order_id=?
       ORDER BY completed_at DESC, id ASC`,
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
