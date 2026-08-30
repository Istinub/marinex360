<script setup lang="ts">
import Button from 'primevue/button';
import Card from 'primevue/card';
import ProgressSpinner from 'primevue/progressspinner';
import { defineStore } from 'pinia';
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { RouterLink } from 'vue-router';

type JobState =
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
}

interface AssignedJobOrder {
  id: string;
  joNumber: string;
  state: JobState;
  scopeSummary: string;
  plannedStartDate?: string | null;
  // NEEDS: BE: live list rows must include client/vessel relation names; jo_cache already stores denormalized names.
  clientName?: string | null;
  vesselName?: string | null;
  client?: NamedRelation | null;
  vessel?: NamedRelation | null;
}

interface JoCacheRow {
  id: string;
  jo_number: string;
  state: JobState;
  scope_summary: string | null;
  planned_start_date: string | null;
  client_name: string | null;
  vessel_name: string | null;
}

interface MobileSqlAdapter {
  select<T>(sql: string, params?: unknown[]): Promise<T[]>;
}

interface MobileRuntime {
  marinex360?: {
    db?: MobileSqlAdapter;
    auth?: {
      accessToken?: string | null;
    };
  };
}

const JO_CACHE_SQL = `
  SELECT id, jo_number, state, scope_summary, planned_start_date, client_name, vessel_name
  FROM jo_cache
  ORDER BY planned_start_date IS NULL, planned_start_date ASC, jo_number ASC
`;

function mobileRuntime(): MobileRuntime {
  return globalThis as typeof globalThis & MobileRuntime;
}

function apiBase(): string {
  return (import.meta.env.VITE_API_BASE ?? '/api/v1').replace(/\/$/, '');
}

function authHeaders(): HeadersInit {
  const accessToken = mobileRuntime().marinex360?.auth?.accessToken;
  return accessToken ? { Authorization: `Bearer ${accessToken}` } : {};
}

function fromCacheRow(row: JoCacheRow): AssignedJobOrder {
  return {
    id: row.id,
    joNumber: row.jo_number,
    state: row.state,
    scopeSummary: row.scope_summary ?? '',
    plannedStartDate: row.planned_start_date,
    clientName: row.client_name,
    vesselName: row.vessel_name,
  };
}

async function loadFromJoCache(): Promise<AssignedJobOrder[]> {
  const db = mobileRuntime().marinex360?.db;

  // NEEDS: Mobile DB adapter should expose the S0-6 jo_cache table through this narrow SQL shape.
  if (!db) return [];

  return (await db.select<JoCacheRow>(JO_CACHE_SQL)).map(fromCacheRow);
}

async function loadFromLiveEndpoint(): Promise<AssignedJobOrder[]> {
  // NEEDS: BE/mobile API wrapper: no apps/mobile/src/api/jobOrders.ts filtered-list function exists in-repo yet.
  // Real v1.0 signature is GET /job-orders; technician assignment and branch scoping are enforced server-side.
  const response = await fetch(`${apiBase()}/job-orders`, {
    headers: {
      Accept: 'application/json',
      ...authHeaders(),
    },
  });

  if (!response.ok) throw new Error('Unable to load assigned jobs.');

  return (await response.json()) as AssignedJobOrder[];
}

function relationName(job: AssignedJobOrder, key: 'client' | 'vessel'): string {
  if (key === 'client') return job.clientName ?? job.client?.name ?? 'Client pending';
  return job.vesselName ?? job.vessel?.name ?? 'Vessel pending';
}

function formatDate(value?: string | null): string {
  if (!value) return 'Unplanned';

  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(value));
}

