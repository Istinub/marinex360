import { readonly, ref } from 'vue';
import { currentSessionSnapshot } from './useAuth.ts';

type MaterialLineSource = 'FIELD';
type MaterialLineSyncState = 'PENDING';

export interface MaterialLineCreateInput {
  jobOrderId: string;
  partCatalogId?: string | null;
  description: string;
  quantity: string;
  unit: string;
  unitCostAmountMinor: number;
  unitCostCurrency: string;
}

export interface QueuedMaterialLine extends MaterialLineCreateInput {
  id: string;
  source: MaterialLineSource;
  addedById: string;
  opId: string;
  syncState: MaterialLineSyncState;
}

interface AppMetaRow {
  v: string;
}

interface JoCacheIdentityRow {
  id: string;
}

interface MobileSqlAdapter {
  select<T>(sql: string, params?: unknown[]): Promise<T[]>;
  execute(sql: string, params?: unknown[]): Promise<void>;
  transaction?<T>(work: () => Promise<T>): Promise<T>;
}

interface MobileRuntime {
  marinex360?: {
    db?: MobileSqlAdapter;
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

function requireDb(): MobileSqlAdapter {
  const db = mobileRuntime().marinex360?.db;
  if (!db) {
    // NEEDS: Mobile shell must provide the S0-6 SQLite adapter; this form intentionally has no direct API submit path.
    throw new Error('Offline queue is not available on this device.');
  }

  return db;
}

function requireCurrentUserId(): string {
  const userId = currentSessionSnapshot()?.userId;
  if (!userId) {
    throw new Error('Current user is not available.');
  }

  return userId;
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

async function assertPrefetchedJobOrder(db: MobileSqlAdapter, jobOrderId: string): Promise<void> {
  const rows = await db.select<JoCacheIdentityRow>('SELECT id FROM jo_cache WHERE id=?', [jobOrderId]);
  if (rows.length === 0) throw new Error('Job order is not available offline.');
}

export function normalizeQuantity(value: string): string | null {
  const trimmed = value.trim();
  const match = trimmed.match(/^(0|[1-9]\d*)(?:\.(\d{1,3}))?$/);
  if (!match) return null;
  if (trimmed.replace(/[.0]/g, '') === '') return null;

  return match[2] ? `${match[1]}.${match[2]}` : match[1];
}

export function moneyTextToMinorUnits(value: string): number | null {
  const trimmed = value.trim();
  const match = trimmed.match(/^(0|[1-9]\d*)(?:\.(\d{1,2}))?$/);
  if (!match) return null;

  const major = match[1];
  const minor = (match[2] ?? '').padEnd(2, '0');
  const amountMinor = BigInt(`${major}${minor}`.replace(/^0+(?=\d)/, ''));

  if (amountMinor > BigInt(Number.MAX_SAFE_INTEGER)) return null;

  return Number(amountMinor);
}

export function normalizeCurrency(value: string): string | null {
  const currency = value.trim().toUpperCase();
  return /^[A-Z]{3}$/.test(currency) ? currency : null;
}

export function useMaterialLines() {
  const isSubmitting = ref(false);
  const lastQueuedLine = ref<QueuedMaterialLine | null>(null);

  async function enqueueCreate(input: MaterialLineCreateInput): Promise<QueuedMaterialLine> {
    const db = requireDb();
    const addedById = requireCurrentUserId();
    const id = createUuid();
    const opId = createUuid();
    const createdAt = nowIso();
    const cleanInput: MaterialLineCreateInput = {
      jobOrderId: input.jobOrderId,
      partCatalogId: input.partCatalogId ?? null,
      description: input.description.trim(),
      quantity: input.quantity,
      unit: input.unit.trim(),
      unitCostAmountMinor: input.unitCostAmountMinor,
      unitCostCurrency: input.unitCostCurrency,
    };
    const queuedLine: QueuedMaterialLine = {
      ...cleanInput,
      id,
      source: 'FIELD',
      addedById,
      opId,
      syncState: 'PENDING',
    };
    const payload = {
      id,
      jobOrderId: cleanInput.jobOrderId,
      partCatalogId: cleanInput.partCatalogId,
      description: cleanInput.description,
      quantity: cleanInput.quantity,
      unit: cleanInput.unit,
      unitCostAmountMinor: cleanInput.unitCostAmountMinor,
      unitCostCurrency: cleanInput.unitCostCurrency,
      source: queuedLine.source,
      addedById,
      opId,
    };

    isSubmitting.value = true;
    try {
      await withTransaction(db, async () => {
        const version = await schemaVersion(db);
        await assertPrefetchedJobOrder(db, cleanInput.jobOrderId);

        await db.execute(
          `INSERT INTO material_line
            (id, job_order_id, part_catalog_id, description, quantity, unit,
             unit_cost_amount_minor, unit_cost_currency, source, added_by_id, op_id, sync_state)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'FIELD', ?, ?, 'PENDING')`,
          [
            id,
            cleanInput.jobOrderId,
            cleanInput.partCatalogId,
            cleanInput.description,
            cleanInput.quantity,
            cleanInput.unit,
            cleanInput.unitCostAmountMinor,
            cleanInput.unitCostCurrency,
            addedById,
            opId,
          ],
        );

        await db.execute(
          `INSERT INTO op_queue
            (op_id, entity, action, entity_id, job_order_id, payload_json, base_version,
             schema_version, client_time, status, created_at, updated_at)
           VALUES (?, 'MaterialLine', 'CREATE', ?, ?, ?, NULL, ?, ?, 'PENDING', ?, ?)`,
          [
            opId,
            id,
            cleanInput.jobOrderId,
            JSON.stringify(payload),
            version,
            createdAt,
            createdAt,
            createdAt,
          ],
        );
      });

      lastQueuedLine.value = queuedLine;
      return queuedLine;
    } finally {
      isSubmitting.value = false;
    }
  }

  return {
    isSubmitting: readonly(isSubmitting),
    lastQueuedLine: readonly(lastQueuedLine),
    enqueueCreate,
  };
}
