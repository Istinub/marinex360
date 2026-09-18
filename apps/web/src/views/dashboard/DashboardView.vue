<script setup lang="ts">
import Button from 'primevue/button';
import {
  ArcElement,
  BarController,
  BarElement,
  CategoryScale,
  Chart,
  DoughnutController,
  Filler,
  Legend,
  LinearScale,
  LineController,
  LineElement,
  PointElement,
  Tooltip,
  type ChartConfiguration,
} from 'chart.js';
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { jobOrderStateMeta } from '@/composables/useJobOrderStateMeta';
import { ApiResponseError } from '@/lib/api/errors';
import type { JobState } from '@/lib/api/types';
import { useChecklistCategoriesStore } from '@/stores/checklistCategories';
import { useJobOrdersStore } from '@/stores/jobOrders';

Chart.register(ArcElement, BarController, BarElement, CategoryScale, DoughnutController, Filler, Legend, LinearScale, LineController, LineElement, PointElement, Tooltip);

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

interface AttentionRow {
  key: string;
  label: string;
  count: number;
  to: string;
  color: string;
}

const router = useRouter();
const jobOrdersStore = useJobOrdersStore();
const checklistCategoriesStore = useChecklistCategoriesStore();
const errorMessage = ref<string | null>(null);
const dateRange = ref<'week' | 'month' | 'all'>('month');
const statusCanvas = ref<HTMLCanvasElement | null>(null);
const categoryCanvas = ref<HTMLCanvasElement | null>(null);
const earningsCanvas = ref<HTMLCanvasElement | null>(null);
let statusChart: Chart | null = null;
let categoryChart: Chart | null = null;
let earningsChart: Chart | null = null;

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

const terminalStates = new Set<JobState>(['COMPLETED', 'INVOICED', 'CLOSED', 'CANCELLED']);
const seededCategoryLabels = new Map([
  ['inspection', 'Inspection'],
  ['electrical', 'Electrical'],
  ['mechanical', 'Mechanical'],
  ['hull', 'Hull'],
  ['safety', 'Safety'],
  ['other', 'Other'],
]);
const sampleEarnings = [4200, 5100, 4800, 6500, 7200, 8100, 9300];
const sampleEarningsLabels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const jobOrders = computed(() => jobOrdersStore.sortedJobOrders);
const activeJobCount = computed(() => jobOrders.value.filter((jobOrder) => !terminalStates.has(jobOrder.state)).length);
const overdueCount = computed(() => jobOrders.value.filter((jobOrder) =>
  Boolean(jobOrder.deadline)
  && new Date(jobOrder.deadline as string).getTime() < Date.now()
  && !terminalStates.has(jobOrder.state),
).length);
const pendingReviewCount = computed(() => countByState('PENDING_REVIEW'));
const completedCount = computed(() => countByState('COMPLETED'));
const categoryLabelsById = computed(() => {
  const labels = new Map(seededCategoryLabels);
  for (const category of checklistCategoriesStore.categories) labels.set(category.id, category.name);
  return labels;
});

const statusRows = computed<StatusRow[]>(() => {
  const total = jobOrders.value.length;
  return jobStates.map((state) => {
    const count = countByState(state);
    return {
      state,
      count,
      percent: total === 0 ? 0 : Math.round((count / total) * 100),
    };
  });
});

const populatedStatusRows = computed(() => statusRows.value.filter((row) => row.count > 0));

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

  return [...counts.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
});

const attentionRows = computed<AttentionRow[]>(() => [
  {
    key: 'overdue',
    label: 'Overdue jobs',
    count: overdueCount.value,
    to: '/job-orders?overdue=1',
    color: '#7A2E2E',
  },
  {
    key: 'pending-review',
    label: 'Pending review jobs',
    count: pendingReviewCount.value,
    to: '/job-orders?state=PENDING_REVIEW',
    color: jobOrderStateMeta('PENDING_REVIEW').textColor,
  },
].filter((row) => row.count > 0));

const statusChartSummary = computed(() =>
  populatedStatusRows.value.map((row) => `${jobOrderStateMeta(row.state).label}: ${row.count}`).join(', ') || 'No job orders to chart.',
);
const categoryChartSummary = computed(() =>
  categoryRows.value.map((row) => `${row.label}: ${row.count}`).join(', ') || 'No service categories to chart.',
);

function countByState(state: JobState): number {
  return jobOrders.value.filter((jobOrder) => jobOrder.state === state).length;
}

