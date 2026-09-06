<script setup lang="ts">
import Card from 'primevue/card';
import ProgressSpinner from 'primevue/progressspinner';
import { computed, onMounted, ref } from 'vue';
import { loadCachedJobOrders, loadLiveJobOrders, type JobState, type MobileJobOrder } from '@/composables/useJobOrders';

interface StateRow {
  state: JobState;
  label: string;
  count: number;
  percent: number;
}

const visibleStates: JobState[] = [
  'SCHEDULED',
  'IN_PROGRESS',
  'ON_HOLD',
  'PENDING_REVIEW',
  'COMPLETED',
  'INVOICED',
  'CLOSED',
];

const stateLabels: Record<JobState, string> = {
  DRAFT: 'Draft',
  SCHEDULED: 'Scheduled',
  IN_PROGRESS: 'In progress',
  ON_HOLD: 'On hold',
  PENDING_REVIEW: 'Pending review',
  COMPLETED: 'Completed',
  INVOICED: 'Invoiced',
  CLOSED: 'Closed',
  CANCELLED: 'Cancelled',
};

const jobs = ref<MobileJobOrder[]>([]);
const isLoading = ref(true);
const errorMessage = ref<string | null>(null);
const source = ref<'cache' | 'live' | null>(null);
const loadedAt = ref<string | null>(null);

async function loadDashboardJobs(): Promise<void> {
  isLoading.value = true;
  errorMessage.value = null;
  try {
    jobs.value = await loadLiveJobOrders();
    source.value = 'live';
  } catch (error) {
    const cachedJobs = await loadCachedJobOrders();
    if (cachedJobs.length > 0) {
      jobs.value = cachedJobs;
      source.value = 'cache';
    } else {
      jobs.value = [];
      source.value = null;
      errorMessage.value = error instanceof Error ? error.message : 'Unable to load dashboard job orders.';
    }
  } finally {
    loadedAt.value = new Date().toISOString();
    isLoading.value = false;
  }
}

const totalCount = computed(() => jobs.value.length);
const stateRows = computed<StateRow[]>(() => visibleStates.map((state) => {
  const count = jobs.value.filter((job) => job.state === state).length;
  return {
    state,
    label: stateLabels[state],
    count,
    percent: totalCount.value === 0 ? 0 : Math.round((count / totalCount.value) * 100),
  };
}));
const lastUpdated = computed(() => {
  return loadedAt.value ? new Date(loadedAt.value).toLocaleString() : 'Not available';
});

function barWidth(row: StateRow): string {
  return `${row.percent}%`;
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

  return `dashboard__state--${tokenName[state]}`;
}

onMounted(() => {
  void loadDashboardJobs();
});
</script>

<template>
  <main class="dashboard" aria-labelledby="dashboard-title">
    <header class="dashboard__header">
      <div>
        <p class="dashboard__eyebrow">Field snapshot</p>
        <h1 id="dashboard-title">Dashboard</h1>
      </div>
      <i class="pi pi-chart-bar dashboard__header-icon" aria-hidden="true" />
    </header>

    <div v-if="isLoading" class="dashboard__loading" aria-live="polite">
      <ProgressSpinner stroke-width="4" />
    </div>

    <template v-else>
      <p v-if="errorMessage" class="dashboard__message" role="alert">{{ errorMessage }}</p>

      <section class="dashboard__summary" aria-label="Job totals">
        <p class="dashboard__summary-label">{{ source === 'cache' ? 'Cached visible jobs' : 'Visible jobs' }}</p>
        <strong class="dashboard__total">{{ totalCount }}</strong>
        <p class="dashboard__updated">Last updated {{ lastUpdated }}</p>
      </section>

      <section class="dashboard__charts" aria-label="Job status counts">
        <Card class="dashboard__card">
          <template #content>
            <h2 class="dashboard__section-title">By status</h2>
            <div class="dashboard__status-list">
              <div v-for="row in stateRows" :key="row.state" class="dashboard__status-row">
                <span class="dashboard__state" :class="stateClass(row.state)">
                  {{ row.label }}
                </span>
                <div class="dashboard__bar" role="img" :aria-label="`${row.label}: ${row.count} of ${totalCount} jobs`">
                  <span class="dashboard__bar-fill" :style="{ width: barWidth(row) }" />
                </div>
                <strong class="dashboard__count">{{ row.count }}</strong>
              </div>
            </div>
          </template>
        </Card>
      </section>

      <p class="dashboard__note">
        Counts are based on {{ source === 'cache' ? 'jobs currently stored on this device' : 'the current visible job list' }}.
      </p>
    </template>
  </main>
