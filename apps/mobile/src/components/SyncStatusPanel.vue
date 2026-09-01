<script setup lang="ts">
import Card from 'primevue/card';
import Dialog from 'primevue/dialog';
import Message from 'primevue/message';
import ProgressSpinner from 'primevue/progressspinner';
import Tag from 'primevue/tag';
import { defineStore } from 'pinia';
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { createSyncTransport, currentSyncAuth, syncResultHasVersionConflict, useSyncEngine } from '../composables/useSyncEngine';
import { useOfflineExecution } from '../composables/useOfflineExecution';

type QueueStatus = 'PENDING' | 'SYNCING' | 'SYNCED' | 'CONFLICT' | 'ERROR' | 'FLAGGED';
type BucketKey = 'pending' | 'syncing' | 'synced' | 'retry' | 'flagged';

interface OpQueueRow {
  seq: number;
  op_id: string;
  entity: string;
  action: string;
  entity_id: string;
  job_order_id: string;
  payload_json: string;
  status: QueueStatus;
  attempts: number;
  next_attempt_at: string | null;
  server_version: number | null;
  result_ref: string | null;
  last_error: string | null;
  blocks_on_op: string | null;
  created_at: string;
  updated_at: string;
  jo_number: string | null;
}

interface MobileSqlAdapter {
  select<T>(sql: string, params?: unknown[]): Promise<T[]>;
}

interface MobileRuntime {
  marinex360?: {
    db?: MobileSqlAdapter;
  };
}

interface BucketDefinition {
  key: BucketKey;
  title: string;
  statusLabel: string;
  match(row: OpQueueRow): boolean;
}

const emit = defineEmits<{
  queueChanged: [];
}>();

const syncEngine = useSyncEngine();
const offlineExecution = useOfflineExecution();
const isSyncing = ref(false);

const QUEUE_SQL = `
  SELECT q.seq, q.op_id, q.entity, q.action, q.entity_id, q.job_order_id,
         q.payload_json, q.status, q.attempts, q.next_attempt_at,
         q.server_version, q.result_ref, q.last_error, q.blocks_on_op,
         q.created_at, q.updated_at, jo.jo_number
  FROM op_queue q
  LEFT JOIN jo_cache jo ON jo.id = q.job_order_id
  WHERE q.status IN ('PENDING','SYNCING','SYNCED','CONFLICT','ERROR','FLAGGED')
  ORDER BY
    CASE q.status
      WHEN 'CONFLICT' THEN 1
      WHEN 'ERROR' THEN 1
      WHEN 'FLAGGED' THEN 2
      WHEN 'SYNCING' THEN 3
      WHEN 'PENDING' THEN 4
      WHEN 'SYNCED' THEN 5
      ELSE 6
    END,
    q.created_at ASC,
    q.seq ASC
`;

const RECENT_SYNCED_MS = 10 * 60 * 1000;
const REFRESH_MS = 5000;

const buckets: BucketDefinition[] = [
  { key: 'pending', title: 'Queued', statusLabel: 'Queued', match: (row) => row.status === 'PENDING' },
  { key: 'syncing', title: 'Sending...', statusLabel: 'Sending...', match: (row) => row.status === 'SYNCING' },
  { key: 'synced', title: 'Synced', statusLabel: 'Synced', match: (row) => row.status === 'SYNCED' && isRecentlySynced(row) },
  { key: 'retry', title: 'Retry needed', statusLabel: 'Retry needed', match: (row) => row.status === 'CONFLICT' || row.status === 'ERROR' },
  { key: 'flagged', title: 'Sent (pending review)', statusLabel: 'Sent (pending review)', match: (row) => row.status === 'FLAGGED' },
];

// NEEDS: Mobile sync engine should expose an importable manual-sync trigger before this panel adds a retry button.

function mobileRuntime(): MobileRuntime {
  return globalThis as typeof globalThis & MobileRuntime;
}

function db(): MobileSqlAdapter | null {
  return mobileRuntime().marinex360?.db ?? null;
}

function isRecentlySynced(row: OpQueueRow): boolean {
  const settledAt = Date.parse(row.updated_at || row.created_at);
  return Number.isFinite(settledAt) && Date.now() - settledAt <= RECENT_SYNCED_MS;
}

