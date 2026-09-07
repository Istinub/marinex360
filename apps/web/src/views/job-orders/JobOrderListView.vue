<script setup lang="ts">
import Column from 'primevue/column';
import Button from 'primevue/button';
import Calendar from 'primevue/calendar';
import DataTable from 'primevue/datatable';
import InputText from 'primevue/inputtext';
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import MonoText from '@/components/common/MonoText.vue';
import { jobOrderStateClass, jobOrderStateLabel } from '@/composables/useJobOrderStateMeta';
import { ApiResponseError } from '@/lib/api/errors';
import type { JobOrder, JobState } from '@/lib/api/types';
import { useAuthStore } from '@/stores/auth';
import { useClientsStore } from '@/stores/clients';
import { useJobOrdersStore } from '@/stores/jobOrders';
import { useVesselsStore } from '@/stores/vessels';

const auth = useAuthStore();
const clientsStore = useClientsStore();
const jobOrdersStore = useJobOrdersStore();
const vesselsStore = useVesselsStore();
const router = useRouter();
const stateFilter = ref<JobState | ''>('');
const search = ref('');
const plannedFrom = ref<Date | null>(null);
const plannedTo = ref<Date | null>(null);
const errorMessage = ref<string | null>(null);
const createRoles = ['SYSTEM_ADMIN', 'DIRECTOR', 'OPS_SUPERVISOR'];
const canCreateJobOrder = computed(() => (auth.identity?.roles ?? []).some((role) => createRoles.includes(role)));

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

const clientNameById = computed(() => new Map(clientsStore.clients.map((client) => [client.id, client.name])));
const vesselNameById = computed(() => new Map(vesselsStore.vessels.map((vessel) => [vessel.id, vessel.name])));
const hasActiveFilters = computed(() => Boolean(stateFilter.value || search.value.trim() || plannedFrom.value || plannedTo.value));
const stateOptions = computed(() => jobStates.map((state) => ({ value: state, label: jobOrderStateLabel(state) })));

const filteredJobOrders = computed(() => {
  const query = search.value.trim().toLowerCase();
  return jobOrdersStore.sortedJobOrders.filter((jobOrder) => {
    if (stateFilter.value && jobOrder.state !== stateFilter.value) return false;

    if (query) {
      const clientName = clientLabel(jobOrder);
      const vesselName = vesselLabel(jobOrder);
      const searchable = [
        jobOrder.joNumber,
        jobOrder.scopeSummary,
        clientName,
        vesselName,
        jobOrder.clientId,
        jobOrder.vesselId,
      ].join(' ').toLowerCase();
      if (!searchable.includes(query)) return false;
    }

    const plannedFromDate = dateFilterValue(plannedFrom.value);
    const plannedToDate = dateFilterValue(plannedTo.value);
    if (plannedFromDate || plannedToDate) {
      if (!jobOrder.plannedStartDate) return false;
      const plannedDate = jobOrder.plannedStartDate.slice(0, 10);
      if (plannedFromDate && plannedDate < plannedFromDate) return false;
      if (plannedToDate && plannedDate > plannedToDate) return false;
    }

    return true;
  });
});

function formatDate(value?: string | null): string {
  if (!value) return '-';
  return new Intl.DateTimeFormat('en-SG', { day: '2-digit', month: 'short' }).format(new Date(value));
}

