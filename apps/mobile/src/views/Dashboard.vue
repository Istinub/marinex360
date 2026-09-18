<script setup lang="ts">
import ProgressSpinner from 'primevue/progressspinner';
import { computed, onMounted, ref } from 'vue';
import { RouterLink } from 'vue-router';
import { currentSessionSnapshot } from '@/composables/useAuth';
import { jobOrderStateMeta } from '@/composables/useJobOrderStateMeta';
import {
  loadCachedJobOrders,
  loadLiveJobOrders,
  type JobState,
  type MobileJobOrder,
} from '@/composables/useJobOrders';
import { authenticatedFetch } from '@/composables/useAuth';
import { apiBase, type MobileSqlAdapter } from '@/composables/useOfflineExecution.ts';
import { useSyncQueueCount } from '@/composables/useSyncQueueCount';

interface CertificateRow {
  id: string;
  ownerType: string;
  ownerId: string;
  certType: string;
  identifier?: string | null;
  expiresAt: string;
}

interface WorkLogSummaryRow {
  total_ms: number | string | null;
}

interface MobileRuntime {
  marinex360?: {
    db?: MobileSqlAdapter;
  };
}

const STATE_TOKEN: Record<JobState, string> = {
  DRAFT: 'draft',
  SCHEDULED: 'scheduled',
  IN_PROGRESS: 'inprogress',
  PENDING_REVIEW: 'review',
  COMPLETED: 'completed',
  INVOICED: 'invoiced',
  CLOSED: 'closed',
  ON_HOLD: 'onhold',
  CANCELLED: 'cancelled',
};

const jobs = ref<MobileJobOrder[]>([]);
const isLoading = ref(true);
const errorMessage = ref<string | null>(null);
const source = ref<'cache' | 'live' | null>(null);
const weeklyLoggedHours = ref<number | null>(null);
const certificate = ref<CertificateRow | null>(null);
const syncQueue = useSyncQueueCount();
const queuedCount = computed(() => syncQueue.totalActionable.value);
const hasQueuedSync = computed(() => syncQueue.hasQueue.value);

function mobileRuntime(): MobileRuntime {
  return globalThis as typeof globalThis & MobileRuntime;
}

function db(): MobileSqlAdapter | null {
  return mobileRuntime().marinex360?.db ?? null;
}

function startOfToday(): Date {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date;
}

function endOfToday(): Date {
  const date = startOfToday();
  date.setDate(date.getDate() + 1);
  return date;
}

function startOfWeek(): Date {
  const date = startOfToday();
  const day = date.getDay();
  const offset = day === 0 ? 6 : day - 1;
  date.setDate(date.getDate() - offset);
  return date;
}

function isToday(value?: string | null): boolean {
  if (!value) return false;
  const time = new Date(value).getTime();
  return Number.isFinite(time) && time >= startOfToday().getTime() && time < endOfToday().getTime();
}

function canOpenJob(job: MobileJobOrder): boolean {
  return job.canOpen !== false;
}

function relationName(job: MobileJobOrder, key: 'client' | 'vessel'): string {
  if (key === 'client') return job.clientName ?? job.client?.name ?? 'No client on record';
  return job.vesselName ?? job.vessel?.name ?? 'No vessel on record';
}

function greetingForNow(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

function firstName(): string {
  const session = currentSessionSnapshot();
  const displayName = session?.name ?? session?.email ?? '';
  const [first] = displayName.trim().split(/\s+/);
  return first || 'there';
}

function formatDate(value: Date): string {
  return new Intl.DateTimeFormat(undefined, { weekday: 'long', day: 'numeric', month: 'short' }).format(value);
}

function formatTime(value?: string | null): string {
  if (!value) return 'Any time';
  return new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(new Date(value));
}

function formatHours(value: number): string {
  return value.toLocaleString(undefined, { maximumFractionDigits: 1 });
}

function formatCertificateDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(value));
}

function stateStyle(state: JobState): Record<string, string> {
  const token = STATE_TOKEN[state];
  return {
    '--dashboard-state-fg': `var(--jo-${token}-fg)`,
    '--dashboard-state-bg': `var(--jo-${token}-bg)`,
  };
}

function scheduleIncludes(job: MobileJobOrder): boolean {
  return canOpenJob(job) && (isToday(job.plannedStartDate) || job.state === 'IN_PROGRESS');
}

