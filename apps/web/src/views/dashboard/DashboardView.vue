<script setup lang="ts">
import Button from 'primevue/button';
import { computed, onMounted, ref } from 'vue';
import { ApiResponseError } from '@/lib/api/errors';
import type { JobOrder, JobState } from '@/lib/api/types';
import { useJobOrdersStore } from '@/stores/jobOrders';

interface StatusRow {
  state: JobState;
  count: number;
  percent: number;
}

interface CategoryRow {
  category: string;
  count: number;
}

const jobOrdersStore = useJobOrdersStore();
const errorMessage = ref<string | null>(null);

const jobStates: JobState[] = [
  'DRAFT',
  'SCHEDULED',
  'IN_PROGRESS',
  'PENDING_REVIEW',
  'COMPLETED',
  'INVOICED',
  'CLOSED',
  'ON_HOLD',
  'CANCELLED',
];

const inactiveStates = new Set<JobState>(['COMPLETED', 'INVOICED', 'CLOSED', 'CANCELLED']);

const jobOrders = computed(() => jobOrdersStore.sortedJobOrders);

const activeJobCount = computed(() => jobOrders.value.filter((jobOrder) => !inactiveStates.has(jobOrder.state)).length);

const statusRows = computed<StatusRow[]>(() => {
  const total = jobOrders.value.length;
  return jobStates.map((state) => {
    const count = jobOrders.value.filter((jobOrder) => jobOrder.state === state).length;
    return {
      state,
      count,
      percent: total === 0 ? 0 : Math.round((count / total) * 100),
    };
  });
});

const categoryRows = computed<CategoryRow[]>(() => {
  const counts = new Map<string, number>();

  for (const jobOrder of jobOrders.value) {
    for (const category of jobOrder.serviceCategories) {
      const label = category.trim();
      if (!label) continue;
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }
  }

  return [...counts.entries()]
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count || a.category.localeCompare(b.category));
});

function jobOrderStateClass(state: JobState): string {
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

  return `mx-jo-${tokenName[state]}`;
}

async function loadJobOrders(): Promise<void> {
  errorMessage.value = null;
  try {
    await jobOrdersStore.loadJobOrders();
  } catch (error) {
    errorMessage.value = error instanceof ApiResponseError ? error.message : 'Unable to load dashboard job orders.';
  }
}

function categoryShare(row: CategoryRow): number {
  if (jobOrders.value.length === 0) return 0;
  return Math.round((row.count / jobOrders.value.length) * 100);
}

function categoryTrackStyle(row: CategoryRow): Record<string, string> {
  return { inlineSize: `${categoryShare(row)}%` };
}

function statusTrackStyle(row: StatusRow): Record<string, string> {
  return { inlineSize: `${row.percent}%` };
}

function pluraliseJob(count: number): string {
  return count === 1 ? 'job' : 'jobs';
}

onMounted(loadJobOrders);
</script>

<template>
  <main class="office-route crm-page" aria-labelledby="dashboard-title">
    <header class="crm-page__header">
      <div>
        <p class="crm-page__eyebrow">Management</p>
        <h1 id="dashboard-title" class="crm-page__title">Dashboard</h1>
        <p class="record-form__version">Based on currently loaded job orders.</p>
      </div>
    </header>

    <div v-if="errorMessage" class="record-form__actions record-form__actions--left" role="alert">
      <p class="auth-message auth-message--error">
        {{ errorMessage }}
      </p>
      <Button label="Retry" icon="pi pi-refresh" severity="secondary" :loading="jobOrdersStore.isLoading" @click="loadJobOrders" />
    </div>

    <p v-if="jobOrdersStore.isLoading" class="crm-empty">Loading dashboard...</p>

    <section class="dashboard-grid" aria-label="Job order dashboard">
      <article class="dashboard-panel dashboard-panel--metric" aria-labelledby="active-jobs-title">
        <p id="active-jobs-title" class="crm-page__eyebrow">Active jobs</p>
        <p class="dashboard-metric">{{ activeJobCount }}</p>
        <p class="record-form__version">
          {{ activeJobCount }} {{ pluraliseJob(activeJobCount) }} not terminal or inactive.
        </p>
      </article>

      <section class="dashboard-panel" aria-labelledby="status-breakdown-title">
        <h2 id="status-breakdown-title" class="crm-section__title">By status</h2>
        <div class="dashboard-bars">
          <div v-for="row in statusRows" :key="row.state" class="dashboard-bar-row">
            <span class="jo-chip dashboard-bar-row__label" :class="jobOrderStateClass(row.state)">
              {{ row.state }}
            </span>
            <div class="dashboard-bar-row__track" aria-hidden="true">
              <span class="dashboard-bar-row__fill" :style="statusTrackStyle(row)" />
            </div>
            <span class="dashboard-bar-row__count">{{ row.count }}</span>
          </div>
        </div>
      </section>

      <section class="dashboard-panel" aria-labelledby="category-breakdown-title">
        <h2 id="category-breakdown-title" class="crm-section__title">By category</h2>
        <div v-if="categoryRows.length" class="dashboard-bars">
          <div v-for="row in categoryRows" :key="row.category" class="dashboard-bar-row">
            <span class="dashboard-bar-row__label">{{ row.category }}</span>
            <div class="dashboard-bar-row__track" aria-hidden="true">
              <span class="dashboard-bar-row__fill" :style="categoryTrackStyle(row)" />
            </div>
            <span class="dashboard-bar-row__count">{{ row.count }}</span>
          </div>
        </div>
        <p v-else class="crm-empty">No service categories loaded.</p>
      </section>

      <section class="dashboard-panel dashboard-panel--placeholder" aria-labelledby="revenue-placeholder-title">
        <h2 id="revenue-placeholder-title" class="crm-section__title">Revenue & outstanding invoices</h2>
        <p class="record-form__version">
          Revenue & outstanding invoices — pending Invoicing module (not yet in Phase 1 scope).
        </p>
      </section>
    </section>
  </main>
</template>