function stateClass(state: JobState): string {
  const tokenName: Record<JobState, string> = {
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

  return `assigned-jobs__state--${tokenName[state]}`;
}

function jobPath(job: AssignedJobOrder): string {
  return `/jobs/${job.id}`;
}

const useAssignedJobsStore = defineStore('assignedJobs', () => {
  const jobs = ref<AssignedJobOrder[]>([]);
  const isLoading = ref(false);
  const isOffline = ref(typeof navigator !== 'undefined' ? !navigator.onLine : false);
  const errorMessage = ref<string | null>(null);
  const source = ref<'cache' | 'live' | null>(null);

  const sortedJobs = computed(() => [...jobs.value]);

  async function loadAssignedJobs(): Promise<void> {
    isLoading.value = true;
    errorMessage.value = null;

    try {
      if (isOffline.value) {
        jobs.value = await loadFromJoCache();
        source.value = 'cache';
        return;
      }

      try {
        jobs.value = await loadFromLiveEndpoint();
        source.value = 'live';
      } catch (error) {
        const cachedJobs = await loadFromJoCache();
        if (cachedJobs.length > 0) {
          jobs.value = cachedJobs;
          source.value = 'cache';
          return;
        }

        throw error;
      }
    } catch (error) {
      errorMessage.value = error instanceof Error ? error.message : 'Unable to load assigned jobs.';
    } finally {
      isLoading.value = false;
    }
  }

  function setOnlineStatus(): void {
    isOffline.value = typeof navigator !== 'undefined' ? !navigator.onLine : false;
  }

  return {
    jobs,
    sortedJobs,
    isLoading,
    isOffline,
    errorMessage,
    source,
    loadAssignedJobs,
    setOnlineStatus,
  };
});

const assignedJobsStore = useAssignedJobsStore();

function handleOnlineStatusChange(): void {
  assignedJobsStore.setOnlineStatus();
  void assignedJobsStore.loadAssignedJobs();
}

onMounted(() => {
  assignedJobsStore.setOnlineStatus();
  void assignedJobsStore.loadAssignedJobs();

  if (typeof window !== 'undefined') {
    window.addEventListener('online', handleOnlineStatusChange);
    window.addEventListener('offline', handleOnlineStatusChange);
  }
});

onBeforeUnmount(() => {
  if (typeof window !== 'undefined') {
    window.removeEventListener('online', handleOnlineStatusChange);
    window.removeEventListener('offline', handleOnlineStatusChange);
  }
});
</script>

<template>
  <main class="assigned-jobs" aria-labelledby="assigned-jobs-title">
    <header class="assigned-jobs__header">
      <div>
        <p class="assigned-jobs__eyebrow">My work</p>
        <h1 id="assigned-jobs-title" class="assigned-jobs__title">Assigned jobs</h1>
      </div>

      <Button
        class="assigned-jobs__refresh"
        icon="pi pi-refresh"
        aria-label="Refresh assigned jobs"
        rounded
        severity="secondary"
        :loading="assignedJobsStore.isLoading"
        @click="assignedJobsStore.loadAssignedJobs"
      />
    </header>

    <p v-if="assignedJobsStore.source === 'cache'" class="assigned-jobs__notice">
      Showing saved assigned jobs.
    </p>

    <div v-if="assignedJobsStore.errorMessage" class="assigned-jobs__error" role="alert">
      {{ assignedJobsStore.errorMessage }}
    </div>

    <div v-if="assignedJobsStore.isLoading" class="assigned-jobs__loading" aria-live="polite">
      <ProgressSpinner class="assigned-jobs__spinner" stroke-width="4" />
    </div>

    <section v-else-if="assignedJobsStore.sortedJobs.length > 0" class="assigned-jobs__list" aria-label="Assigned job orders">
      <RouterLink
        v-for="job in assignedJobsStore.sortedJobs"
        :key="job.id"
        class="assigned-jobs__link"
        :to="jobPath(job)"
      >
        <Card class="assigned-jobs__card">
          <template #content>
            <article class="assigned-jobs__content">
              <div class="assigned-jobs__topline">
                <span class="assigned-jobs__number">{{ job.joNumber }}</span>
                <span class="assigned-jobs__state" :class="stateClass(job.state)">
                  {{ job.state }}
                </span>
              </div>

              <div class="assigned-jobs__identity">
                <span>{{ relationName(job, 'vessel') }}</span>
                <span>{{ relationName(job, 'client') }}</span>
              </div>

              <p class="assigned-jobs__scope">
                {{ job.scopeSummary }}
              </p>

              <time class="assigned-jobs__planned" :datetime="job.plannedStartDate ?? undefined">
                {{ formatDate(job.plannedStartDate) }}
              </time>
            </article>
          </template>
        </Card>
      </RouterLink>
    </section>

    <p v-else class="assigned-jobs__empty">
      No assigned jobs.
    </p>
  </main>
</template>

<style scoped>
.assigned-jobs {
  min-height: 100%;
  padding: var(--sp-4);
  background: var(--color-canvas);
  color: var(--color-text);
  font-family: var(--font-ui);
}

.assigned-jobs__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--sp-4);
  margin-bottom: var(--sp-4);
}

.assigned-jobs__eyebrow {
  margin: 0 0 var(--sp-1);
  color: var(--color-text-muted);
  font-size: var(--fs-body-sm);
  font-weight: var(--fw-semibold);
}

