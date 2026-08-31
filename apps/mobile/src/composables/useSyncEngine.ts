import { apiBase, authHeaders, type MobileSqlAdapter } from './useOfflineExecution.ts';

type WritableEntity = 'WorkLog' | 'Photo' | 'Observation' | 'ChecklistInstance' | 'MaterialLine' | 'ESignature';
type OpAction = 'CREATE' | 'UPDATE';
type QueueStatus = 'PENDING' | 'SYNCING' | 'SYNCED' | 'CONFLICT' | 'ERROR' | 'FLAGGED';
type OpStatus =
  | 'APPLIED'
  | 'APPLIED_FLAGGED'
  | 'VALIDATION_ERROR'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'VERSION_CONFLICT'
  | 'IDEMPOTENT_REPLAY'
  | 'BRANCH_SCOPE_DENIED'
  | 'STATE_TRANSITION_INVALID';

export interface OpQueueRow {
  seq: number;
  op_id: string;
  entity: WritableEntity;
  action: OpAction;
  entity_id: string;
  job_order_id: string;
  payload_json: string;
  base_version: number | null;
  schema_version: number;
  client_time: string;
  status: QueueStatus;
  attempts: number;
  next_attempt_at: string | null;
  server_version: number | null;
  result_ref: string | null;
  last_error: string | null;
  blocks_on_op: string | null;
  created_at: string;
  updated_at: string;
}

interface CursorRow {
  cursor: string | null;
}

interface QueueSummaryRow {
  status: QueueStatus;
  n: number | string;
}

interface PullChange {
  entity: string;
  row: Record<string, unknown>;
}

interface OpResult {
  opId: string;
  status: OpStatus;
  resultRef?: string;
  serverVersion?: number;
  reviewState?: string;
  error?: { code: string; message?: string };
}

interface BatchResponse {
  httpStatus?: number;
  batchStatus?: 'BATCH_REJECTED_SCHEMA';
  minSchemaVersion?: number;
  results: OpResult[];
}

interface AssignedPullResponse {
  httpStatus?: number;
  changes: PullChange[];
  cursor: string | null;
}

interface SyncAuth {
  userId?: string | null;
  [key: string]: unknown;
}

export interface SyncTransport {
  batch(req: Record<string, unknown>, auth?: SyncAuth): BatchResponse | Promise<BatchResponse>;
  assigned(query: Record<string, string>, auth?: SyncAuth): AssignedPullResponse | Promise<AssignedPullResponse>;
}

export interface SyncOnceResult {
  pushed: number;
  networkError?: boolean;
  authRequired?: boolean;
  upgradeRequired?: boolean;
  results?: OpResult[];
}

interface MobileRuntime {
  marinex360?: {
    db?: MobileSqlAdapter;
    auth?: {
      userId?: string | null;
    };
  };
}

function mobileRuntime(): MobileRuntime {
  return globalThis as typeof globalThis & MobileRuntime;
}

function nowIso(): string {
  return new Date().toISOString();
}

function requireDb(): MobileSqlAdapter {
  const db = mobileRuntime().marinex360?.db;
  if (!db) throw new Error('Offline sync database is not available on this device.');
  return db;
}

function currentUserId(auth?: SyncAuth): string {
  const userId = mobileRuntime().marinex360?.auth?.userId ?? auth?.userId;
  if (!userId) throw new Error('Current user is not available.');
  return userId;
}

export function currentSyncAuth(): SyncAuth {
  return mobileRuntime().marinex360?.auth ?? {};
}

async function responseJson<T>(response: Response): Promise<T | Record<string, never>> {
  try {
    return await response.json() as T;
  } catch {
    return {};
  }
}

