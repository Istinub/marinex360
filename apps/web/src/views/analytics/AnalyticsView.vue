<script setup lang="ts">
import Button from 'primevue/button';
import Calendar from 'primevue/calendar';
import Column from 'primevue/column';
import DataTable from 'primevue/datatable';
import InputText from 'primevue/inputtext';
import {
  BarController,
  BarElement,
  CategoryScale,
  Chart,
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
import MonoText from '@/components/common/MonoText.vue';
import { ApiResponseError } from '@/lib/api/errors';
import { get } from '@/lib/api/client';
import { formatMoney } from '@/lib/money';
import type { Invoice, JobOrder, JobState } from '@/lib/api/types';
import { useChecklistCategoriesStore } from '@/stores/checklistCategories';
import { useClientsStore } from '@/stores/clients';
import { useJobOrdersStore } from '@/stores/jobOrders';
import { useVesselsStore } from '@/stores/vessels';

Chart.register(BarController, BarElement, CategoryScale, Filler, Legend, LinearScale, LineController, LineElement, PointElement, Tooltip);

interface SalesRow {
  key: string;
  date: string;
  client: string;
  vessel: string;
  category: string;
  jobOrderId: string;
  joNumber: string;
  amountMinor: number;
  currency: string;
}

interface RevenuePoint {
  label: string;
  amountMinor: number;
}

interface GroupedRevenue {
  key: string;
  label: string;
  amountMinor: number;
  fallback?: boolean;
}

const router = useRouter();
const checklistCategoriesStore = useChecklistCategoriesStore();
const clientsStore = useClientsStore();
const jobOrdersStore = useJobOrdersStore();
const vesselsStore = useVesselsStore();
const invoices = ref<Invoice[]>([]);
const isLoading = ref(false);
const errorMessage = ref<string | null>(null);
const trendCanvas = ref<HTMLCanvasElement | null>(null);
const categoryCanvas = ref<HTMLCanvasElement | null>(null);
const partyCanvas = ref<HTMLCanvasElement | null>(null);
let trendChart: Chart | null = null;
let categoryChart: Chart | null = null;
let partyChart: Chart | null = null;

const branchFilter = ref('');
const clientFilter = ref('');
const vesselFilter = ref('');
const categoryFilter = ref('');
const stateFilter = ref('');
const technicianFilter = ref('');
const dateRange = ref<Date[] | null>(null);

const filterPendingTitle = 'Pending FR-72 sales-report endpoint support.';
const exportPendingTitle = 'Pending FR-74 analytics export endpoint.';
const savedViewsPendingTitle = 'Pending FR-73 SavedView persistence.';
const jobStates: JobState[] = ['DRAFT', 'SCHEDULED', 'IN_PROGRESS', 'PENDING_REVIEW', 'COMPLETED', 'INVOICED', 'CLOSED', 'ON_HOLD', 'CANCELLED'];
const seededCategoryLabels = new Map([
  ['inspection', 'Inspection'],
  ['electrical', 'Electrical'],
  ['mechanical', 'Mechanical'],
  ['hull', 'Hull'],
  ['safety', 'Safety'],
  ['other', 'Other'],
]);
const sampleTrend = [620000, 710000, 680000, 835000, 920000, 1040000];
const samplePreviousTrend = [540000, 635000, 610000, 730000, 790000, 880000];
const sampleLabels = ['Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep'];

const jobOrderById = computed(() => new Map(jobOrdersStore.jobOrders.map((jobOrder) => [jobOrder.id, jobOrder])));
const clientNameById = computed(() => new Map(clientsStore.clients.map((client) => [client.id, client.name])));
const vesselNameById = computed(() => new Map(vesselsStore.vessels.map((vessel) => [vessel.id, vessel.name])));
const categoryLabelsById = computed(() => {
  const labels = new Map(seededCategoryLabels);
  for (const category of checklistCategoriesStore.categories) labels.set(category.id, category.name);
  return labels;
});
const issuedInvoices = computed(() => invoices.value.filter((invoice) => invoice.status !== 'DRAFT'));
const salesRows = computed<SalesRow[]>(() =>
  issuedInvoices.value
    .map((invoice) => {
      const jobOrder = jobOrderById.value.get(invoice.jobOrderId);
      const categories = categoriesForJob(jobOrder);
      return {
        key: invoice.id,
        date: invoice.issuedAt ?? invoice.createdAt ?? '',
        client: clientLabel(jobOrder, invoice),
        vessel: vesselLabel(jobOrder),
        category: categories.join(', ') || 'Uncategorized',
        jobOrderId: invoice.jobOrderId,
        joNumber: jobOrder?.joNumber ?? 'Unlinked JO',
        amountMinor: invoice.totalAmountMinor,
        currency: invoice.totalCurrency,
      };
    })
    .sort((a, b) => (b.date || '').localeCompare(a.date || '')),
);
const revenueTotalMinor = computed(() => issuedInvoices.value.reduce((sum, invoice) => sum + invoice.totalAmountMinor, 0));
const invoiceCount = computed(() => issuedInvoices.value.length);
const averageInvoiceMinor = computed(() => invoiceCount.value ? Math.round(revenueTotalMinor.value / invoiceCount.value) : 0);
const approvedVariationTotalMinor = computed(() =>
  jobOrdersStore.jobOrders.reduce((sum, jobOrder) =>
    sum + (jobOrder.variations ?? [])
      .filter((variation) => variation.status === 'APPROVED')
      .reduce((variationSum, variation) => variationSum + variation.amountMinor, 0),
  0),
);
const outstandingBalanceMinor = computed(() =>
  issuedInvoices.value.reduce((sum, invoice) => {
    const paid = (invoice.payments ?? []).reduce((paymentSum, payment) => paymentSum + payment.amountMinor, 0);
    return sum + Math.max(invoice.totalAmountMinor - paid, 0);
  }, 0),
);
const primaryCurrency = computed(() => issuedInvoices.value[0]?.totalCurrency ?? 'SGD');
const currentTrend = computed<RevenuePoint[]>(() => monthlyTrend(issuedInvoices.value, 0));
const previousTrend = computed<RevenuePoint[]>(() => monthlyTrend(issuedInvoices.value, 6));
const previousTotalMinor = computed(() => previousTrend.value.reduce((sum, point) => sum + point.amountMinor, 0));
const periodDeltaLabel = computed(() => {
  if (!previousTotalMinor.value) return 'No previous-period baseline';
  const delta = ((revenueTotalMinor.value - previousTotalMinor.value) / previousTotalMinor.value) * 100;
  return `${delta >= 0 ? '+' : ''}${delta.toFixed(1)}% vs previous period`;
});
const revenueByCategory = computed<GroupedRevenue[]>(() => {
  const counts = new Map<string, GroupedRevenue>();
  for (const invoice of issuedInvoices.value) {
    const jobOrder = jobOrderById.value.get(invoice.jobOrderId);
    const rawCategories = jobOrder?.serviceCategories?.length ? jobOrder.serviceCategories : ['__uncategorized'];
    const splitAmount = Math.round(invoice.totalAmountMinor / rawCategories.length);
    for (const rawCategory of rawCategories) {
      const categoryId = rawCategory.trim();
      const label = categoryLabelsById.value.get(categoryId);
      const key = label ? categoryId : '__uncategorized';
      const row = counts.get(key) ?? {
        key,
        label: label ?? 'Uncategorized',
        amountMinor: 0,
        fallback: !label,
      };
      row.amountMinor += splitAmount;
      counts.set(key, row);
    }
  }
  return [...counts.values()].sort((a, b) => b.amountMinor - a.amountMinor || a.label.localeCompare(b.label));
});
const revenueByParty = computed<GroupedRevenue[]>(() => {
  const counts = new Map<string, GroupedRevenue>();
  for (const invoice of issuedInvoices.value) {
    const jobOrder = jobOrderById.value.get(invoice.jobOrderId);
    const key = `${clientLabel(jobOrder, invoice)} / ${vesselLabel(jobOrder)}`;
    const row = counts.get(key) ?? { key, label: key, amountMinor: 0 };
    row.amountMinor += invoice.totalAmountMinor;
    counts.set(key, row);
  }
  return [...counts.values()].sort((a, b) => b.amountMinor - a.amountMinor || a.label.localeCompare(b.label)).slice(0, 8);
});
const trendSummary = computed(() => currentTrend.value.map((point) => `${point.label}: ${money(point.amountMinor)}`).join(', ') || 'No issued invoice trend data.');
const categorySummary = computed(() => revenueByCategory.value.map((row) => `${row.label}: ${money(row.amountMinor)}`).join(', ') || 'No revenue by category data.');
const partySummary = computed(() => revenueByParty.value.map((row) => `${row.label}: ${money(row.amountMinor)}`).join(', ') || 'No revenue by client or vessel data.');

function money(amountMinor: number, currency = primaryCurrency.value): string {
  return formatMoney({ amountMinor, currency });
}

function formatDate(value?: string | null): string {
  if (!value) return '-';
  return new Intl.DateTimeFormat('en-SG', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(value));
}

function monthLabel(date: Date): string {
  return new Intl.DateTimeFormat('en-SG', { month: 'short' }).format(date);
}

function clientLabel(jobOrder?: JobOrder, invoice?: Invoice): string {
  if (jobOrder?.client?.name) return jobOrder.client.name;
  if (jobOrder?.clientId && clientNameById.value.has(jobOrder.clientId)) return clientNameById.value.get(jobOrder.clientId) as string;
  return invoice?.billToName ?? 'Unnamed client';
}

function vesselLabel(jobOrder?: JobOrder): string {
  if (jobOrder?.vessel?.name) return jobOrder.vessel.name;
  if (jobOrder?.vesselId && vesselNameById.value.has(jobOrder.vesselId)) return vesselNameById.value.get(jobOrder.vesselId) as string;
  return 'Unnamed vessel';
}

function categoriesForJob(jobOrder?: JobOrder): string[] {
  if (!jobOrder?.serviceCategories?.length) return ['Uncategorized'];
  return jobOrder.serviceCategories.map((category) => categoryLabelsById.value.get(category) ?? 'Uncategorized');
}

function monthStart(offsetMonths: number): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth() - offsetMonths, 1);
}