const todaysJobs = computed(() =>
  jobs.value
    .filter(scheduleIncludes)
    .sort((a, b) => {
      const aTime = a.plannedStartDate ? new Date(a.plannedStartDate).getTime() : Number.MAX_SAFE_INTEGER;
      const bTime = b.plannedStartDate ? new Date(b.plannedStartDate).getTime() : Number.MAX_SAFE_INTEGER;
      return aTime - bTime || a.joNumber.localeCompare(b.joNumber);
    }));

const stats = computed(() => [
  { key: 'today', label: 'Today', value: String(todaysJobs.value.length), tone: 'neutral' },
  ...(weeklyLoggedHours.value == null ? [] : [{
    key: 'hours',
    label: 'Logged (wk)',
    value: `${formatHours(weeklyLoggedHours.value)}h`,
    tone: 'neutral',
  }]),
]);

const statsGridClass = computed(() => (stats.value.length <= 2 ? 'dashboard__stats--two' : ''));
const today = computed(() => formatDate(new Date()));
const greeting = computed(() => `${greetingForNow()}, ${firstName()}`);
const scheduleIsScrollable = computed(() => todaysJobs.value.length > 4);
const visibleSourceCopy = computed(() => source.value === 'cache' ? 'Showing jobs stored on this device.' : 'Showing the current mobile job list.');

async function loadJobs(): Promise<void> {
  try {
    jobs.value = await loadLiveJobOrders();
    source.value = 'live';
  } catch (error) {
    const cachedJobs = await loadCachedJobOrders();
    if (cachedJobs.length > 0) {
      jobs.value = cachedJobs;
      source.value = 'cache';
      return;
    }

    jobs.value = [];
    source.value = null;
    errorMessage.value = error instanceof Error ? error.message : 'Unable to load dashboard jobs.';
  }
}

async function loadWeeklyLoggedHours(): Promise<void> {
  const adapter = db();
  const session = currentSessionSnapshot();
  if (!adapter || !session?.userId) {
    weeklyLoggedHours.value = null;
    return;
  }

  const rows = await adapter.select<WorkLogSummaryRow>(
    `SELECT SUM(strftime('%s', COALESCE(ended_at, CURRENT_TIMESTAMP)) - strftime('%s', started_at)) * 1000 AS total_ms
     FROM worklog
     WHERE technician_id=?
       AND started_at >= ?`,
    [session.userId, startOfWeek().toISOString()],
  );

  const totalMs = Number(rows[0]?.total_ms ?? 0);
  weeklyLoggedHours.value = Number.isFinite(totalMs) ? totalMs / 3_600_000 : 0;
}