function parsePayload(row: OpQueueRow): Record<string, unknown> {
  try {
    const value = JSON.parse(row.payload_json);
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function stringField(payload: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }

  return null;
}

function humanEntity(entity: string): string {
  const names: Record<string, string> = {
    WorkLog: 'Work log',
    Photo: 'Photo',
    Observation: 'Observation',
    ChecklistInstance: 'Checklist',
    MaterialLine: 'Material line',
    ESignature: 'E-signature',
    JobOrder: 'Job order',
  };

  return names[entity] ?? entity.replace(/([a-z])([A-Z])/g, '$1 $2');
}

function humanStatus(status: QueueStatus): string {
  return status.toLowerCase().replace(/_/g, ' ').replace(/^\w/, (letter) => letter.toUpperCase());
}

function rowSummary(row: OpQueueRow): string {
  const payload = parsePayload(row);
  const job = row.jo_number ?? 'Job pending';

  if (row.entity === 'MaterialLine') return stringField(payload, 'description') ?? `${job} material line`;
  if (row.entity === 'Observation') return stringField(payload, 'body') ?? `${job} observation`;
  if (row.entity === 'WorkLog') return `${job} work log`;
  if (row.entity === 'Photo') return stringField(payload, 'phase') ?? `${job} photo`;
  if (row.entity === 'ChecklistInstance') return stringField(payload, 'templateId', 'template_id') ?? `${job} checklist`;
  if (row.entity === 'ESignature') return stringField(payload, 'signerName', 'signer_name') ?? `${job} signature`;

  return `${job} ${row.action.toLowerCase()}`;
}

function queuedFor(row: OpQueueRow): string {
  const queuedAt = Date.parse(row.created_at);
  if (!Number.isFinite(queuedAt)) return 'Queued';

  const seconds = Math.max(0, Math.floor((Date.now() - queuedAt) / 1000));
  if (seconds < 60) return 'Just now';

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;

  const days = Math.floor(hours / 24);
  return `${days}d`;
}

function plainError(row: OpQueueRow): string {
  const raw = row.last_error?.trim();
  if (!raw) return 'No additional detail was recorded.';

  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed === 'string') return errorDetailCopy(parsed) || humanStatusText(parsed);
    if (parsed && typeof parsed === 'object') {
      const record = parsed as Record<string, unknown>;
      const code = typeof record.code === 'string' ? record.code : null;
      const status = typeof record.status === 'string' ? record.status : null;
      const message = typeof record.message === 'string' ? record.message : null;

      if (code === 'FORBIDDEN' && message) return humanStatusText(message);
      if (status === 'FORBIDDEN' && message) return humanStatusText(message);
      if (code) return errorDetailCopy(code);
      if (status) return errorDetailCopy(status);
      return message ? humanStatusText(message) : 'Retry needed';
    }
  } catch {
    return errorDetailCopy(raw) || humanStatusText(raw);
  }

  return errorDetailCopy(raw) || humanStatusText(raw);
}