function monthlyTrend(rows: Invoice[], offsetMonths: number): RevenuePoint[] {
  return Array.from({ length: 6 }, (_value, index) => {
    const month = monthStart(offsetMonths + 5 - index);
    const nextMonth = new Date(month.getFullYear(), month.getMonth() + 1, 1);
    const amountMinor = rows
      .filter((invoice) => {
        const date = invoice.issuedAt ? new Date(invoice.issuedAt) : invoice.createdAt ? new Date(invoice.createdAt) : null;
        return date != null && date >= month && date < nextMonth;
      })
      .reduce((sum, invoice) => sum + invoice.totalAmountMinor, 0);
    return { label: monthLabel(month), amountMinor };
  });
}

function chartAmounts(rows: GroupedRevenue[], sample: number[]): number[] {
  return rows.length ? rows.map((row) => row.amountMinor / 100) : sample.map((amount) => amount / 100);
}

function destroyCharts(): void {
  trendChart?.destroy();
  categoryChart?.destroy();
  partyChart?.destroy();
  trendChart = null;
  categoryChart = null;
  partyChart = null;
}

function renderCharts(): void {
  renderTrendChart();
  renderCategoryChart();
  renderPartyChart();
}

function renderTrendChart(): void {
  if (!trendCanvas.value) return;
  trendChart?.destroy();
  const hasRealData = issuedInvoices.value.length > 0;
  const current = hasRealData ? currentTrend.value.map((point) => point.amountMinor / 100) : sampleTrend.map((amount) => amount / 100);
  const previous = hasRealData ? previousTrend.value.map((point) => point.amountMinor / 100) : samplePreviousTrend.map((amount) => amount / 100);
  const labels = hasRealData ? currentTrend.value.map((point) => point.label) : sampleLabels;
  const config: ChartConfiguration<'line'> = {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Current period',
          data: current,
          borderColor: hasRealData ? '#0B2A4A' : '#8B98A3',
          backgroundColor: hasRealData ? 'rgba(11, 42, 74, 0.12)' : 'rgba(139, 152, 163, 0.12)',
          borderDash: hasRealData ? [] : [4, 3],
          pointBackgroundColor: hasRealData ? '#0B2A4A' : '#8B98A3',
          tension: 0.35,
          fill: true,
        },
        {
          label: 'Previous period',
          data: previous,
          borderColor: '#8B98A3',
          borderDash: [5, 4],
          pointRadius: 2,
          tension: 0.35,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { position: 'bottom' }, tooltip: { enabled: true } },
      scales: {
        x: { grid: { display: false } },
        y: { beginAtZero: true, ticks: { callback: (value) => `$${Number(value).toLocaleString('en-SG')}` } },
      },
    },
  };
  trendChart = new Chart(trendCanvas.value, config);
}

