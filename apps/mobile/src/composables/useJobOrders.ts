import { authenticatedFetch, currentSessionSnapshot } from './useAuth.ts';
import { apiBase, type MobileSqlAdapter } from './useOfflineExecution.ts';

export type JobState =
  | 'DRAFT'
  | 'SCHEDULED'
  | 'IN_PROGRESS'
  | 'PENDING_REVIEW'
  | 'COMPLETED'
  | 'INVOICED'
  | 'CLOSED'
  | 'ON_HOLD'
  | 'CANCELLED';

interface NamedRelation {
  name?: string | null;
  imoNumber?: string | null;
}

export interface MobileJobOrder {
  id: string;
  joNumber: string;
  branch?: string | null;
  state: JobState;
  scopeSummary: string;
  port?: string | null;
  serviceCategories?: string[];
  plannedStartDate?: string | null;
  labourRateAmountMinor?: number | null;
  labourRateCurrency?: string | null;
  assignedTechnicianIds?: string[];
  executionOwnerId?: string | null;
  version: number;
  visible?: boolean;
  isAvailable?: boolean;
  canOpen?: boolean;
  readOnly?: boolean;
  canStart?: boolean;
  canResume?: boolean;
  clientName?: string | null;
  vesselName?: string | null;
  imoNumber?: string | null;
  client?: NamedRelation | null;
  vessel?: NamedRelation | null;
}

interface JoCacheRow {
  id: string;
  jo_number: string;
  branch: string | null;
  state: JobState;
  scope_summary: string | null;
  port: string | null;
  service_categories: string | null;
  execution_owner_id: string | null;
  assigned_technician_ids: string | null;
  planned_start_date: string | null;
  labour_rate_amount_minor: number | null;
  labour_rate_currency: string | null;
  version: number;
  client_name: string | null;
  vessel_name: string | null;
  imo_number: string | null;
}

interface MobileRuntime {
  marinex360?: {
    db?: MobileSqlAdapter;
  };
}

class MobileApiError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly body: unknown;

  constructor(response: Response, body: unknown) {
    const message = (body as { error?: { message?: string } })?.error?.message ?? `Request failed (${response.status}).`;
    super(message);
    this.name = 'MobileApiError';
    this.status = response.status;
    this.code = (body as { error?: { code?: string } })?.error?.code;
    this.body = body;
  }
}

function mobileRuntime(): MobileRuntime {
  return globalThis as typeof globalThis & MobileRuntime;
}

function db(): MobileSqlAdapter | null {
  return mobileRuntime().marinex360?.db ?? null;
}

function nowIso(): string {
  return new Date().toISOString();
}

function relationName(job: MobileJobOrder, key: 'client' | 'vessel'): string | null {
  if (key === 'client') return job.clientName ?? job.client?.name ?? null;
  return job.vesselName ?? job.vessel?.name ?? null;
}

function jobBranch(job: MobileJobOrder): string {
  return job.branch ?? currentSessionSnapshot()?.branch ?? 'UNKNOWN';
}