function humanStatusText(value: string): string {
  const trimmed = value.trim();
  if (/^[A-Z0-9_ -]+$/.test(trimmed)) {
    return trimmed.toLowerCase().replace(/[_-]/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
  }

  return trimmed;
}

function errorShortLabel(status: string): string {
  const normalized = status.trim();

  switch (normalized) {
    case 'NOT_FOUND':
      return 'Job or record no longer available';
    case 'BRANCH_SCOPE_DENIED':
      return 'Job access changed';
    case 'STATE_TRANSITION_INVALID':
      return 'Job status changed';
    case 'VALIDATION_ERROR':
    case 'VERSION_CONFLICT':
      return 'Retry needed';
    case 'FORBIDDEN':
      return 'Permission issue';
    default:
      return 'Retry needed';
  }
}

function errorDetailCopy(status: string): string {
  const normalized = status.trim();

  switch (normalized) {
    case 'VALIDATION_ERROR':
    case 'VERSION_CONFLICT':
      return 'Retry needed';
    case 'FORBIDDEN':
      return 'You do not have permission to perform this action.';
    case 'UNAUTHORIZED':
      return 'Your session is no longer authorised to sync this change. Please sign back in and try again.';
    case 'NOT_FOUND':
      return 'saved work is still on this device';
    case 'BRANCH_SCOPE_DENIED':
      return 'contact your supervisor';
    case 'STATE_TRANSITION_INVALID':
      return 'the job changed while you were offline';
    default:
      return 'Retry needed';
  }
}

function rawTechnicalError(row: OpQueueRow | null): string {
  if (!row) return 'No technical detail recorded.';
  const raw = row.last_error?.trim();
  return raw && raw.length > 0 ? raw : 'No technical detail recorded.';
}

function rowTitle(row: OpQueueRow): string {
  if (row.status === 'ERROR') {
    const raw = row.last_error?.trim();
    if (!raw) return 'Retry needed';

    try {
      const parsed = JSON.parse(raw);
      if (typeof parsed === 'string') return errorShortLabel(parsed);
      if (parsed && typeof parsed === 'object') {
        const record = parsed as Record<string, unknown>;
        const code = typeof record.code === 'string' ? record.code : null;
        const status = typeof record.status === 'string' ? record.status : null;
        return errorShortLabel(code ?? status ?? 'ERROR');
      }
    } catch {
      return errorShortLabel(raw);
    }

    return errorShortLabel(raw);
  }

  return `${humanEntity(row.entity)} ${humanStatus(row.status)}`;
}

function isRetryRow(row: OpQueueRow): boolean {
  return row.status === 'CONFLICT' || row.status === 'ERROR';
}

const useSyncStatusPanelStore = defineStore('syncStatusPanel', () => {
  const rows = ref<OpQueueRow[]>([]);
  const isLoading = ref(false);
  const errorMessage = ref<string | null>(null);

  const visibleRows = computed(() => rows.value.filter((row) => row.status !== 'SYNCED' || isRecentlySynced(row)));
  const groupedRows = computed(() => buckets
    .map((bucket) => ({
      ...bucket,
      rows: visibleRows.value.filter(bucket.match).slice(0, bucket.key === 'synced' ? 5 : undefined),
    }))
    .filter((bucket) => bucket.rows.length > 0));

  async function loadQueue(): Promise<void> {
    const adapter = db();
    if (!adapter) {
      rows.value = [];
      errorMessage.value = 'Sync queue is not available on this device.';
      return;
    }

    isLoading.value = true;
    errorMessage.value = null;

    try {
      rows.value = await adapter.select<OpQueueRow>(QUEUE_SQL);
    } catch (error) {
      rows.value = [];
      errorMessage.value = error instanceof Error ? error.message : 'Unable to load sync queue.';
    } finally {
      isLoading.value = false;
    }
  }

  return {
    rows,
    visibleRows,
    groupedRows,
    isLoading,
    errorMessage,
    loadQueue,
  };
});

const syncStatusStore = useSyncStatusPanelStore();
const selectedErrorRow = ref<OpQueueRow | null>(null);
const errorDialogVisible = computed({
  get: () => selectedErrorRow.value != null,
  set: (visible: boolean) => {
    if (!visible) selectedErrorRow.value = null;
  },
});
let refreshTimer: number | null = null;

function showError(row: OpQueueRow): void {
  if (!isRetryRow(row)) return;
  selectedErrorRow.value = row;
}

async function refreshQueue(): Promise<void> {
  await syncStatusStore.loadQueue();
  emit('queueChanged');
}

async function runManualSync(): Promise<void> {
  if (isSyncing.value) return;

  isSyncing.value = true;
  try {
    await offlineExecution.drainBinaryUploads();
    const result = await syncEngine.syncOnce(createSyncTransport(), currentSyncAuth());
    if (syncResultHasVersionConflict(result)) await syncEngine.reconcileConflicts();
    await refreshQueue();
  } catch {
    await refreshQueue();
  } finally {
    isSyncing.value = false;
  }
}

onMounted(() => {
  void refreshQueue();

  if (typeof window !== 'undefined') {
    refreshTimer = window.setInterval(() => {
      void refreshQueue();
    }, REFRESH_MS);
  }
});

onBeforeUnmount(() => {
  if (refreshTimer != null && typeof window !== 'undefined') window.clearInterval(refreshTimer);
});
</script>

<template>
  <section class="sync-panel" aria-labelledby="sync-panel-title">
    <header class="sync-panel__header">
      <div>
        <p class="sync-panel__eyebrow">Device queue</p>
        <h2 id="sync-panel-title" class="sync-panel__title">Sync status</h2>
      </div>
      <button
        type="button"
        class="sync-panel__sync-button"
        :disabled="isSyncing"
        aria-label="Sync queued operations now"
        @click="runManualSync"
      >
        {{ isSyncing ? 'Syncing…' : 'Sync now' }}
      </button>
    </header>

    <Message v-if="syncStatusStore.errorMessage" severity="error" :closable="false">
      {{ syncStatusStore.errorMessage }}
    </Message>

    <div v-if="syncStatusStore.isLoading && syncStatusStore.visibleRows.length === 0" class="sync-panel__loading" aria-live="polite">
      <ProgressSpinner class="sync-panel__spinner" stroke-width="4" />
    </div>

    <template v-else-if="syncStatusStore.groupedRows.length > 0">
      <section
        v-for="bucket in syncStatusStore.groupedRows"
        :key="bucket.key"
        class="sync-panel__bucket"
        :class="`sync-panel__bucket--${bucket.key}`"
        :aria-labelledby="`sync-panel-${bucket.key}`"
      >
        <header class="sync-panel__bucket-header">
          <h3 :id="`sync-panel-${bucket.key}`" class="sync-panel__bucket-title">{{ bucket.title }}</h3>
          <Tag class="sync-panel__bucket-count" :value="String(bucket.rows.length)" />
        </header>

        <div class="sync-panel__rows">
          <Card v-for="row in bucket.rows" :key="row.op_id" class="sync-panel__card">
            <template #content>
              <button
                type="button"
                class="sync-panel__row"
                :class="{ 'sync-panel__row--actionable': isRetryRow(row) }"
                :aria-label="isRetryRow(row) ? `Open sync error for ${humanEntity(row.entity)}` : undefined"
                @click="showError(row)"
              >
                <span class="sync-panel__row-main">
                  <span class="sync-panel__entity">{{ humanEntity(row.entity) }}</span>
                  <span class="sync-panel__summary">{{ rowSummary(row) }}</span>
                </span>

                <span class="sync-panel__row-side">
                  <span class="sync-panel__status">{{ bucket.statusLabel }}</span>
                  <time :datetime="row.created_at">{{ queuedFor(row) }}</time>
                </span>
              </button>
            </template>
          </Card>
        </div>
      </section>
    </template>

    <p v-else class="sync-panel__empty">Sync queue is clear.</p>

    <Dialog
      v-model:visible="errorDialogVisible"
      modal
      dismissable-mask
      :header="selectedErrorRow ? rowTitle(selectedErrorRow) : 'Retry needed'"
      class="sync-panel__error-dialog"
    >
      <div v-if="selectedErrorRow" class="sync-panel__error-detail">
        <p class="sync-panel__error-title">{{ rowTitle(selectedErrorRow) }}</p>
        <p class="sync-panel__error-message">{{ plainError(selectedErrorRow) }}</p>
        <details class="sync-panel__technical-detail">
          <summary>Technical details</summary>
          <code>{{ rawTechnicalError(selectedErrorRow) }}</code>
        </details>
      </div>
    </Dialog>
  </section>
</template>

<style scoped>
.sync-panel {
  display: grid;
  gap: var(--sp-4);
  color: var(--color-text);
  font-family: var(--font-ui);
}

.sync-panel__header,
.sync-panel__bucket-header,
.sync-panel__row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--sp-3);
}