function renderCategoryChart(): void {
  if (!categoryCanvas.value) return;
  categoryChart?.destroy();
  const hasRealData = revenueByCategory.value.length > 0;
  const labels = hasRealData ? revenueByCategory.value.map((row) => row.label) : ['Inspection', 'Mechanical', 'Safety'];
  const config: ChartConfiguration<'bar'> = {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        data: chartAmounts(revenueByCategory.value, [320000, 250000, 180000]),
        backgroundColor: hasRealData ? revenueByCategory.value.map((row) => row.fallback ? '#B0BAC2' : '#0B2A4A') : '#B0BAC2',
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
        x: { beginAtZero: true, ticks: { callback: (value) => `$${Number(value).toLocaleString('en-SG')}` } },
        y: { grid: { display: false } },
      },
    },
  };
  categoryChart = new Chart(categoryCanvas.value, config);
}

function renderPartyChart(): void {
  if (!partyCanvas.value) return;
  partyChart?.destroy();
  const hasRealData = revenueByParty.value.length > 0;
  const labels = hasRealData ? revenueByParty.value.map((row) => row.label) : ['Pacific Lines / MV Demo', 'Straits Marine / Harbour Launch', 'Bluewater / OSV Sample'];
  const config: ChartConfiguration<'bar'> = {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        data: chartAmounts(revenueByParty.value, [410000, 290000, 160000]),
        backgroundColor: hasRealData ? '#0E7C86' : '#B0BAC2',
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
        x: { beginAtZero: true, ticks: { callback: (value) => `$${Number(value).toLocaleString('en-SG')}` } },
        y: { grid: { display: false } },
      },
    },
  };
  partyChart = new Chart(partyCanvas.value, config);
}