.assigned-jobs__title {
  margin: 0;
  font-size: var(--fs-h1);
  font-weight: var(--fw-semibold);
  line-height: var(--lh-tight);
}

.assigned-jobs__notice,
.assigned-jobs__empty,
.assigned-jobs__error {
  margin: 0 0 var(--sp-4);
  padding: var(--sp-3) var(--sp-4);
  border: var(--border-1);
  border-radius: var(--radius-md);
  background: var(--color-surface);
  font-size: var(--fs-body);
  line-height: var(--lh-base);
}

.assigned-jobs__notice,
.assigned-jobs__empty {
  color: var(--color-text-muted);
}

.assigned-jobs__error {
  border-color: var(--status-error-br);
  background: var(--status-error-bg);
  color: var(--status-error-fg);
}

.assigned-jobs__loading {
  display: grid;
  min-height: var(--tap-field);
  place-items: center;
  padding: var(--sp-8);
}

.assigned-jobs__spinner {
  width: var(--tap-min);
  height: var(--tap-min);
}

.assigned-jobs__refresh {
  min-width: var(--tap-min);
  min-height: var(--tap-min);
}

.assigned-jobs__list {
  display: grid;
  gap: var(--tap-gap);
}

.assigned-jobs__link {
  display: block;
  min-height: var(--tap-min);
  color: inherit;
  text-decoration: none;
}

.assigned-jobs__link:focus-visible {
  outline: var(--border-2);
  outline-offset: var(--sp-1);
}

.assigned-jobs__card {
  overflow: hidden;
  border: var(--border-1);
  border-radius: var(--radius-md);
  background: var(--color-surface);
}

.assigned-jobs__content {
  display: grid;
  gap: var(--sp-3);
  min-height: var(--tap-field);
}

.assigned-jobs__topline,
.assigned-jobs__identity {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--sp-3);
}

.assigned-jobs__number {
  overflow-wrap: anywhere;
  font-family: var(--font-code);
  font-size: var(--fs-body);
  font-weight: var(--fw-semibold);
}

.assigned-jobs__state {
  flex: 0 0 auto;
  max-width: 50%;
  min-height: var(--tap-min);
  padding: var(--sp-2) var(--sp-3);
  border-radius: var(--radius-pill);
  font-size: var(--fs-caption);
  font-weight: var(--fw-semibold);
  line-height: var(--lh-tight);
  overflow-wrap: anywhere;
}

.assigned-jobs__state--draft {
  background: var(--jo-draft-bg);
  color: var(--jo-draft-fg);
}

.assigned-jobs__state--scheduled {
  background: var(--jo-scheduled-bg);
  color: var(--jo-scheduled-fg);
}

.assigned-jobs__state--inprogress {
  background: var(--jo-inprogress-bg);
  color: var(--jo-inprogress-fg);
}

.assigned-jobs__state--review {
  background: var(--jo-review-bg);
  color: var(--jo-review-fg);
}

.assigned-jobs__state--completed {
  background: var(--jo-completed-bg);
  color: var(--jo-completed-fg);
}

.assigned-jobs__state--invoiced {
  background: var(--jo-invoiced-bg);
  color: var(--jo-invoiced-fg);
}

.assigned-jobs__state--closed {
  background: var(--jo-closed-bg);
  color: var(--jo-closed-fg);
}

.assigned-jobs__state--onhold {
  background: var(--jo-onhold-bg);
  color: var(--jo-onhold-fg);
}

.assigned-jobs__state--cancelled {
  background: var(--jo-cancelled-bg);
  color: var(--jo-cancelled-fg);
}

.assigned-jobs__identity {
  color: var(--color-text);
  font-size: var(--fs-body);
  font-weight: var(--fw-semibold);
}

.assigned-jobs__identity span {
  min-width: 0;
  overflow-wrap: anywhere;
}

.assigned-jobs__identity span:last-child {
  color: var(--color-text-muted);
  font-weight: var(--fw-regular);
  text-align: right;
}

.assigned-jobs__scope {
  display: -webkit-box;
  margin: 0;
  overflow: hidden;
  color: var(--color-text-muted);
  font-size: var(--fs-body);
  line-height: var(--lh-base);
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.assigned-jobs__planned {
  color: var(--color-text-muted);
  font-size: var(--fs-body-sm);
  line-height: var(--lh-base);
}

@media (min-width: 720px) {
  .assigned-jobs {
    padding: var(--sp-6);
  }

  .assigned-jobs__list {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