.sync-panel__sync-button {
  min-height: var(--tap-min);
  min-width: var(--tap-min);
  padding: 0 var(--sp-3);
  border: var(--border-1);
  border-radius: var(--radius-md);
  background: var(--color-brand);
  color: var(--color-surface);
  font: inherit;
  font-weight: var(--fw-semibold);
  cursor: pointer;
}

.sync-panel__sync-button:disabled {
  opacity: 0.7;
  cursor: wait;
}

.sync-panel__eyebrow {
  margin: 0 0 var(--sp-1);
  color: var(--color-text-muted);
  font-size: var(--fs-body-sm);
  font-weight: var(--fw-semibold);
}

.sync-panel__title,
.sync-panel__bucket-title {
  margin: 0;
  font-weight: var(--fw-semibold);
  line-height: var(--lh-tight);
}

.sync-panel__title {
  font-size: var(--fs-h2);
}

.sync-panel__bucket {
  display: grid;
  gap: var(--sp-3);
}

.sync-panel__bucket-title {
  font-size: var(--fs-h3);
}

.sync-panel__bucket-count {
  min-width: var(--tap-min);
}

.sync-panel__rows {
  display: grid;
  gap: var(--tap-gap);
}

.sync-panel__card {
  overflow: hidden;
  border: var(--border-1);
  border-radius: var(--radius-md);
  background: var(--color-surface);
}