async function loadAnalytics(): Promise<void> {
  isLoading.value = true;
  errorMessage.value = null;
  try {
    const invoiceList = await get<Invoice[]>('/invoices');
    const invoiceDetails = await Promise.all(invoiceList.map((invoice) => get<Invoice>(`/invoices/${invoice.id}`)));
    invoices.value = invoiceDetails;
    await Promise.all([
      jobOrdersStore.loadJobOrders(),
      clientsStore.clients.length ? Promise.resolve(clientsStore.clients) : clientsStore.loadClients(),
      vesselsStore.vessels.length ? Promise.resolve(vesselsStore.vessels) : vesselsStore.list(),
      checklistCategoriesStore.categories.length ? Promise.resolve(checklistCategoriesStore.categories) : checklistCategoriesStore.load(),
    ]);
    await nextTick();
    renderCharts();
  } catch (error) {
    errorMessage.value = error instanceof ApiResponseError ? error.message : 'Unable to load analytics data.';
  } finally {
    isLoading.value = false;
  }
}

function openJobOrder(row: SalesRow): void {
  void router.push(`/job-orders/${row.jobOrderId}`);
}

onMounted(loadAnalytics);

watch([issuedInvoices, revenueByCategory, revenueByParty], async () => {
  await nextTick();
  renderCharts();
});

onBeforeUnmount(destroyCharts);
</script>

