<script setup lang="ts">
import Button from 'primevue/button';
import Card from 'primevue/card';
import InputText from 'primevue/inputtext';
import Message from 'primevue/message';
import ProgressSpinner from 'primevue/progressspinner';
import { defineStore } from 'pinia';
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { RouterLink, useRoute } from 'vue-router';
import {
  loadCachedJobOrders,
  loadLiveJobOrders,
  selfAssignJobOrder,
  type JobState,
  type MobileJobOrder,
} from '@/composables/useJobOrders';

type AssignedJobOrder = MobileJobOrder;

function relationName(job: AssignedJobOrder, key: 'client' | 'vessel'): string {
  if (key === 'client') return job.clientName ?? job.client?.name ?? 'No client on record';
  return job.vesselName ?? job.vessel?.name ?? 'No vessel on record';
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

function canOpenJob(job: AssignedJobOrder): boolean {
  return job.canOpen !== false;
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
        jobs.value = await loadCachedJobOrders();
        source.value = 'cache';
        return;
      }

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

  function replaceJob(job: AssignedJobOrder): void {
    jobs.value = [job, ...jobs.value.filter((item) => item.id !== job.id)];
    source.value = 'live';
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
    replaceJob,
  };
});

const assignedJobsStore = useAssignedJobsStore();
const route = useRoute();
const mfaEnrollmentRequired = computed(() => route.query.mfaEnrollmentRequired === 'true');
const searchQuery = ref('');
const selectedStatuses = ref<JobState[]>([]);
const dateFrom = ref('');
const dateTo = ref('');
const claimingJobId = ref<string | null>(null);
const claimMessage = ref<string | null>(null);

const statusFilters: Array<{ value: JobState; label: string }> = [
  { value: 'SCHEDULED', label: 'Scheduled' },
  { value: 'IN_PROGRESS', label: 'In progress' },
  { value: 'PENDING_REVIEW', label: 'Pending review' },
  { value: 'ON_HOLD', label: 'On hold' },
  { value: 'COMPLETED', label: 'Completed' },
];

function toggleStatus(status: JobState): void {
  selectedStatuses.value = selectedStatuses.value.includes(status)
    ? selectedStatuses.value.filter((value) => value !== status)
    : [...selectedStatuses.value, status];
}

function matchesDateRange(job: AssignedJobOrder): boolean {
  if (!job.plannedStartDate) return true;
  const date = job.plannedStartDate.slice(0, 10);
  return (!dateFrom.value || date >= dateFrom.value) && (!dateTo.value || date <= dateTo.value);
}

const filteredJobs = computed(() => {
  const query = searchQuery.value.trim().toLowerCase();
  return assignedJobsStore.sortedJobs.filter((job) => {
    const matchesStatus = selectedStatuses.value.length === 0 || selectedStatuses.value.includes(job.state);
    const searchable = [job.joNumber, relationName(job, 'vessel'), relationName(job, 'client'), job.scopeSummary]
      .join(' ')
      .toLowerCase();
    const matchesSearch = !query || searchable.includes(query);
    return matchesStatus && matchesSearch && matchesDateRange(job);
  });
});

const activeFilterCount = computed(() => selectedStatuses.value.length
  + (searchQuery.value.trim() ? 1 : 0)
  + (dateFrom.value ? 1 : 0)
  + (dateTo.value ? 1 : 0));

function clearFilters(): void {
  searchQuery.value = '';
  selectedStatuses.value = [];
  dateFrom.value = '';
  dateTo.value = '';
}

async function claimJob(job: AssignedJobOrder): Promise<void> {
  assignedJobsStore.errorMessage = null;
  claimMessage.value = null;
  claimingJobId.value = job.id;

  try {
    const updated = await selfAssignJobOrder(job);
    assignedJobsStore.replaceJob(updated);
    claimMessage.value = `${updated.joNumber} assigned to you.`;
  } catch (error) {
    assignedJobsStore.errorMessage = error instanceof Error ? error.message : 'Unable to claim job.';
  } finally {
    claimingJobId.value = null;
  }
}

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

    <Message v-if="mfaEnrollmentRequired" severity="warn" :closable="false">
      Multi-factor authentication enrollment is still required for this account.
    </Message>

    <div v-if="assignedJobsStore.errorMessage" class="assigned-jobs__error" role="alert">
      {{ assignedJobsStore.errorMessage }}
    </div>
    <div v-if="claimMessage" class="assigned-jobs__notice" role="status">
      {{ claimMessage }}
    </div>

    <section class="assigned-jobs__filters" aria-label="Filter assigned jobs">
      <div class="assigned-jobs__filter-heading">
        <h2>Filter jobs</h2>
        <button
          v-if="activeFilterCount > 0"
          type="button"
          class="assigned-jobs__clear"
          @click="clearFilters"
        >
          Clear all ({{ activeFilterCount }})
        </button>
      </div>
      <InputText v-model="searchQuery" class="assigned-jobs__search" placeholder="Search jobs, vessels, clients" aria-label="Search assigned jobs" />
      <div class="assigned-jobs__status-filters" aria-label="Filter by job status">
        <button
          v-for="filter in statusFilters"
          :key="filter.value"
          type="button"
          class="assigned-jobs__status-filter"
          :class="{ 'assigned-jobs__status-filter--active': selectedStatuses.includes(filter.value) }"
          :aria-pressed="selectedStatuses.includes(filter.value)"
          @click="toggleStatus(filter.value)"
        >
          <span class="assigned-jobs__status-dot" :class="stateClass(filter.value)" aria-hidden="true" />
          {{ filter.label }}
        </button>
      </div>
      <div class="assigned-jobs__dates">
        <label>From <input v-model="dateFrom" type="date" aria-label="Planned date from" /></label>
        <label>To <input v-model="dateTo" type="date" aria-label="Planned date to" /></label>
      </div>
    </section>

    <div v-if="assignedJobsStore.isLoading" class="assigned-jobs__loading" aria-live="polite">
      <ProgressSpinner class="assigned-jobs__spinner" stroke-width="4" />
    </div>

    <section v-else-if="filteredJobs.length > 0" class="assigned-jobs__list" aria-label="Assigned job orders">
      <Card
        v-for="job in filteredJobs"
        :key="job.id"
        class="assigned-jobs__card"
        :class="{ 'assigned-jobs__card--muted': !canOpenJob(job) }"
      >
        <template #content>
          <article class="assigned-jobs__content">
            <RouterLink
              v-if="canOpenJob(job)"
              class="assigned-jobs__link"
              :to="jobPath(job)"
            >
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
            </RouterLink>

            <div
              v-else
              class="assigned-jobs__link assigned-jobs__link--static"
            >
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
            </div>

            <div v-if="job.isAvailable || !canOpenJob(job)" class="assigned-jobs__actions">
              <span v-if="job.isAvailable" class="assigned-jobs__available">Available for self-assignment</span>
              <span v-else class="assigned-jobs__available">Assigned</span>
              <Button
                v-if="job.isAvailable"
                label="Claim job"
                icon="pi pi-user-plus"
                :loading="claimingJobId === job.id"
                :disabled="assignedJobsStore.isOffline"
                @click="claimJob(job)"
              />
            </div>
          </article>
        </template>
      </Card>
    </section>

    <p v-else class="assigned-jobs__empty">
      {{ activeFilterCount > 0 ? 'No jobs match these filters.' : 'No assigned jobs.' }}
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