function parseJsonArray(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

export function fromCacheRow(row: JoCacheRow): MobileJobOrder {
  const currentUserId = currentSessionSnapshot()?.userId ?? null;
  const assignedTechnicianIds = parseJsonArray(row.assigned_technician_ids);
  return {
    id: row.id,
    joNumber: row.jo_number,
    branch: row.branch,
    state: row.state,
    scopeSummary: row.scope_summary ?? '',
    port: row.port,
    serviceCategories: parseJsonArray(row.service_categories),
    executionOwnerId: row.execution_owner_id,
    assignedTechnicianIds,
    plannedStartDate: row.planned_start_date,
    labourRateAmountMinor: row.labour_rate_amount_minor,
    labourRateCurrency: row.labour_rate_currency,
    version: row.version,
    clientName: row.client_name,
    vesselName: row.vessel_name,
    imoNumber: row.imo_number,
    canOpen: row.execution_owner_id == null || row.execution_owner_id === currentUserId || (currentUserId ? assignedTechnicianIds.includes(currentUserId) : false),
  };
}

export async function loadCachedJobOrders(): Promise<MobileJobOrder[]> {
  const adapter = db();
  if (!adapter) return [];

  const rows = await adapter.select<JoCacheRow>(
    `SELECT id, jo_number, branch, state, scope_summary, port, service_categories,
            execution_owner_id, assigned_technician_ids, planned_start_date,
            labour_rate_amount_minor, labour_rate_currency, version,
            client_name, vessel_name, imo_number
     FROM jo_cache
     ORDER BY planned_start_date IS NULL, planned_start_date ASC, jo_number ASC`,
  );
  return rows.map(fromCacheRow);
}

export async function loadCachedJobOrder(id: string): Promise<MobileJobOrder | null> {
  const adapter = db();
  if (!adapter) return null;

  const rows = await adapter.select<JoCacheRow>(
    `SELECT id, jo_number, branch, state, scope_summary, port, service_categories,
            execution_owner_id, assigned_technician_ids, planned_start_date,
            labour_rate_amount_minor, labour_rate_currency, version,
            client_name, vessel_name, imo_number
     FROM jo_cache
     WHERE id=?`,
    [id],
  );
  return rows[0] ? fromCacheRow(rows[0]) : null;
}

export async function cacheJobOrder(job: MobileJobOrder): Promise<void> {
  const adapter = db();
  if (!adapter) return;

  await adapter.execute(
    `INSERT INTO jo_cache
      (id, jo_number, branch, client_name, vessel_name, imo_number, port, scope_summary,
       service_categories, state, execution_owner_id, assigned_technician_ids,
       planned_start_date, labour_rate_amount_minor, labour_rate_currency, version,
       header_locked, pulled_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       jo_number=excluded.jo_number,
       branch=excluded.branch,
       client_name=excluded.client_name,
       vessel_name=excluded.vessel_name,
       imo_number=excluded.imo_number,
       port=excluded.port,
       scope_summary=excluded.scope_summary,
       service_categories=excluded.service_categories,
       state=excluded.state,
       execution_owner_id=excluded.execution_owner_id,
       assigned_technician_ids=excluded.assigned_technician_ids,
       planned_start_date=excluded.planned_start_date,
       labour_rate_amount_minor=excluded.labour_rate_amount_minor,
       labour_rate_currency=excluded.labour_rate_currency,
       version=excluded.version,
       header_locked=excluded.header_locked,
       pulled_at=excluded.pulled_at`,
    [
      job.id,
      job.joNumber,
      jobBranch(job),
      relationName(job, 'client'),
      relationName(job, 'vessel'),
      job.imoNumber ?? job.vessel?.imoNumber ?? null,
      job.port ?? null,
      job.scopeSummary ?? null,
      JSON.stringify(job.serviceCategories ?? []),
      job.state,
      job.executionOwnerId ?? null,
      JSON.stringify(job.assignedTechnicianIds ?? []),
      job.plannedStartDate ?? null,
      job.labourRateAmountMinor ?? 9000,
      job.labourRateCurrency ?? 'SGD',
      job.version,
      ['IN_PROGRESS', 'PENDING_REVIEW', 'COMPLETED', 'INVOICED', 'CLOSED'].includes(job.state) ? 1 : 0,
      nowIso(),
    ],
  );
}

export async function cacheAssignedJobOrders(jobs: MobileJobOrder[]): Promise<void> {
  for (const job of jobs) {
    if (!job.isAvailable && job.canOpen !== false) await cacheJobOrder(job);
  }
}

async function jsonResponse<T>(response: Response): Promise<T> {
  const body = await response.json() as T;
  if (!response.ok) {
    throw new MobileApiError(response, body);
  }
  return body;
}

export async function loadLiveJobOrders(): Promise<MobileJobOrder[]> {
  const response = await authenticatedFetch(`${apiBase()}/job-orders`, {
    headers: { Accept: 'application/json' },
  });
  const jobs = await jsonResponse<MobileJobOrder[]>(response);
  await cacheAssignedJobOrders(jobs);
  return jobs;
}

export async function loadLiveJobOrder(id: string): Promise<MobileJobOrder> {
  const response = await authenticatedFetch(`${apiBase()}/job-orders/${id}`, {
    headers: { Accept: 'application/json' },
  });
  const job = await jsonResponse<MobileJobOrder>(response);
  await cacheJobOrder(job);
  return job;
}

function isSelfAssignable(job: MobileJobOrder): boolean {
  return job.state === 'SCHEDULED' && job.executionOwnerId == null;
}

async function postSelfAssign(job: MobileJobOrder): Promise<MobileJobOrder> {
  const response = await authenticatedFetch(`${apiBase()}/job-orders/${job.id}/self-assign`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ version: job.version }),
  });
  const updated = await jsonResponse<MobileJobOrder>(response);
  await cacheJobOrder(updated);
  return { ...updated, isAvailable: false };
}

export async function selfAssignJobOrder(job: MobileJobOrder): Promise<MobileJobOrder> {
  try {
    return await postSelfAssign(job);
  } catch (error) {
    if (!(error instanceof MobileApiError) || error.code !== 'VERSION_CONFLICT') throw error;

    const refreshed = await loadLiveJobOrder(job.id);
    if (!isSelfAssignable(refreshed)) {
      throw new Error('This job is no longer available for self-assignment.');
    }

    return postSelfAssign({ ...refreshed, isAvailable: true });
  }
}

export async function transitionJobOrder(job: MobileJobOrder, to: JobState, reason?: string): Promise<MobileJobOrder> {
  const response = await authenticatedFetch(`${apiBase()}/job-orders/${job.id}/transition`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ to, version: job.version, ...(reason?.trim() ? { reason: reason.trim() } : {}) }),
  });
  const updated = await jsonResponse<MobileJobOrder>(response);
  await cacheJobOrder(updated);
  return updated;
}