.sync-panel__bucket--pending .sync-panel__card {
  border-color: var(--jo-draft-fg);
}

.sync-panel__bucket--syncing .sync-panel__card {
  border-color: var(--jo-scheduled-fg);
}

.sync-panel__bucket--synced .sync-panel__card {
  border-color: var(--jo-completed-fg);
}

.sync-panel__bucket--retry .sync-panel__card {
  border-color: var(--status-error-br);
  background: var(--status-error-bg);
}

.sync-panel__bucket--flagged .sync-panel__card {
  border-color: var(--jo-review-fg);
  background: var(--jo-review-bg);
}

.sync-panel__row {
  width: 100%;
  min-height: var(--tap-field);
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
}

.sync-panel__row--actionable {
  cursor: pointer;
}

.sync-panel__row:focus-visible {
  outline: var(--border-2);
  outline-offset: var(--sp-1);
}

.sync-panel__row-main,
.sync-panel__row-side {
  display: grid;
  gap: var(--sp-1);
}

.sync-panel__row-main {
  min-width: 0;
}

.sync-panel__row-side {
  flex: 0 0 auto;
  justify-items: end;
  max-width: 42%;
  color: var(--color-text-muted);
  font-size: var(--fs-body-sm);
  line-height: var(--lh-base);
  text-align: right;
}

.sync-panel__entity {
  color: var(--color-text);
  font-size: var(--fs-body);
  font-weight: var(--fw-semibold);
  line-height: var(--lh-base);
}

.sync-panel__summary {
  display: -webkit-box;
  overflow: hidden;
  color: var(--color-text-muted);
  font-size: var(--fs-body-sm);
  line-height: var(--lh-base);
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 1;
}

.sync-panel__status {
  font-weight: var(--fw-semibold);
}

.sync-panel__loading {
  display: grid;
  min-height: var(--tap-field);
  place-items: center;
  padding: var(--sp-6);
}

.sync-panel__spinner {
  width: var(--tap-min);
  height: var(--tap-min);
}

.sync-panel__empty,
.sync-panel__error-detail {
  margin: 0;
  padding: var(--sp-3) var(--sp-4);
  border: var(--border-1);
  border-radius: var(--radius-md);
  background: var(--color-surface);
  color: var(--color-text-muted);
  font-size: var(--fs-body);
  line-height: var(--lh-base);
}

.sync-panel__error-dialog {
  width: calc(100vw - var(--sp-8));
  max-width: calc(var(--tap-field) * 10);
}

.sync-panel__error-title {
  margin: 0 0 var(--sp-2);
  color: var(--color-text);
  font-weight: var(--fw-semibold);
}

.sync-panel__error-message {
  margin: 0;
  color: var(--color-text);
  overflow-wrap: anywhere;
}

.sync-panel__technical-detail {
  margin-top: var(--sp-3);
  padding-top: var(--sp-2);
  border-top: var(--border-1);
  color: var(--color-text-muted);
  font-size: var(--fs-body-sm);
}

.sync-panel__technical-detail summary {
  cursor: pointer;
  font-weight: var(--fw-semibold);
}

.sync-panel__technical-detail code {
  display: block;
  margin-top: var(--sp-2);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font-family: var(--font-mono, monospace);
}

@media (min-width: 720px) {
  .sync-panel__rows {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
