<script setup lang="ts">
import Column from 'primevue/column';
import Button from 'primevue/button';
import DataTable from 'primevue/datatable';
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import MonoText from '@/components/common/MonoText.vue';
import { ApiResponseError } from '@/lib/api/errors';
import type { JobOrder, JobState } from '@/lib/api/types';
import { useJobOrdersStore } from '@/stores/jobOrders';

const jobOrdersStore = useJobOrdersStore();
const router = useRouter();
const stateFilter = ref<JobState | ''>('');
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

const filteredJobOrders = computed(() => {
  if (!stateFilter.value) return jobOrdersStore.sortedJobOrders;
  return jobOrdersStore.sortedJobOrders.filter((jobOrder) => jobOrder.state === stateFilter.value);
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

function openJobOrder(jobOrder: JobOrder): void {
  void router.push(`/job-orders/${jobOrder.id}`);
}

async function loadJobOrders(): Promise<void> {
  errorMessage.value = null;
  try {
    await jobOrdersStore.loadJobOrders();
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

      <Button label="New job order" icon="pi pi-plus" @click="router.push('/job-orders/new')" />
    </header>

    <section class="crm-toolbar" aria-label="Job order tools">
      <label class="crm-filter" for="job-order-state-filter">
        <span>State</span>
        <select id="job-order-state-filter" v-model="stateFilter" class="auth-input">
          <option value="">All states</option>
          <option v-for="state in jobStates" :key="state" :value="state">
            {{ state }}
          </option>
        </select>
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
        <div class="crm-empty">No job orders yet.</div>
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
          <MonoText :value="data.clientId" />
        </template>
      </Column>
      <Column field="vesselId" header="Vessel" sortable>
        <template #body="{ data }">
          <MonoText :value="data.vesselId" />
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