function quoteAmount(jobOrder: JobOrder): string {
  return new Intl.NumberFormat('en-SG', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(jobOrder.quotedAmountMinor / 100);
}

function dateFilterValue(value: Date | null): string {
  if (!value) return '';
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function clientLabel(jobOrder: JobOrder): string {
  return clientNameById.value.get(jobOrder.clientId) ?? jobOrder.clientId;
}

function vesselLabel(jobOrder: JobOrder): string {
  return vesselNameById.value.get(jobOrder.vesselId) ?? jobOrder.vesselId;
}

function openJobOrder(jobOrder: JobOrder): void {
  void router.push(`/job-orders/${jobOrder.id}`);
}

async function loadJobOrders(): Promise<void> {
  errorMessage.value = null;
  try {
    await Promise.all([
      jobOrdersStore.loadJobOrders(),
      clientsStore.clients.length ? Promise.resolve(clientsStore.clients) : clientsStore.loadClients(),
      vesselsStore.vessels.length ? Promise.resolve(vesselsStore.vessels) : vesselsStore.list(),
    ]);
  } catch (error) {
    errorMessage.value = error instanceof ApiResponseError ? error.message : 'Unable to load job orders.';
  }
}

onMounted(loadJobOrders);
</script>

<template>
  <main class="office-route crm-page" aria-labelledby="job-orders-title">
    <div class="record-list-card">
      <header class="crm-page__header">
        <div>
          <p class="crm-page__eyebrow">Operations</p>
          <h1 id="job-orders-title" class="crm-page__title">Job orders</h1>
        </div>

        <Button v-if="canCreateJobOrder" label="New job order" icon="pi pi-plus" @click="router.push('/job-orders/new')" />
      </header>

      <section class="crm-toolbar" aria-label="Job order tools">
        <label class="crm-filter crm-toolbar__search" for="job-order-search">
          <span>Search</span>
          <InputText id="job-order-search" v-model="search" class="auth-input" placeholder="Search job orders" />
        </label>

        <label class="crm-filter" for="job-order-state-filter">
          <span>State</span>
          <select id="job-order-state-filter" v-model="stateFilter" class="auth-input">
            <option value="">All states</option>
            <option v-for="state in stateOptions" :key="state.value" :value="state.value">
              {{ state.label }}
            </option>
          </select>
        </label>

        <label class="crm-filter" for="job-order-planned-from">
          <span>From</span>
          <Calendar
            v-model="plannedFrom"
            input-id="job-order-planned-from"
            class="auth-input job-orders__calendar"
            date-format="dd/mm/yy"
            show-icon
          />
        </label>

        <label class="crm-filter" for="job-order-planned-to">
          <span>To</span>
          <Calendar
            v-model="plannedTo"
            input-id="job-order-planned-to"
            class="auth-input job-orders__calendar"
            date-format="dd/mm/yy"
            show-icon
          />
        </label>
      </section>

      <div v-if="errorMessage" class="record-form__actions record-form__actions--left" role="alert">
        <p class="auth-message auth-message--error">
          {{ errorMessage }}
        </p>
        <Button label="Retry" icon="pi pi-refresh" severity="secondary" :loading="jobOrdersStore.isLoading" @click="loadJobOrders" />
      </div>

      <DataTable
        :value="filteredJobOrders"
        :loading="jobOrdersStore.isLoading"
        data-key="id"
        size="small"
        striped-rows
        removable-sort
        class="crm-table"
        @row-click="openJobOrder($event.data)"
      >
        <template #empty>
          <div class="crm-empty">
            {{ hasActiveFilters ? 'No job orders match your filters' : 'No job orders yet.' }}
          </div>
        </template>

        <Column field="joNumber" header="JO" sortable>
          <template #body="{ data }">
            <span class="job-orders__jo">
              <MonoText :value="data.joNumber" />
              <!-- version is the OD-05 optimistic-lock field, kept visible only for debugging. -->
              <span class="job-orders__version-badge">v{{ data.version }}</span>
            </span>
          </template>
        </Column>
        <Column field="state" header="State" sortable>
          <template #body="{ data }">
            <span class="jo-chip" :class="jobOrderStateClass(data.state)">
              {{ jobOrderStateLabel(data.state) }}
            </span>
          </template>
        </Column>
        <Column field="clientId" header="Client / Vessel" sortable>
          <template #body="{ data }">
            <span class="job-orders__party">
              <span class="job-orders__party-client" :title="clientLabel(data)">{{ clientLabel(data) }}</span>
              <span class="job-orders__party-vessel" :title="vesselLabel(data)">{{ vesselLabel(data) }}</span>
            </span>
          </template>
        </Column>
        <Column field="scopeSummary" header="Scope" sortable>
          <template #body="{ data }">
            <span class="job-orders__scope" :title="data.scopeSummary">{{ data.scopeSummary }}</span>
          </template>
        </Column>
        <Column field="quotedAmountMinor" header="Quote" sortable body-class="job-orders__quote-cell" header-class="job-orders__quote-cell">
          <template #body="{ data }">
            <span class="job-orders__quote">
              <span class="job-orders__quote-currency">{{ data.quotedCurrency }}</span>
              <span class="mx-money">{{ quoteAmount(data) }}</span>
            </span>
          </template>
        </Column>
        <Column field="plannedStartDate" header="Planned" sortable>
          <template #body="{ data }">
            {{ formatDate(data.plannedStartDate) }}
          </template>
        </Column>
      </DataTable>
    </div>
  </main>
</template>

<style scoped>
.job-orders__calendar {
  padding: 0;
}

.job-orders__calendar :deep(.p-inputtext) {
  width: 100%;
  min-height: var(--tap-min);
  font-family: var(--font-ui);
}

.job-orders__jo,
.job-orders__party {
  display: inline-grid;
  gap: var(--sp-1);
}

.job-orders__jo {
  grid-auto-flow: column;
  align-items: baseline;
  gap: var(--sp-2);
}

.job-orders__version-badge {
  color: var(--color-text-muted);
  font-size: 11px;
  font-weight: 500;
}

.job-orders__party {
  max-width: 18rem;
  min-width: 0;
}

.job-orders__party-client,
.job-orders__party-vessel {
  display: block;
  max-width: 100%;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.job-orders__party-client {
  color: var(--color-text);
}

.job-orders__party-vessel {
  color: #5C7081;
  font-size: 12px;
}

.job-orders__scope {
  display: block;
  max-width: 22rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.job-orders__quote-cell {
  min-width: 110px;
  text-align: right;
  white-space: nowrap;
}

.job-orders__quote {
  display: inline-flex;
  align-items: baseline;
  justify-content: flex-end;
  white-space: nowrap;
}

.job-orders__quote-currency {
  margin-right: 4px;
  color: #8B98A3;
  font-size: 11px;
}

.job-orders__quote .mx-money {
  font-family: 'IBM Plex Mono', ui-monospace, monospace;
}
</style>