.assigned-jobs__filters {
  display: grid;
  gap: var(--sp-3);
  margin-bottom: var(--sp-4);
  padding: var(--sp-4);
  border: var(--border-1);
  border-radius: var(--radius-md);
  background: var(--color-surface);
}

.assigned-jobs__filter-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--sp-3);
}

.assigned-jobs__filter-heading h2 {
  margin: 0;
  font-size: var(--fs-body-lg);
}

.assigned-jobs__clear {
  min-height: var(--tap-min);
  border: 0;
  background: transparent;
  color: var(--color-brand);
  font-weight: var(--fw-semibold);
  cursor: pointer;
}

.assigned-jobs__search {
  min-height: var(--tap-min);
  width: 100%;
}

.assigned-jobs__status-filters,
.assigned-jobs__dates {
  display: flex;
  flex-wrap: wrap;
  gap: var(--tap-gap);
}

.assigned-jobs__status-filter {
  min-height: var(--tap-min);
  display: inline-flex;
  align-items: center;
  gap: var(--sp-2);
  padding: var(--sp-2) var(--sp-3);
  border: var(--border-1);
  border-radius: var(--radius-pill);
  background: var(--color-surface);
  color: var(--color-text-muted);
  font-size: var(--fs-body-sm);
  font-weight: var(--fw-semibold);
  cursor: pointer;
}

.assigned-jobs__status-filter--active {
  border-color: var(--color-text);
  color: var(--color-text);
}

.assigned-jobs__status-dot {
  width: var(--sp-3);
  height: var(--sp-3);
  border-radius: 50%;
}

.assigned-jobs__dates label {
  display: grid;
  gap: var(--sp-1);
  color: var(--color-text-muted);
  font-size: var(--fs-body-sm);
  font-weight: var(--fw-semibold);
}

.assigned-jobs__dates input {
  min-height: var(--tap-min);
  padding: 0 var(--sp-2);
  border: var(--border-1);
  border-radius: var(--radius-sm);
  color: var(--color-text);
  background: var(--color-surface);
}

.assigned-jobs__list {
  display: grid;
  gap: var(--tap-gap);
}

.assigned-jobs__link {
  display: grid;
  gap: var(--sp-3);
  min-height: var(--tap-min);
  color: inherit;
  text-decoration: none;
}

.assigned-jobs__link:focus-visible {
  outline: var(--border-2);
  outline-offset: var(--sp-1);
}

.assigned-jobs__link--static {
  cursor: default;
}

.assigned-jobs__card {
  overflow: hidden;
  border: var(--border-1);
  border-radius: var(--radius-md);
  background: var(--color-surface);
}

.assigned-jobs__card--muted {
  opacity: 0.62;
  background: var(--color-canvas);
}

.assigned-jobs__card--muted .assigned-jobs__number,
.assigned-jobs__card--muted .assigned-jobs__scope,
.assigned-jobs__card--muted .assigned-jobs__identity,
.assigned-jobs__card--muted .assigned-jobs__planned {
  color: var(--color-text-muted);
}

.assigned-jobs__content {
  display: grid;
  gap: var(--sp-3);
  min-height: var(--tap-field);
}

.assigned-jobs__actions {
  display: grid;
  gap: var(--tap-gap);
  padding-top: var(--sp-3);
  border-top: var(--border-1);
}

.assigned-jobs__actions :deep(.p-button) {
  min-height: var(--tap-field);
}

.assigned-jobs__available {
  color: var(--color-text-muted);
  font-size: var(--fs-body-sm);
  font-weight: var(--fw-semibold);
  line-height: var(--lh-base);
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