function pluraliseJob(count: number): string {
  return count === 1 ? 'job' : 'jobs';
}

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

function destroyCharts(): void {
  statusChart?.destroy();
  categoryChart?.destroy();
  earningsChart?.destroy();
  statusChart = null;
  categoryChart = null;
  earningsChart = null;
}

function renderCharts(): void {
  renderStatusChart();
  renderCategoryChart();
  renderEarningsChart();
}

function renderStatusChart(): void {
  if (!statusCanvas.value) return;
  statusChart?.destroy();
  const rows = populatedStatusRows.value.length ? populatedStatusRows.value : statusRows.value.slice(0, 1);
  const config: ChartConfiguration<'doughnut'> = {
    type: 'doughnut',
    data: {
      labels: rows.map((row) => jobOrderStateMeta(row.state).label),
      datasets: [{
        data: rows.map((row) => row.count),
        backgroundColor: rows.map((row) => jobOrderStateMeta(row.state).backgroundColor),
        borderColor: rows.map((row) => jobOrderStateMeta(row.state).textColor),
        borderWidth: 1,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '68%',
      plugins: { legend: { display: false }, tooltip: { enabled: true } },
    },
  };
  statusChart = new Chart(statusCanvas.value, config);
}

function renderCategoryChart(): void {
  if (!categoryCanvas.value) return;
  categoryChart?.destroy();
  const rows = categoryRows.value.length ? categoryRows.value : [{ key: 'empty', label: 'No data', count: 0, fallback: true }];
  const config: ChartConfiguration<'bar'> = {
    type: 'bar',
    data: {
      labels: rows.map((row) => row.label),
      datasets: [{
        data: rows.map((row) => row.count),
        backgroundColor: rows.map((row) => row.fallback ? '#B0BAC2' : '#0B2A4A'),
        borderRadius: 6,
        borderSkipped: false,
      }],
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { enabled: true } },
      scales: {
        x: { beginAtZero: true, ticks: { precision: 0 } },
        y: { grid: { display: false } },
      },
    },
  };
  categoryChart = new Chart(categoryCanvas.value, config);
}

function renderEarningsChart(): void {
  if (!earningsCanvas.value) return;
  earningsChart?.destroy();
  const config: ChartConfiguration<'line'> = {
    type: 'line',
    data: {
      labels: sampleEarningsLabels,
      datasets: [{
        data: sampleEarnings,
        borderColor: '#8B98A3',
        backgroundColor: 'rgba(139, 152, 163, 0.12)',
        borderDash: [4, 3],
        pointBackgroundColor: '#8B98A3',
        pointRadius: 3,
        fill: true,
        tension: 0.35,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { enabled: true } },
      scales: {
        x: { grid: { display: false } },
        y: { beginAtZero: true, ticks: { callback: (value) => `$${Number(value).toLocaleString('en-SG')}` } },
      },
    },
  };
  earningsChart = new Chart(earningsCanvas.value, config);
}

function openRoute(path: string): void {
  void router.push(path);
}

onMounted(async () => {
  await loadJobOrders();
  await nextTick();
  renderCharts();
});

watch([statusRows, categoryRows], async () => {
  await nextTick();
  renderCharts();
});

onBeforeUnmount(destroyCharts);
</script>

<template>
  <main class="office-route crm-page" aria-labelledby="dashboard-title">
    <div class="record-list-card dashboard-card">
      <header class="crm-page__header dashboard-header">
        <div>
          <p class="crm-page__eyebrow">Management</p>
          <h1 id="dashboard-title" class="crm-page__title">Dashboard</h1>
          <p class="record-form__version">Overview of all job orders.</p>
        </div>

        <div class="dashboard-range" aria-label="Date range">
          <!-- TODO(ux): wire to backend once date-range filtering exists. -->
          <button type="button" :class="{ 'dashboard-range__chip--active': dateRange === 'week' }" class="dashboard-range__chip" @click="dateRange = 'week'">This week</button>
          <button type="button" :class="{ 'dashboard-range__chip--active': dateRange === 'month' }" class="dashboard-range__chip" @click="dateRange = 'month'">This month</button>
          <button type="button" :class="{ 'dashboard-range__chip--active': dateRange === 'all' }" class="dashboard-range__chip" @click="dateRange = 'all'">All time</button>
        </div>
      </header>

      <section class="dashboard-actions" aria-label="Quick actions">
        <Button label="New job order" icon="pi pi-plus" @click="openRoute('/job-orders/new')" />
        <Button label="New client" icon="pi pi-plus" severity="secondary" @click="openRoute('/clients/new')" />
        <Button label="New vessel" icon="pi pi-plus" severity="secondary" @click="openRoute('/vessels/new')" />
      </section>

      <div v-if="errorMessage" class="record-form__actions record-form__actions--left" role="alert">
        <p class="auth-message auth-message--error">
          {{ errorMessage }}
        </p>
        <Button label="Retry" icon="pi pi-refresh" severity="secondary" :loading="jobOrdersStore.isLoading" @click="loadJobOrders" />
      </div>

      <p v-if="jobOrdersStore.isLoading" class="crm-empty">Loading dashboard...</p>

      <section class="dashboard-kpis" aria-label="Job order KPIs">
        <article class="dashboard-kpi">
          <span class="dashboard-kpi__icon ti ti-briefcase" aria-hidden="true" />
          <div>
            <p class="crm-page__eyebrow">Active jobs</p>
            <p class="dashboard-kpi__value">{{ activeJobCount }}</p>
            <p class="record-form__version">{{ activeJobCount }} active or in-progress {{ pluraliseJob(activeJobCount) }}.</p>
          </div>
        </article>

        <article class="dashboard-kpi">
          <span class="dashboard-kpi__icon dashboard-kpi__icon--danger ti ti-alert-triangle" aria-hidden="true" />
          <div>
            <p class="crm-page__eyebrow">Overdue</p>
            <p class="dashboard-kpi__value">{{ overdueCount }}</p>
            <p class="record-form__version">Deadline passed, excluding terminal jobs.</p>
          </div>
        </article>

        <article class="dashboard-kpi">
          <span class="dashboard-kpi__icon dashboard-kpi__icon--review ti ti-clipboard-check" aria-hidden="true" />
          <div>
            <p class="crm-page__eyebrow">Pending review</p>
            <p class="dashboard-kpi__value">{{ pendingReviewCount }}</p>
            <p class="record-form__version">Awaiting office completion review.</p>
          </div>
        </article>

        <article class="dashboard-kpi">
          <span class="dashboard-kpi__icon dashboard-kpi__icon--done ti ti-circle-check" aria-hidden="true" />
          <div>
            <p class="crm-page__eyebrow">Completed</p>
            <p class="dashboard-kpi__value">{{ completedCount }}</p>
            <p class="record-form__version">Raw completed count; trend pending date-range support.</p>
          </div>
        </article>
      </section>

      <section class="dashboard-grid" aria-label="Job order dashboard">
        <section class="dashboard-panel dashboard-panel--attention" aria-labelledby="attention-title">
          <div class="dashboard-panel__header">
            <h2 id="attention-title" class="crm-section__title">Needs attention</h2>
          </div>
          <div v-if="attentionRows.length" class="attention-list">
            <button v-for="row in attentionRows" :key="row.key" class="attention-row" type="button" @click="openRoute(row.to)">
              <span class="attention-row__dot" :style="{ background: row.color }" aria-hidden="true" />
              <span>{{ row.label }}</span>
              <strong>{{ row.count }}</strong>
              <i class="ti ti-chevron-right" aria-hidden="true" />
            </button>
          </div>
          <p v-else class="crm-empty">No overdue or pending-review jobs right now.</p>
        </section>

        <section class="dashboard-panel" aria-labelledby="status-breakdown-title">
          <div class="dashboard-panel__header">
            <h2 id="status-breakdown-title" class="crm-section__title">By status</h2>
          </div>
          <div class="dashboard-chart dashboard-chart--donut">
            <canvas ref="statusCanvas" role="img" :aria-label="`Job orders by status: ${statusChartSummary}`">
              {{ statusChartSummary }}
            </canvas>
          </div>
          <ul class="dashboard-legend" aria-label="Status legend">
            <li v-for="row in populatedStatusRows" :key="row.state">
              <span class="dashboard-legend__swatch" :style="{ background: jobOrderStateMeta(row.state).backgroundColor, borderColor: jobOrderStateMeta(row.state).textColor }" />
              <span>{{ jobOrderStateMeta(row.state).label }}</span>
              <strong>{{ row.count }}</strong>
            </li>
          </ul>
        </section>

        <section class="dashboard-panel" aria-labelledby="category-breakdown-title">
          <div class="dashboard-panel__header">
            <h2 id="category-breakdown-title" class="crm-section__title">By category</h2>
          </div>
          <div class="dashboard-chart dashboard-chart--bars">
            <canvas ref="categoryCanvas" role="img" :aria-label="`Job orders by service category: ${categoryChartSummary}`">
              {{ categoryChartSummary }}
            </canvas>
          </div>
        </section>

        <!-- Sample-only analytics block. Replace once the analytics/invoicing pipeline lands. -->
        <section class="dashboard-panel" aria-labelledby="earnings-sample-title">
          <div class="dashboard-panel__header">
            <h2 id="earnings-sample-title" class="crm-section__title">Earnings</h2>
            <span class="dashboard-sample-badge"><i class="ti ti-flask" aria-hidden="true" /> Sample data</span>
          </div>
          <div class="dashboard-chart dashboard-chart--line">
            <canvas ref="earningsCanvas" role="img" aria-label="Sample earnings line chart with illustrative values only.">
              Illustrative earnings sample: 4200, 5100, 4800, 6500, 7200, 8100, 9300.
            </canvas>
          </div>
          <p class="dashboard-sample-copy">Illustrative only — real figures pending the analytics module.</p>
        </section>
      </section>
    </div>
  </main>
</template>

<style scoped>
.dashboard-card {
  gap: 20px;
}

.dashboard-header {
  align-items: flex-start;
  gap: 16px;
}

.dashboard-range,
.dashboard-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.dashboard-range__chip {
  min-height: 32px;
  padding: 6px 12px;
  border: 0.5px solid #D3DCE3;
  border-radius: 999px;
  background: #FFFFFF;
  color: #34495C;
  font: inherit;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
}

.dashboard-range__chip--active {
  border-color: #0B2A4A;
  background: #EAF2FA;
  color: #0B2A4A;
  font-weight: 600;
}

.dashboard-kpis {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
}

.dashboard-kpi,
.dashboard-panel {
  border: 0.5px solid #D3DCE3;
  border-radius: 12px;
  background: #FFFFFF;
}

.dashboard-kpi {
  display: flex;
  gap: 12px;
  min-width: 0;
  padding: 16px;
}

.dashboard-kpi__icon {
  width: 36px;
  height: 36px;
  display: inline-grid;
  flex: 0 0 auto;
  place-items: center;
  border-radius: 10px;
  background: #E2EFFC;
  color: #0F4C92;
  font-size: 18px;
}

.dashboard-kpi__icon--danger {
  background: #F3E0E0;
  color: #7A2E2E;
}

.dashboard-kpi__icon--review {
  background: #F0E7F8;
  color: #5B2A86;
}

.dashboard-kpi__icon--done {
  background: #E3F3E8;
  color: #14692F;
}

.dashboard-kpi__value {
  margin: 4px 0;
  color: #11202E;
  font-size: 30px;
  font-weight: 600;
  line-height: 1;
}

.dashboard-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  align-items: start;
  gap: 16px;
}

.dashboard-panel {
  display: grid;
  gap: 14px;
  min-width: 0;
  padding: 18px;
}

.dashboard-panel--attention {
  min-height: 132px;
}

.dashboard-panel__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.dashboard-chart {
  position: relative;
  min-height: 220px;
}

.dashboard-chart--donut {
  height: 168px;
  min-height: 0;
}

.dashboard-chart--line {
  min-height: 220px;
}

.dashboard-legend,
.attention-list {
  display: grid;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.dashboard-legend li,
.attention-row {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
  color: #34495C;
  font-size: 13px;
}

.dashboard-legend__swatch {
  width: 12px;
  height: 12px;
  border: 1px solid;
  border-radius: 999px;
}

.attention-row {
  grid-template-columns: auto minmax(0, 1fr) auto auto;
  width: 100%;
  padding: 10px 12px;
  border: 0.5px solid #D3DCE3;
  border-radius: 8px;
  background: #FFFFFF;
  text-align: left;
  cursor: pointer;
}

.attention-row:hover {
  background: #F4F7FA;
}

.attention-row__dot {
  width: 9px;
  height: 9px;
  border-radius: 999px;
}

.dashboard-sample-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 3px 10px;
  border-radius: 999px;
  background: #ECEFF2;
  color: #5C7081;
  font-size: 12px;
  font-weight: 600;
}

.dashboard-sample-copy {
  margin: 0;
  color: #8B98A3;
  font-size: 13px;
  font-style: italic;
}

@media (max-width: 1100px) {
  .dashboard-kpis {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 760px) {
  .dashboard-kpis,
  .dashboard-grid {
    grid-template-columns: 1fr;
  }

  .dashboard-header {
    display: grid;
  }
}
</style>
