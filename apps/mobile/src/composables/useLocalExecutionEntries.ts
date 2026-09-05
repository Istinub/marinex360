import { currentSessionSnapshot } from './useAuth.ts';
import type { ChecklistItemResult, MobileSqlAdapter } from './useOfflineExecution.ts';

type EditableEntity = 'Observation' | 'ChecklistInstance' | 'MaterialLine';

export interface LocalObservationEntry {
  id: string;
  body: string;
  templateKey: string | null;
  photoOpIds: string[];
  createdAt: string;
  syncState: string;
  version: number;
}

export interface LocalChecklistEntry {
  id: string;
  templateId: string;
  results: ChecklistItemResult[];
  completedAt: string | null;
  syncState: string;
  version: number;
}

export interface LocalMaterialEntry {
  id: string;
  description: string;
  quantity: string;
  unit: string;
  unitCostAmountMinor: number;
  unitCostCurrency: string;
  syncState: string;
  version: number;
}

interface AppMetaRow {
  v: string;
}

interface MobileRuntime {
  marinex360?: {
    db?: MobileSqlAdapter;
  };
}

interface ObservationRow {
  id: string;
  body: string;
  template_key: string | null;
  created_at: string;
  sync_state: string;
}

interface ChecklistRow {
  id: string;
  template_id: string;
  results_json: string;
  completed_at: string | null;
  sync_state: string;
  version: number;
}

interface MaterialRow {
  id: string;
  description: string;
  quantity: string;
  unit: string;
  unit_cost_amount_minor: number;
  unit_cost_currency: string;
  sync_state: string;
  version: number;
}

function mobileRuntime(): MobileRuntime {
  return globalThis as typeof globalThis & MobileRuntime;
}