export function createSyncTransport(): SyncTransport {
  return {
    async batch(req) {
      const response = await fetch(`${apiBase()}/sync/batch`, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          ...authHeaders(),
        },
        body: JSON.stringify(req),
      });
      const body = await responseJson<BatchResponse>(response);
      const payload = {
        ...body,
        httpStatus: response.status,
        results: Array.isArray(body.results) ? body.results : [],
      } as BatchResponse;

      if (response.status === 401 || payload.batchStatus === 'BATCH_REJECTED_SCHEMA' || response.ok) return payload;
      throw new Error(`sync batch failed (${response.status})`);
    },
    async assigned(query) {
      const qs = new URLSearchParams(query).toString();
      const path = qs ? `/sync/assigned?${qs}` : '/sync/assigned';
      const response = await fetch(`${apiBase()}${path}`, {
        headers: {
          Accept: 'application/json',
          ...authHeaders(),
        },
      });
      const body = await responseJson<AssignedPullResponse>(response);
      const payload = {
        ...body,
        httpStatus: response.status,
        changes: Array.isArray(body.changes) ? body.changes : [],
        cursor: body.cursor ?? null,
      } as AssignedPullResponse;

      if (response.status === 401 || response.ok) return payload;
      throw new Error(`sync assigned failed (${response.status})`);
    },
  };
}

export function syncResultHasVersionConflict(result: SyncOnceResult): boolean {
  return result.results?.some((op) => op.status === 'VERSION_CONFLICT') ?? false;
}

function backoff(attempts: number): string {
  const base = 2000;
  const cap = 300000;
  const delay = Math.min(cap, base * 2 ** attempts) * (0.5 + Math.random() * 0.5);
  return new Date(Date.now() + delay).toISOString();
}

function networkMessage(error: unknown): string {
  if (error && typeof error === 'object') {
    const record = error as Record<string, unknown>;
    return String(record.code ?? record.message ?? 'network');
  }
  return String(error ?? 'network');
}

async function applyPull(db: MobileSqlAdapter, changes: PullChange[], cursorValue: string | null): Promise<void> {
  for (const change of changes) {
    if (change.entity !== 'JobOrder') continue;

    const jo = change.row;
    await db.execute(
      `INSERT INTO jo_cache
        (id,jo_number,branch,client_name,vessel_name,imo_number,port,scope_summary,service_categories,
         state,execution_owner_id,assigned_technician_ids,planned_start_date,
         labour_rate_amount_minor,labour_rate_currency,version,header_locked,pulled_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET state=excluded.state, version=excluded.version,
         assigned_technician_ids=excluded.assigned_technician_ids,
         execution_owner_id=excluded.execution_owner_id, header_locked=excluded.header_locked,
         labour_rate_amount_minor=excluded.labour_rate_amount_minor,
         labour_rate_currency=excluded.labour_rate_currency, pulled_at=excluded.pulled_at`,
      [
        jo.id,
        jo.joNumber,
        jo.branch,
        jo.clientName ?? null,
        jo.vesselName ?? null,
        jo.imoNumber ?? null,
        jo.port ?? null,
        jo.scopeSummary ?? null,
        JSON.stringify(jo.serviceCategories ?? []),
        jo.state,
        jo.executionOwnerId ?? null,
        JSON.stringify(jo.assignedTechnicianIds ?? []),
        jo.plannedStartDate ?? null,
        jo.labourRateAmountMinor ?? 9000,
        jo.labourRateCurrency ?? 'SGD',
        jo.version,
        jo.state === 'IN_PROGRESS' ? 1 : 0,
        nowIso(),
      ],
    );
  }

  if (cursorValue != null) {
    if (typeof cursorValue !== 'string') throw new Error('sync cursor must be a string or null');
    await db.execute('UPDATE sync_cursor SET cursor=?, last_pull_at=? WHERE id=1', [cursorValue, nowIso()]);
  }
}

async function cursorFromDb(db: MobileSqlAdapter): Promise<string | null> {
  const rows = await db.select<CursorRow>('SELECT cursor FROM sync_cursor WHERE id=1');
  return rows[0]?.cursor ?? null;
}

async function assignedPullQuery(db: MobileSqlAdapter): Promise<Record<string, string>> {
  const cursorValue = await cursorFromDb(db);
  return cursorValue == null ? {} : { since: cursorValue };
}