</template>

<style scoped>
.dashboard {
  display: grid;
  gap: var(--sp-4);
  min-height: 100%;
  padding: var(--sp-4);
  color: var(--color-text);
  background: var(--color-canvas);
  font-family: var(--font-ui);
}

.dashboard__header,
.dashboard__status-row {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
}

.dashboard__header { justify-content: space-between; }
.dashboard__header h1 { margin: 0; font-size: var(--fs-h1); }
.dashboard__eyebrow { margin: 0 0 var(--sp-1); color: var(--color-text-muted); font-weight: var(--fw-semibold); }
.dashboard__header-icon { color: var(--color-field-action); font-size: var(--fs-h2); }
.dashboard__summary { padding: var(--sp-4); border: var(--border-1); border-radius: var(--radius-md); background: var(--color-surface); }
.dashboard__summary-label, .dashboard__updated, .dashboard__note { margin: 0; color: var(--color-text-muted); }
.dashboard__summary-label { font-size: var(--fs-body-sm); font-weight: var(--fw-semibold); }
.dashboard__total { display: block; margin: var(--sp-1) 0; font-size: var(--fs-display); line-height: var(--lh-tight); }
.dashboard__updated, .dashboard__note { font-size: var(--fs-body-sm); }
.dashboard__charts { display: grid; gap: var(--tap-gap); }
.dashboard__card { border: var(--border-1); background: var(--color-surface); }
.dashboard__section-title { margin: 0 0 var(--sp-3); font-size: var(--fs-body-lg); }
.dashboard__status-list { display: grid; gap: var(--sp-3); }
.dashboard__status-row { min-height: var(--tap-min); }
.dashboard__state { min-width: 9.5rem; padding: var(--sp-2) var(--sp-3); border-radius: var(--radius-pill); font-size: var(--fs-caption); font-weight: var(--fw-semibold); line-height: var(--lh-tight); }
.dashboard__count { min-width: var(--tap-min); text-align: right; font-size: var(--fs-h3); }
.dashboard__bar { height: var(--sp-3); overflow: hidden; margin-top: var(--sp-3); border-radius: var(--radius-pill); background: var(--jo-draft-bg); }
.dashboard__bar { flex: 1; margin-top: 0; }
.dashboard__bar-fill { display: block; height: 100%; min-width: 0; border-radius: inherit; background: var(--color-field-action); transition: width var(--motion-base) var(--ease); }
.dashboard__state--draft { background: var(--jo-draft-bg); color: var(--jo-draft-fg); }
.dashboard__state--scheduled { background: var(--jo-scheduled-bg); color: var(--jo-scheduled-fg); }
.dashboard__state--inprogress { background: var(--jo-inprogress-bg); color: var(--jo-inprogress-fg); }
.dashboard__state--review { background: var(--jo-review-bg); color: var(--jo-review-fg); }
.dashboard__state--completed { background: var(--jo-completed-bg); color: var(--jo-completed-fg); }
.dashboard__state--invoiced { background: var(--jo-invoiced-bg); color: var(--jo-invoiced-fg); }
.dashboard__state--closed { background: var(--jo-closed-bg); color: var(--jo-closed-fg); }
.dashboard__state--onhold { background: var(--jo-onhold-bg); color: var(--jo-onhold-fg); }
.dashboard__state--cancelled { background: var(--jo-cancelled-bg); color: var(--jo-cancelled-fg); }
.dashboard__loading { display: grid; min-height: var(--tap-field); place-items: center; padding: var(--sp-8); }
.dashboard__loading :deep(.p-progressspinner) { width: var(--tap-min); height: var(--tap-min); }
.dashboard__message { margin: 0; padding: var(--sp-3); border: var(--border-1); border-color: var(--status-error-br); background: var(--status-error-bg); color: var(--status-error-fg); }
</style>
