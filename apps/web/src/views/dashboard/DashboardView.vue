<script setup lang="ts">
import Button from 'primevue/button';
import { computed, onMounted, ref } from 'vue';
import { jobOrderStateClass, jobOrderStateLabel } from '@/composables/useJobOrderStateMeta';
import { ApiResponseError } from '@/lib/api/errors';
import type { JobState } from '@/lib/api/types';
import { useChecklistCategoriesStore } from '@/stores/checklistCategories';
import { useJobOrdersStore } from '@/stores/jobOrders';

interface StatusRow {
  state: JobState;
  count: number;
  percent: number;
}

interface CategoryRow {
  key: string;
  label: string;
  count: number;
  fallback: boolean;
}

const jobOrdersStore = useJobOrdersStore();
const checklistCategoriesStore = useChecklistCategoriesStore();
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
const seededCategoryLabels = new Map([
  ['inspection', 'Inspection'],
  ['electrical', 'Electrical'],
  ['mechanical', 'Mechanical'],
  ['hull', 'Hull'],
  ['safety', 'Safety'],
  ['other', 'Other'],
]);

const jobOrders = computed(() => jobOrdersStore.sortedJobOrders);

const activeJobCount = computed(() => jobOrders.value.filter((jobOrder) => !inactiveStates.has(jobOrder.state)).length);
const categoryLabelsById = computed(() => {
  const labels = new Map(seededCategoryLabels);
  for (const category of checklistCategoriesStore.categories) labels.set(category.id, category.name);
  return labels;
});

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
  const counts = new Map<string, CategoryRow>();
  const fallbackKey = '__uncategorized';

  for (const jobOrder of jobOrders.value) {
    for (const category of jobOrder.serviceCategories) {
      const categoryId = category.trim();
      if (!categoryId) continue;
      const label = categoryLabelsById.value.get(categoryId);
      const key = label ? categoryId : fallbackKey;
      const row = counts.get(key) ?? {
        key,
        label: label ?? 'Uncategorized',
        count: 0,
        fallback: !label,
      };
      row.count += 1;
      counts.set(key, row);
    }
  }

  return [...counts.values()]
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
});

async function loadJobOrders(): Promise<void> {
  errorMessage.value = null;
  try {
    await Promise.all([
      jobOrdersStore.loadJobOrders(),
      checklistCategoriesStore.load(),
    ]);
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
    <div class="record-form-card">
      <header class="crm-page__header">
        <div>
          <p class="crm-page__eyebrow">Management</p>
          <h1 id="dashboard-title" class="crm-page__title">Dashboard</h1>
          <p class="record-form__version">Overview of all job orders.</p>
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
            {{ activeJobCount }} active or in-progress {{ pluraliseJob(activeJobCount) }}.
          </p>
        </article>

        <section class="dashboard-panel" aria-labelledby="status-breakdown-title">
          <h2 id="status-breakdown-title" class="crm-section__title">By status</h2>
          <div class="dashboard-bars">
            <div v-for="row in statusRows" :key="row.state" class="dashboard-bar-row">
              <span class="jo-chip dashboard-bar-row__label" :class="jobOrderStateClass(row.state)">
                {{ jobOrderStateLabel(row.state) }}
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
            <div v-for="row in categoryRows" :key="row.key" class="dashboard-bar-row">
              <span class="dashboard-bar-row__label" :class="{ 'dashboard-bar-row__label--fallback': row.fallback }">{{ row.label }}</span>
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
          <p class="dashboard-placeholder-copy">
            <span class="pi pi-receipt" aria-hidden="true" />
            <span>Coming with the Invoicing module — not yet in Phase 1 scope.</span>
          </p>
        </section>
      </section>
    </div>
  </main>
</template>