<template>
  <main class="office-route crm-page" aria-labelledby="analytics-title">
    <div class="record-list-card analytics-card">
      <header class="crm-page__header analytics-header">
        <div>
          <p class="crm-page__eyebrow">Business Analytics</p>
          <h1 id="analytics-title" class="crm-page__title">Sales & Analytics</h1>
          <p class="record-form__version">Invoice-backed sales snapshot. Full FR-71 reporting filters are pending the analytics API.</p>
        </div>

        <Button
          label="Export"
          icon="pi pi-download"
          severity="secondary"
          disabled
          :title="exportPendingTitle"
        />
      </header>

      <section class="crm-toolbar analytics-filterbar" aria-label="Sales analytics filters">
        <label class="crm-filter">
          <span>Branch</span>
          <select v-model="branchFilter" class="auth-input" disabled :title="filterPendingTitle">
            <option value="">All branches</option>
            <option value="SG">SG</option>
            <option value="MY">MY</option>
            <option value="ID">ID</option>
            <option value="BD">BD</option>
          </select>
        </label>

        <label class="crm-filter">
          <span>Client</span>
          <select v-model="clientFilter" class="auth-input" disabled :title="filterPendingTitle">
            <option value="">All clients</option>
            <option v-for="client in clientsStore.sortedClients" :key="client.id" :value="client.id">{{ client.name }}</option>
          </select>
        </label>

        <label class="crm-filter">
          <span>Vessel</span>
          <select v-model="vesselFilter" class="auth-input" disabled :title="filterPendingTitle">
            <option value="">All vessels</option>
            <option v-for="vessel in vesselsStore.sortedVessels" :key="vessel.id" :value="vessel.id">{{ vessel.name }}</option>
          </select>
        </label>

        <label class="crm-filter">
          <span>Category</span>
          <select v-model="categoryFilter" class="auth-input" disabled :title="filterPendingTitle">
            <option value="">All categories</option>
            <option v-for="category in checklistCategoriesStore.categories" :key="category.id" :value="category.id">{{ category.name }}</option>
          </select>
        </label>

        <label class="crm-filter">
          <span>JO status</span>
          <select v-model="stateFilter" class="auth-input" disabled :title="filterPendingTitle">
            <option value="">All statuses</option>
            <option v-for="state in jobStates" :key="state" :value="state">{{ state }}</option>
          </select>
        </label>

        <label class="crm-filter">
          <span>Technician</span>
          <InputText v-model="technicianFilter" class="auth-input" disabled :title="filterPendingTitle" placeholder="Any technician" />
        </label>

        <label class="crm-filter">
          <span>Date range</span>
          <Calendar
            v-model="dateRange"
            selection-mode="range"
            class="auth-input analytics-calendar"
            date-format="dd/mm/yy"
            show-icon
            disabled
            :title="filterPendingTitle"
          />
        </label>
      </section>

      <section class="analytics-saved-views" aria-label="Saved views">
        <span class="analytics-pill analytics-pill--sample"><i class="ti ti-flask" aria-hidden="true" /> Sample data</span>
        <button type="button" class="analytics-pill analytics-pill--dashed" disabled :title="savedViewsPendingTitle">
          <!-- TODO(ux): wire once SavedView persistence exists. -->
          Save current filters
        </button>
        <span class="analytics-pill analytics-pill--disabled" :title="savedViewsPendingTitle">Director overview</span>
        <span class="analytics-pill analytics-pill--disabled" :title="savedViewsPendingTitle">Outstanding invoices</span>
      </section>

      <div v-if="errorMessage" class="record-form__actions record-form__actions--left" role="alert">
        <p class="auth-message auth-message--error">{{ errorMessage }}</p>
        <Button label="Retry" icon="pi pi-refresh" severity="secondary" :loading="isLoading" @click="loadAnalytics" />
      </div>

      <p v-if="isLoading" class="crm-empty">Loading analytics...</p>

      <section class="analytics-kpis" aria-label="Sales KPIs">
        <article class="analytics-kpi">
          <p class="crm-page__eyebrow">Revenue</p>
          <p class="analytics-kpi__value">{{ money(revenueTotalMinor) }}</p>
          <p class="record-form__version">{{ periodDeltaLabel }}</p>
        </article>
        <article class="analytics-kpi">
          <p class="crm-page__eyebrow">Invoices issued</p>
          <p class="analytics-kpi__value">{{ invoiceCount }}</p>
          <p class="record-form__version">Average value {{ money(averageInvoiceMinor) }}</p>
        </article>
        <article class="analytics-kpi">
          <p class="crm-page__eyebrow">Approved variations</p>
          <p class="analytics-kpi__value">{{ money(approvedVariationTotalMinor) }}</p>
          <p class="record-form__version">From approved job-order variations.</p>
        </article>
        <article class="analytics-kpi">
          <p class="crm-page__eyebrow">Outstanding balance</p>
          <p class="analytics-kpi__value">{{ money(outstandingBalanceMinor) }}</p>
          <p class="record-form__version">Issued invoices less recorded payments.</p>
        </article>
      </section>

      <section class="analytics-panel" aria-labelledby="trend-title">
        <div class="analytics-panel__header">
          <div>
            <h2 id="trend-title" class="crm-section__title">Revenue trend</h2>
            <p class="record-form__version">Current period with previous-period comparison computed from issued invoices.</p>
          </div>
          <span v-if="!issuedInvoices.length" class="analytics-pill analytics-pill--sample"><i class="ti ti-flask" aria-hidden="true" /> Sample data</span>
        </div>
        <div class="analytics-chart analytics-chart--line">
          <canvas ref="trendCanvas" role="img" :aria-label="`Revenue trend: ${trendSummary}`">{{ trendSummary }}</canvas>
        </div>
        <p v-if="!issuedInvoices.length" class="analytics-sample-copy">Illustrative only — real figures appear once invoices are issued.</p>
      </section>

      <section class="analytics-grid" aria-label="Revenue breakdowns">
        <section class="analytics-panel" aria-labelledby="category-title">
          <div class="analytics-panel__header">
            <h2 id="category-title" class="crm-section__title">Revenue by category</h2>
            <span v-if="!revenueByCategory.length" class="analytics-pill analytics-pill--sample"><i class="ti ti-flask" aria-hidden="true" /> Sample data</span>
          </div>
          <div class="analytics-chart">
            <canvas ref="categoryCanvas" role="img" :aria-label="`Revenue by category: ${categorySummary}`">{{ categorySummary }}</canvas>
          </div>
          <p class="analytics-sample-copy">Multi-category jobs are split evenly until FR-71 delivers a canonical sales-report endpoint.</p>
        </section>

        <section class="analytics-panel" aria-labelledby="party-title">
          <div class="analytics-panel__header">
            <h2 id="party-title" class="crm-section__title">Revenue by client/vessel</h2>
            <span v-if="!revenueByParty.length" class="analytics-pill analytics-pill--sample"><i class="ti ti-flask" aria-hidden="true" /> Sample data</span>
          </div>
          <div class="analytics-chart">
            <canvas ref="partyCanvas" role="img" :aria-label="`Revenue by client and vessel: ${partySummary}`">{{ partySummary }}</canvas>
          </div>
        </section>
      </section>

      <section class="analytics-panel" aria-labelledby="sales-table-title">
        <div class="analytics-panel__header">
          <div>
            <h2 id="sales-table-title" class="crm-section__title">Sales report</h2>
            <p class="record-form__version">Real issued invoices, joined client-side to currently loaded job orders.</p>
          </div>
        </div>

        <DataTable
          :value="salesRows"
          :loading="isLoading"
          data-key="key"
          size="small"
          striped-rows
          removable-sort
          class="crm-table analytics-table"
          @row-click="openJobOrder($event.data)"
        >
          <template #empty>
            <div class="crm-empty">No issued invoices yet.</div>
          </template>

          <Column field="date" header="Date" sortable>
            <template #body="{ data }">{{ formatDate(data.date) }}</template>
          </Column>
          <Column field="client" header="Client / Vessel" sortable>
            <template #body="{ data }">
              <span class="analytics-party">
                <span class="analytics-party__client" :title="data.client">{{ data.client }}</span>
                <span class="analytics-party__vessel" :title="data.vessel">{{ data.vessel }}</span>
              </span>
            </template>
          </Column>
          <Column field="category" header="Category" sortable>
            <template #body="{ data }">
              <span class="analytics-truncate" :title="data.category">{{ data.category }}</span>
            </template>
          </Column>
          <Column field="joNumber" header="JO" sortable>
            <template #body="{ data }">
              <button type="button" class="analytics-jo-link" @click.stop="openJobOrder(data)">
                <MonoText :value="data.joNumber" />
              </button>
            </template>
          </Column>
          <Column field="amountMinor" header="Amount" sortable body-class="analytics-amount-cell" header-class="analytics-amount-cell">
            <template #body="{ data }">
              <span class="analytics-amount">
                <span class="analytics-amount__currency">{{ data.currency }}</span>
                <span class="mx-money">{{ new Intl.NumberFormat('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(data.amountMinor / 100) }}</span>
              </span>
            </template>
          </Column>
        </DataTable>
      </section>
    </div>
  </main>
</template>

<style scoped>
.analytics-card {
  gap: 20px;
}

.analytics-header {
  align-items: flex-start;
  gap: 16px;
}

.analytics-filterbar {
  align-items: end;
}

.analytics-filterbar .auth-input:disabled,
.analytics-filterbar :deep(.p-disabled) {
  cursor: not-allowed;
  opacity: 0.68;
}

.analytics-calendar {
  padding: 0;
}

.analytics-calendar :deep(.p-inputtext) {
  width: 100%;
  min-height: var(--tap-min);
  font-family: var(--font-ui);
}

.analytics-saved-views,
.analytics-kpis,
.analytics-grid {
  display: grid;
  gap: 12px;
}

.analytics-saved-views {
  grid-auto-flow: column;
  justify-content: start;
  overflow-x: auto;
}

.analytics-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 28px;
  padding: 3px 10px;
  border: 0.5px solid #D3DCE3;
  border-radius: 999px;
  background: #FFFFFF;
  color: #5C7081;
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
}

.analytics-pill--sample,
.analytics-pill--disabled {
  background: #ECEFF2;
}

.analytics-pill--dashed {
  border-style: dashed;
  cursor: not-allowed;
}

.analytics-kpis {
  grid-template-columns: repeat(4, minmax(0, 1fr));
}

.analytics-kpi,
.analytics-panel {
  border: 0.5px solid #D3DCE3;
  border-radius: 12px;
  background: #FFFFFF;
}

.analytics-kpi {
  min-width: 0;
  padding: 16px;
}

.analytics-kpi__value {
  margin: 4px 0;
  color: #11202E;
  font-family: var(--font-code);
  font-size: 26px;
  font-weight: 600;
  line-height: 1.1;
}

.analytics-panel {
  display: grid;
  gap: 14px;
  min-width: 0;
  padding: 18px;
}

.analytics-panel__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.analytics-chart {
  position: relative;
  min-height: 260px;
}

.analytics-chart--line {
  min-height: 280px;
}

.analytics-grid {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.analytics-sample-copy {
  margin: 0;
  color: #8B98A3;
  font-size: 13px;
  font-style: italic;
}

.analytics-party {
  display: inline-grid;
  gap: var(--sp-1);
  max-width: 18rem;
  min-width: 0;
}

.analytics-party__client,
.analytics-party__vessel,
.analytics-truncate {
  display: block;
  max-width: 100%;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.analytics-party__client {
  color: var(--color-text);
}

.analytics-party__vessel {
  color: #5C7081;
  font-size: 12px;
}

.analytics-truncate {
  max-width: 18rem;
}

.analytics-jo-link {
  padding: 0;
  border: 0;
  background: transparent;
  color: #0B2A4A;
  cursor: pointer;
  text-decoration: underline;
  text-underline-offset: 2px;
}

.analytics-amount-cell {
  min-width: 120px;
  text-align: right;
  white-space: nowrap;
}

.analytics-amount {
  display: inline-flex;
  align-items: baseline;
  justify-content: flex-end;
  white-space: nowrap;
}

.analytics-amount__currency {
  margin-right: 4px;
  color: #8B98A3;
  font-size: 11px;
}

.analytics-amount .mx-money {
  font-family: var(--font-code);
}

@media (max-width: 1100px) {
  .analytics-kpis {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 760px) {
  .analytics-kpis,
  .analytics-grid {
    grid-template-columns: 1fr;
  }

  .analytics-header,
  .analytics-panel__header {
    display: grid;
  }
}
</style>
