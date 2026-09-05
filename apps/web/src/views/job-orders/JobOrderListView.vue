<script setup lang="ts">
import Column from 'primevue/column';
import Button from 'primevue/button';
import DataTable from 'primevue/datatable';
import InputText from 'primevue/inputtext';
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import MonoText from '@/components/common/MonoText.vue';
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
const plannedFrom = ref('');
const plannedTo = ref('');
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

    if (plannedFrom.value || plannedTo.value) {
      if (!jobOrder.plannedStartDate) return false;
      const plannedDate = jobOrder.plannedStartDate.slice(0, 10);
      if (plannedFrom.value && plannedDate < plannedFrom.value) return false;
      if (plannedTo.value && plannedDate > plannedTo.value) return false;
    }

    return true;
  });
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

function formatDate(value?: string | null): string {
  if (!value) return '—';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(value));
}

function moneyLabel(jobOrder: JobOrder): string {
  return `${jobOrder.quotedCurrency} ${(jobOrder.quotedAmountMinor / 100).toFixed(2)}`;
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
          <option v-for="state in jobStates" :key="state" :value="state">
            {{ state }}
          </option>
        </select>
      </label>

      <label class="crm-filter" for="job-order-planned-from">
        <span>From</span>
        <input id="job-order-planned-from" v-model="plannedFrom" class="auth-input" type="date" />
      </label>

      <label class="crm-filter" for="job-order-planned-to">
        <span>To</span>
        <input id="job-order-planned-to" v-model="plannedTo" class="auth-input" type="date" />
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
          <MonoText :value="data.joNumber" />
        </template>
      </Column>
      <Column field="state" header="State" sortable>
        <template #body="{ data }">
          <span class="jo-chip" :class="jobOrderStateClass(data.state)">
            {{ data.state }}
          </span>
        </template>
      </Column>
      <Column field="scopeSummary" header="Scope" sortable />
      <Column field="clientId" header="Client" sortable>
        <template #body="{ data }">
          {{ clientLabel(data) }}
        </template>
      </Column>
      <Column field="vesselId" header="Vessel" sortable>
        <template #body="{ data }">
          {{ vesselLabel(data) }}
        </template>
      </Column>
      <Column field="quotedAmountMinor" header="Quote" sortable>
        <template #body="{ data }">
          <span class="mx-money">{{ moneyLabel(data) }}</span>
        </template>
      </Column>
      <Column field="plannedStartDate" header="Planned" sortable>
        <template #body="{ data }">
          {{ formatDate(data.plannedStartDate) }}
        </template>
      </Column>
      <Column field="version" header="Version" sortable>
        <template #body="{ data }">
          <MonoText :value="data.version" />
        </template>
      </Column>
    </DataTable>
  </main>
</template>
