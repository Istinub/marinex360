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
  clientId?: string | null;
  vesselId?: string | null;
  vendorId?: string | null;
  isSubcontracted?: boolean;
  state: JobState;
  scopeSummary: string;
  port?: string | null;
  serviceCategories?: string[];
  plannedStartDate?: string | null;
  deadline?: string | null;
  quotedCurrency?: string | null;
  labourRateAmountMinor?: number | null;
  labourRateCurrency?: string | null;
  assignedTechnicianIds?: string[];
  executionOwnerId?: string | null;
  version: number;
  visible?: boolean;
  canOpen?: boolean;
  readOnly?: boolean;
  canStart?: boolean;
  canResume?: boolean;
  clientName?: string | null;
  vesselName?: string | null;
  imoNumber?: string | null;
  client?: NamedRelation | null;
  vessel?: NamedRelation | null;
  checklistItems?: JobOrderChecklistItem[];
}

export interface JobOrderChecklistItem {
  id: string;
  jobOrderId: string;
  label: string;
  sortOrder: number;
  checked: boolean;
  createdAt?: string | null;
  updatedAt?: string | null;
}

interface JoCacheRow {
  id: string;
  jo_number: string;
  branch: string | null;
  client_id: string | null;
  vessel_id: string | null;
  vendor_id: string | null;
  is_subcontracted: number | null;
  state: JobState;
  scope_summary: string | null;
  port: string | null;
  service_categories: string | null;
  execution_owner_id: string | null;
  assigned_technician_ids: string | null;
  planned_start_date: string | null;
  deadline: string | null;
  quoted_currency: string | null;
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
    clientId: row.client_id,
    vesselId: row.vessel_id,
    vendorId: row.vendor_id,
    isSubcontracted: row.is_subcontracted === 1,
    state: row.state,
    scopeSummary: row.scope_summary ?? '',
    port: row.port,
    serviceCategories: parseJsonArray(row.service_categories),
    executionOwnerId: row.execution_owner_id,
    assignedTechnicianIds,
    plannedStartDate: row.planned_start_date,
    deadline: row.deadline,
    quotedCurrency: row.quoted_currency,
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
    `SELECT id, jo_number, branch, client_id, vessel_id, vendor_id, is_subcontracted, state, scope_summary, port, service_categories,
            execution_owner_id, assigned_technician_ids, planned_start_date, deadline,
            quoted_currency, labour_rate_amount_minor, labour_rate_currency, version,
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
    `SELECT id, jo_number, branch, client_id, vessel_id, vendor_id, is_subcontracted, state, scope_summary, port, service_categories,
            execution_owner_id, assigned_technician_ids, planned_start_date, deadline,
            quoted_currency, labour_rate_amount_minor, labour_rate_currency, version,
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
      (id, jo_number, branch, client_id, vessel_id, vendor_id, is_subcontracted, client_name, vessel_name, imo_number, port, scope_summary,
       service_categories, state, execution_owner_id, assigned_technician_ids,
       planned_start_date, deadline, quoted_currency, labour_rate_amount_minor, labour_rate_currency, version,
       header_locked, pulled_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       jo_number=excluded.jo_number,
       branch=excluded.branch,
       client_id=excluded.client_id,
       vessel_id=excluded.vessel_id,
       vendor_id=excluded.vendor_id,
       is_subcontracted=excluded.is_subcontracted,
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
       deadline=excluded.deadline,
       quoted_currency=excluded.quoted_currency,
       labour_rate_amount_minor=excluded.labour_rate_amount_minor,
       labour_rate_currency=excluded.labour_rate_currency,
       version=excluded.version,
       header_locked=excluded.header_locked,
       pulled_at=excluded.pulled_at`,
    [
      job.id,
      job.joNumber,
      jobBranch(job),
      job.clientId ?? null,
      job.vesselId ?? null,
      job.vendorId ?? null,
      job.isSubcontracted ? 1 : 0,
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
      job.deadline ?? null,
      job.quotedCurrency ?? null,
      job.labourRateAmountMinor ?? 9000,
      job.labourRateCurrency ?? 'SGD',
      job.version,
      ['IN_PROGRESS', 'PENDING_REVIEW', 'COMPLETED', 'INVOICED', 'CLOSED'].includes(job.state) ? 1 : 0,
      nowIso(),
    ],
  );

  if (Array.isArray(job.checklistItems)) {
    await cacheJobOrderChecklistItems(job.id, job.checklistItems);
  }
}

export async function cacheAssignedJobOrders(jobs: MobileJobOrder[]): Promise<void> {
  for (const job of jobs) {
    if (job.canOpen !== false) await cacheJobOrder(job);
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

export async function loadJobOrderChecklistItems(jobOrderId: string): Promise<JobOrderChecklistItem[]> {
  try {
    const response = await authenticatedFetch(`${apiBase()}/job-orders/${jobOrderId}/checklist-items`, {
      headers: { Accept: 'application/json' },
    });
    const items = await jsonResponse<JobOrderChecklistItem[]>(response);
    await cacheJobOrderChecklistItems(jobOrderId, items);
    return items;
  } catch (error) {
    if (typeof navigator !== 'undefined' && !navigator.onLine) return loadCachedJobOrderChecklistItems(jobOrderId);
    throw error;
  }
}

export async function updateJobOrderChecklistItem(jobOrderId: string, itemId: string, checked: boolean): Promise<JobOrderChecklistItem> {
  const response = await authenticatedFetch(`${apiBase()}/job-orders/${jobOrderId}/checklist-items/${itemId}`, {
    method: 'PATCH',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ checked }),
  });
  const updated = await jsonResponse<JobOrderChecklistItem>(response);
  await cacheJobOrderChecklistItems(jobOrderId, [updated]);
  return updated;
}

export async function cacheJobOrderChecklistItems(jobOrderId: string, items: JobOrderChecklistItem[]): Promise<void> {
  const adapter = db();
  if (!adapter) return;

  const pulledAt = nowIso();
  for (const item of items) {
    await adapter.execute(
      `INSERT INTO job_order_checklist_item_cache
        (id, job_order_id, label, sort_order, checked, created_at, updated_at, pulled_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         job_order_id=excluded.job_order_id,
         label=excluded.label,
         sort_order=excluded.sort_order,
         checked=excluded.checked,
         created_at=excluded.created_at,
         updated_at=excluded.updated_at,
         pulled_at=excluded.pulled_at`,
      [
        item.id,
        item.jobOrderId ?? jobOrderId,
        item.label,
        item.sortOrder,
        item.checked ? 1 : 0,
        item.createdAt ?? null,
        item.updatedAt ?? null,
        pulledAt,
      ],
    );
  }
}

async function loadCachedJobOrderChecklistItems(jobOrderId: string): Promise<JobOrderChecklistItem[]> {
  const adapter = db();
  if (!adapter) return [];

  const rows = await adapter.select<{
    id: string;
    job_order_id: string;
    label: string;
    sort_order: number;
    checked: number;
  }>(
    `SELECT id, job_order_id, label, sort_order, checked
     FROM job_order_checklist_item_cache
     WHERE job_order_id=?
     ORDER BY sort_order ASC, label ASC`,
    [jobOrderId],
  );

  return rows.map((row) => ({
    id: row.id,
    jobOrderId: row.job_order_id,
    label: row.label,
    sortOrder: Number(row.sort_order),
    checked: row.checked === 1,
  }));
}