async function loadCertificationAlert(): Promise<void> {
  const session = currentSessionSnapshot();
  if (!session?.userId) {
    certificate.value = null;
    return;
  }

  try {
    const query = new URLSearchParams({ ownerType: 'TECHNICIAN', ownerId: session.userId });
    const response = await authenticatedFetch(`${apiBase()}/certificates?${query.toString()}`, {
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) throw new Error('Unable to load certifications.');
    const rows = await response.json() as CertificateRow[];
    certificate.value = rows
      .filter((row) => Number.isFinite(new Date(row.expiresAt).getTime()))
      .sort((a, b) => new Date(a.expiresAt).getTime() - new Date(b.expiresAt).getTime())[0] ?? null;
  } catch {
    certificate.value = null;
  }
}

async function loadDashboard(): Promise<void> {
  isLoading.value = true;
  errorMessage.value = null;
  try {
    await Promise.all([
      loadJobs(),
      loadWeeklyLoggedHours(),
      loadCertificationAlert(),
      syncQueue.loadCount(),
    ]);
  } finally {
    isLoading.value = false;
  }
}

onMounted(() => {
  void loadDashboard();
});
</script>

<template>
  <main class="dashboard" aria-labelledby="dashboard-title">
    <header class="dashboard__header">
      <p class="dashboard__date">{{ today }}</p>
      <h1 id="dashboard-title">{{ greeting }}</h1>
    </header>

    <div v-if="isLoading" class="dashboard__loading" aria-live="polite">
      <ProgressSpinner stroke-width="4" />
    </div>

    <template v-else>
      <p v-if="errorMessage" class="dashboard__message" role="alert">{{ errorMessage }}</p>

      <section class="dashboard__stats" :class="statsGridClass" aria-label="Personal stats">
        <article v-for="stat in stats" :key="stat.key" class="dashboard__stat-card">
          <span>{{ stat.label }}</span>
          <strong>{{ stat.value }}</strong>
        </article>
      </section>

      <RouterLink v-if="hasQueuedSync" class="dashboard__sync-card" to="/sync">
        <i class="pi pi-cloud-upload" aria-hidden="true" />
        <span>
          <strong>{{ queuedCount }} queued</strong>
          <small>Tap to review sync status</small>
        </span>
      </RouterLink>

      <section v-if="certificate" class="dashboard__cert-card" aria-label="Certification alert">
        <i class="pi pi-id-card" aria-hidden="true" />
        <span>
          <strong>{{ certificate.certType }}</strong>
          <small>Expires {{ formatCertificateDate(certificate.expiresAt) }}</small>
        </span>
      </section>

      <section class="dashboard__schedule" aria-labelledby="today-schedule-title">
        <div class="dashboard__section-heading">
          <div>
            <h2 id="today-schedule-title">Today's schedule</h2>
            <p>{{ visibleSourceCopy }}</p>
          </div>
          <RouterLink v-if="todaysJobs.length > 4" to="/jobs">All jobs</RouterLink>
        </div>

        <div v-if="todaysJobs.length > 0" class="dashboard__schedule-list" :class="{ 'dashboard__schedule-list--scroll': scheduleIsScrollable }">
          <RouterLink
            v-for="job in todaysJobs"
            :key="job.id"
            class="dashboard__schedule-row"
            :to="`/jobs/${job.id}`"
            :style="stateStyle(job.state)"
          >
            <span class="dashboard__accent" aria-hidden="true" />
            <time :datetime="job.plannedStartDate ?? undefined">{{ formatTime(job.plannedStartDate) }}</time>
            <span class="dashboard__job-main">
              <strong>{{ relationName(job, 'vessel') }}</strong>
              <small>{{ job.joNumber }} · {{ relationName(job, 'client') }}</small>
            </span>
            <span class="dashboard__state-pill">{{ jobOrderStateMeta(job.state).label }}</span>
          </RouterLink>
        </div>

        <div v-else class="dashboard__empty">
          <i class="pi pi-calendar-times" aria-hidden="true" />
          <p>No jobs scheduled for today.</p>
        </div>
      </section>
    </template>
  </main>
</template>

<style scoped>
.dashboard {
  min-height: 100%;
  display: grid;
  align-content: start;
  gap: var(--sp-4);
  padding: var(--sp-4);
  color: var(--color-text);
  background: var(--color-canvas);
  font-family: var(--font-ui);
}

.dashboard__header {
  display: grid;
  gap: var(--sp-1);
}

.dashboard__date,
.dashboard__section-heading p,
.dashboard__sync-card small,
.dashboard__cert-card small,
.dashboard__job-main small {
  margin: 0;
  color: var(--color-text-muted);
  font-size: var(--fs-body);
}

.dashboard__header h1 {
  margin: 0;
  color: var(--color-text);
  font-size: var(--fs-h2);
  font-weight: var(--fw-semibold);
  line-height: var(--lh-tight);
}

.dashboard__stats {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--sp-3);
}