function requireDb(): MobileSqlAdapter {
  const db = mobileRuntime().marinex360?.db;
  if (!db) throw new Error('Offline execution data is not available on this device.');
  return db;
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

async function schemaVersion(db: MobileSqlAdapter): Promise<number> {
  const rows = await db.select<AppMetaRow>("SELECT v FROM app_meta WHERE k='schema_version'");
  const version = Number(rows[0]?.v);
  if (!Number.isInteger(version)) throw new Error('Offline schema version is not available.');
  return version;
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

function parseResults(value: string): ChecklistItemResult[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed as ChecklistItemResult[] : [];
  } catch {
    return [];
  }
}

export function observationTemplateKey(photoOpIds: string[]): string | null {
  return photoOpIds.length > 0 ? `observation-photos:${JSON.stringify(photoOpIds)}` : null;
}

function photoIdsFromTemplateKey(value: string | null): string[] {
  const prefix = 'observation-photos:';
  if (!value?.startsWith(prefix)) return [];
  try {
    const parsed = JSON.parse(value.slice(prefix.length)) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

function entityTable(entity: EditableEntity): string {
  return {
    Observation: 'observation',
    ChecklistInstance: 'checklist_instance',
    MaterialLine: 'material_line',
  }[entity];
}

async function queueUpdate(
  db: MobileSqlAdapter,
  input: {
    entity: EditableEntity;
    entityId: string;
    jobOrderId: string;
    payload: Record<string, unknown>;
    baseVersion: number | null;
  },
): Promise<void> {
  const at = nowIso();
  await db.execute(
    `INSERT INTO op_queue
      (op_id, entity, action, entity_id, job_order_id, payload_json, base_version,
       schema_version, client_time, status, created_at, updated_at)
     VALUES (?, ?, 'UPDATE', ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?)`,
    [
      createUuid(),
      input.entity,
      input.entityId,
      input.jobOrderId,
      JSON.stringify(input.payload),
      input.baseVersion,
      await schemaVersion(db),
      at,
      at,
      at,
    ],
  );
}

export async function listLocalObservations(jobOrderId: string): Promise<LocalObservationEntry[]> {
  const rows = await requireDb().select<ObservationRow>(
    `SELECT id, body, template_key, created_at, sync_state
     FROM observation
     WHERE job_order_id=?
     ORDER BY created_at DESC, id ASC`,
    [jobOrderId],
  );

  return rows.map((row) => ({
    id: row.id,
    body: row.body,
    templateKey: row.template_key,
    photoOpIds: photoIdsFromTemplateKey(row.template_key),
    createdAt: row.created_at,
    syncState: row.sync_state,
    version: 0,
  }));
}

export async function listLocalChecklists(jobOrderId: string): Promise<LocalChecklistEntry[]> {
  const rows = await requireDb().select<ChecklistRow>(
    `SELECT id, template_id, results_json, completed_at, sync_state, version
     FROM checklist_instance
     WHERE job_order_id=?
     ORDER BY completed_at DESC, id ASC`,
    [jobOrderId],
  );

  return rows.map((row) => ({
    id: row.id,
    templateId: row.template_id,
    results: parseResults(row.results_json),
    completedAt: row.completed_at,
    syncState: row.sync_state,
    version: row.version,
  }));
}

export async function listLocalMaterials(jobOrderId: string): Promise<LocalMaterialEntry[]> {
  const rows = await requireDb().select<MaterialRow>(
    `SELECT id, description, quantity, unit, unit_cost_amount_minor, unit_cost_currency, sync_state, version
     FROM material_line
     WHERE job_order_id=?
     ORDER BY rowid DESC`,
    [jobOrderId],
  );

  return rows.map((row) => ({
    id: row.id,
    description: row.description,
    quantity: row.quantity,
    unit: row.unit,
    unitCostAmountMinor: row.unit_cost_amount_minor,
    unitCostCurrency: row.unit_cost_currency,
    syncState: row.sync_state,
    version: row.version,
  }));
}

export async function updateLocalObservation(entry: LocalObservationEntry, jobOrderId: string, body: string, photoOpIds: string[]): Promise<void> {
  const db = requireDb();
  const cleanBody = body.trim();
  if (!cleanBody) throw new Error('Observation is required.');
  const templateKey = observationTemplateKey(photoOpIds);

  await withTransaction(db, async () => {
    await db.execute(
      `UPDATE observation
       SET body=?, template_key=?, sync_state='PENDING'
       WHERE id=?`,
      [cleanBody, templateKey, entry.id],
    );
    await queueUpdate(db, {
      entity: 'Observation',
      entityId: entry.id,
      jobOrderId,
      baseVersion: null,
      payload: { body: cleanBody, templateKey, photoOpIds },
    });
  });
}

export async function updateLocalChecklist(entry: LocalChecklistEntry, jobOrderId: string, results: ChecklistItemResult[]): Promise<void> {
  const db = requireDb();
  const completedById = currentSessionSnapshot()?.userId;
  if (!completedById) throw new Error('Current user is not available.');
  const completedAt = nowIso();

  await withTransaction(db, async () => {
    await db.execute(
      `UPDATE checklist_instance
       SET results_json=?, completed_by_id=?, completed_at=?, sync_state='PENDING'
       WHERE id=?`,
      [JSON.stringify(results), completedById, completedAt, entry.id],
    );
    await queueUpdate(db, {
      entity: 'ChecklistInstance',
      entityId: entry.id,
      jobOrderId,
      baseVersion: entry.version,
      payload: { templateId: entry.templateId, results, completedAt },
    });
  });
}

export async function updateLocalMaterial(entry: LocalMaterialEntry, jobOrderId: string, input: {
  description: string;
  quantity: string;
  unit: string;
  unitCostAmountMinor: number;
  unitCostCurrency: string;
}): Promise<void> {
  const db = requireDb();
  await withTransaction(db, async () => {
    await db.execute(
      `UPDATE material_line
       SET description=?, quantity=?, unit=?, unit_cost_amount_minor=?, unit_cost_currency=?, sync_state='PENDING'
       WHERE id=?`,
      [input.description, input.quantity, input.unit, input.unitCostAmountMinor, input.unitCostCurrency, entry.id],
    );
    await queueUpdate(db, {
      entity: 'MaterialLine',
      entityId: entry.id,
      jobOrderId,
      baseVersion: entry.version,
      payload: input,
    });
  });
}

export async function deleteUnsyncedLocalEntry(entity: EditableEntity, id: string): Promise<void> {
  const db = requireDb();
  const table = entityTable(entity);
  const rows = await db.select<{ sync_state: string }>(`SELECT sync_state FROM ${table} WHERE id=?`, [id]);
  const state = rows[0]?.sync_state;
  if (!state) return;
  if (state !== 'PENDING') {
    throw new Error('Delete is available only for entries that have not synced yet.');
  }

  await withTransaction(db, async () => {
    await db.execute(`DELETE FROM ${table} WHERE id=?`, [id]);
    await db.execute('DELETE FROM op_queue WHERE entity=? AND entity_id=? AND status!=\'SYNCED\'', [entity, id]);
  });
}