async function readyOpsFromDb(db: MobileSqlAdapter): Promise<OpQueueRow[]> {
  return db.select<OpQueueRow>(
    `SELECT * FROM op_queue
     WHERE status='PENDING' AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
       AND blocks_on_op IS NULL
     ORDER BY seq ASC`,
    [nowIso()],
  );
}

async function queueSummaryFromDb(db: MobileSqlAdapter): Promise<Record<string, number>> {
  const rows = await db.select<QueueSummaryRow>('SELECT status, COUNT(*) n FROM op_queue GROUP BY status');
  return Object.fromEntries(rows.map((row) => [row.status, Number(row.n)]));
}

async function markSyncing(db: MobileSqlAdapter, ops: OpQueueRow[]): Promise<void> {
  for (const op of ops) {
    await db.execute('UPDATE op_queue SET status=\'SYNCING\', attempts=attempts+1, updated_at=? WHERE op_id=?', [nowIso(), op.op_id]);
  }
}

async function setEntityState(
  db: MobileSqlAdapter,
  entity: WritableEntity,
  id: string,
  state: QueueStatus,
  version: number | null | undefined,
): Promise<void> {
  const table: Record<WritableEntity, string> = {
    WorkLog: 'worklog',
    Photo: 'photo',
    Observation: 'observation',
    ChecklistInstance: 'checklist_instance',
    MaterialLine: 'material_line',
    ESignature: 'esignature',
  };

  const entityTable = table[entity];
  if (version != null && ['worklog', 'checklist_instance', 'material_line'].includes(entityTable)) {
    await db.execute(`UPDATE ${entityTable} SET sync_state=?, version=? WHERE id=?`, [state, version, id]);
    return;
  }

  await db.execute(`UPDATE ${entityTable} SET sync_state=? WHERE id=?`, [state, id]);
}

async function markResultError(db: MobileSqlAdapter, op: OpQueueRow, result: OpResult): Promise<void> {
  await db.execute(
    'UPDATE op_queue SET status=\'ERROR\', last_error=?, updated_at=? WHERE op_id=?',
    [JSON.stringify(result.error ?? result.status), nowIso(), result.opId],
  );
  await setEntityState(db, op.entity, op.entity_id, 'ERROR', null);
}

async function applyResult(db: MobileSqlAdapter, result: OpResult): Promise<void> {
  const rows = await db.select<OpQueueRow>('SELECT * FROM op_queue WHERE op_id=?', [result.opId]);
  const op = rows[0];
  if (!op) return;

  switch (result.status) {
    case 'APPLIED':
    case 'IDEMPOTENT_REPLAY':
      await db.execute(
        'UPDATE op_queue SET status=\'SYNCED\', server_version=?, result_ref=?, last_error=NULL, updated_at=? WHERE op_id=?',
        [result.serverVersion ?? null, result.resultRef ?? null, nowIso(), result.opId],
      );
      await setEntityState(db, op.entity, op.entity_id, 'SYNCED', result.serverVersion);
      break;
    case 'APPLIED_FLAGGED':
      await db.execute(
        'UPDATE op_queue SET status=\'FLAGGED\', server_version=?, result_ref=?, last_error=NULL, updated_at=? WHERE op_id=?',
        [result.serverVersion ?? null, result.resultRef ?? null, nowIso(), result.opId],
      );
      await setEntityState(db, op.entity, op.entity_id, 'FLAGGED', result.serverVersion);
      break;
    case 'VERSION_CONFLICT':
      await db.execute(
        'UPDATE op_queue SET status=\'CONFLICT\', server_version=?, updated_at=? WHERE op_id=?',
        [result.serverVersion ?? null, nowIso(), result.opId],
      );
      await setEntityState(db, op.entity, op.entity_id, 'CONFLICT', null);
      break;
    case 'VALIDATION_ERROR':
    case 'UNAUTHORIZED':
    case 'FORBIDDEN':
    case 'NOT_FOUND':
    case 'BRANCH_SCOPE_DENIED':
    case 'STATE_TRANSITION_INVALID':
      await markResultError(db, op, result);
      break;
  }
}