.dashboard__stats--two {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.dashboard__stat-card,
.dashboard__sync-card,
.dashboard__cert-card,
.dashboard__schedule {
  border: var(--border-1);
  border-radius: 12px;
  background: var(--color-surface);
}

.dashboard__stat-card {
  min-height: var(--tap-field);
  display: grid;
  gap: var(--sp-1);
  padding: var(--sp-3);
}

.dashboard__stat-card span {
  color: var(--color-text-muted);
  font-size: var(--fs-body);
  font-weight: var(--fw-medium);
}

.dashboard__stat-card strong {
  font-size: var(--fs-h2);
  line-height: var(--lh-tight);
}

.dashboard__sync-card,
.dashboard__cert-card {
  min-height: var(--tap-field);
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  padding: var(--sp-3);
  text-decoration: none;
}

.dashboard__sync-card {
  color: var(--status-pending-fg);
  background: var(--status-pending-bg);
  border-color: var(--status-pending-br);
}

.dashboard__cert-card {
  color: var(--jo-onhold-fg);
  background: #FBF1C9;
  border-color: var(--jo-onhold-fg);
}

.dashboard__sync-card i,
.dashboard__cert-card i {
  width: var(--tap-min);
  height: var(--tap-min);
  display: inline-grid;
  flex: 0 0 auto;
  place-items: center;
  border-radius: var(--radius-md);
  background: rgba(255, 255, 255, 0.62);
  font-size: var(--fs-h3);
}

.dashboard__sync-card span,
.dashboard__cert-card span {
  display: grid;
  gap: 2px;
}

.dashboard__sync-card strong,
.dashboard__cert-card strong {
  font-size: var(--fs-body-lg);
}

.dashboard__schedule {
  display: grid;
  gap: var(--sp-3);
  padding: var(--sp-4);
}

.dashboard__section-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--sp-3);
}

.dashboard__section-heading h2 {
  margin: 0 0 var(--sp-1);
  font-size: var(--fs-h3);
  line-height: var(--lh-tight);
}

.dashboard__section-heading a {
  min-height: var(--tap-min);
  display: inline-flex;
  align-items: center;
  color: var(--color-field-action);
  font-size: var(--fs-body);
  font-weight: var(--fw-semibold);
  text-decoration: none;
}

.dashboard__schedule-list {
  display: grid;
  gap: var(--sp-2);
}

.dashboard__schedule-list--scroll {
  max-height: 25rem;
  overflow-y: auto;
  padding-right: var(--sp-1);
}

.dashboard__schedule-row {
  --dashboard-state-fg: var(--jo-draft-fg);
  --dashboard-state-bg: var(--jo-draft-bg);
  min-height: var(--tap-field);
  display: grid;
  grid-template-columns: 4px 4.5rem minmax(0, 1fr) auto;
  align-items: center;
  gap: var(--sp-3);
  padding: var(--sp-3);
  border: var(--border-1);
  border-radius: 12px;
  color: var(--color-text);
  background: var(--color-surface);
  text-decoration: none;
}

.dashboard__accent {
  align-self: stretch;
  border-radius: var(--radius-pill);
  background: var(--dashboard-state-fg);
}

.dashboard__schedule-row time {
  color: var(--color-text-muted);
  font-family: var(--font-code);
  font-size: var(--fs-body-sm);
}

.dashboard__job-main {
  min-width: 0;
  display: grid;
  gap: 2px;
}

.dashboard__job-main strong,
.dashboard__job-main small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dashboard__job-main strong {
  font-size: var(--fs-body-lg);
  font-weight: var(--fw-semibold);
}

.dashboard__state-pill {
  padding: 4px 10px;
  border-radius: var(--radius-pill);
  color: var(--dashboard-state-fg);
  background: var(--dashboard-state-bg);
  font-size: var(--fs-caption);
  font-weight: var(--fw-semibold);
  white-space: nowrap;
}

.dashboard__empty {
  min-height: 10rem;
  display: grid;
  place-items: center;
  align-content: center;
  gap: var(--sp-3);
  color: var(--color-text-muted);
  text-align: center;
}

.dashboard__empty i {
  font-size: var(--fs-h1);
}

.dashboard__empty p {
  margin: 0;
  font-size: var(--fs-body-lg);
}

.dashboard__loading {
  min-height: 15rem;
  display: grid;
  place-items: center;
}

.dashboard__loading :deep(.p-progressspinner) {
  width: var(--tap-min);
  height: var(--tap-min);
}

.dashboard__message {
  margin: 0;
  padding: var(--sp-3);
  border: var(--border-1);
  border-color: var(--status-error-br);
  border-radius: 12px;
  background: var(--status-error-bg);
  color: var(--status-error-fg);
  font-size: var(--fs-body);
}

@media (max-width: 520px) {
  .dashboard__stats,
  .dashboard__stats--two {
    grid-template-columns: 1fr;
  }

  .dashboard__schedule-row {
    grid-template-columns: 4px minmax(0, 1fr);
  }

  .dashboard__schedule-row time,
  .dashboard__state-pill {
    grid-column: 2;
  }
}
</style>