async function onNetworkFailure(db: MobileSqlAdapter, ops: OpQueueRow[], error: unknown): Promise<void> {
  for (const op of ops) {
    await db.execute(
      'UPDATE op_queue SET status=\'PENDING\', next_attempt_at=?, last_error=?, updated_at=? WHERE op_id=?',
      [backoff(op.attempts), `network: ${networkMessage(error)}`, nowIso(), op.op_id],
    );
  }
}

async function onAuthFailure(db: MobileSqlAdapter, ops: OpQueueRow[]): Promise<void> {
  for (const op of ops) {
    await db.execute(
      'UPDATE op_queue SET status=\'PENDING\', last_error=\'401 — re-auth required\', updated_at=? WHERE op_id=?',
      [nowIso(), op.op_id],
    );
  }
}

async function onSchemaReject(db: MobileSqlAdapter, ops: OpQueueRow[], response: BatchResponse): Promise<void> {
  for (const op of ops) {
    await db.execute(
      'UPDATE op_queue SET status=\'PENDING\', last_error=?, updated_at=? WHERE op_id=?',
      [`BATCH_REJECTED_SCHEMA min=${response.minSchemaVersion}`, nowIso(), op.op_id],
    );
  }
  await db.execute('INSERT OR REPLACE INTO app_meta (k,v) VALUES (\'upgrade_required\',\'1\')');
}

export function useSyncEngine() {
  async function readyOps(): Promise<OpQueueRow[]> {
    return readyOpsFromDb(requireDb());
  }

  async function queueSummary(): Promise<Record<string, number>> {
    return queueSummaryFromDb(requireDb());
  }

  async function cursor(): Promise<string | null> {
    return cursorFromDb(requireDb());
  }

  async function reconcileConflicts(): Promise<number> {
    const db = requireDb();
    const conflicts = await db.select<OpQueueRow>('SELECT * FROM op_queue WHERE status=\'CONFLICT\'');

    for (const op of conflicts) {
      const newBase = op.server_version;
      await db.execute(
        'UPDATE op_queue SET base_version=?, status=\'PENDING\', next_attempt_at=NULL, updated_at=? WHERE op_id=?',
        [newBase, nowIso(), op.op_id],
      );
      await setEntityState(db, op.entity, op.entity_id, 'PENDING', null);
    }

    return conflicts.length;
  }

  async function syncOnce(transport: SyncTransport, auth?: SyncAuth): Promise<SyncOnceResult> {
    const db = requireDb();
    const userId = currentUserId(auth);
    const ops = await readyOpsFromDb(db);
    if (ops.length === 0) return { pushed: 0 };

    const req = {
      schemaVersion: ops[0].schema_version,
      ops: ops.map((op) => ({
        opId: op.op_id,
        entity: op.entity,
        action: op.action,
        entityId: op.entity_id,
        jobOrderId: op.job_order_id,
        payload: JSON.parse(op.payload_json) as Record<string, unknown>,
        baseVersion: op.base_version,
        actorId: userId,
      })),
    };

    await markSyncing(db, ops);

    let response: BatchResponse;
    try {
      response = await transport.batch(req, auth);
    } catch (error) {
      await onNetworkFailure(db, ops, error);
      return { pushed: 0, networkError: true };
    }

    if (response.httpStatus === 401) {
      await onAuthFailure(db, ops);
      return { pushed: 0, authRequired: true };
    }

    if (response.batchStatus === 'BATCH_REJECTED_SCHEMA') {
      await onSchemaReject(db, ops, response);
      return { pushed: 0, upgradeRequired: true };
    }

    for (const result of response.results) await applyResult(db, result);

    try {
      const pull = await transport.assigned(await assignedPullQuery(db), auth);
      if (pull.httpStatus === 200) await applyPull(db, pull.changes, pull.cursor);
    } catch {
      // Pull is best-effort; pushed ops have already been settled.
    }

    return { pushed: response.results.length, results: response.results };
  }

  return {
    syncOnce,
    reconcileConflicts,
    readyOps,
    queueSummary,
    cursor,
  };
}
