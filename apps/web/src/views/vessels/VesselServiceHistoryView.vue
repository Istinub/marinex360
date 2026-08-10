<script setup lang="ts">
import Button from 'primevue/button';
import Column from 'primevue/column';
import DataTable from 'primevue/datatable';
import { onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import MonoText from '@/components/common/MonoText.vue';
import NotFoundState from '@/components/common/NotFoundState.vue';
import { get } from '@/lib/api/client';
import { ApiResponseError } from '@/lib/api/errors';
import type { JobOrderSummary } from '@/lib/api/types';

const route = useRoute();
const router = useRouter();
const vesselId = String(route.params.id);
const jobOrders = ref<JobOrderSummary[]>([]);
const isLoading = ref(true);
const isNotFound = ref(false);
const errorMessage = ref<string | null>(null);

function jobOrderStateClass(state: string): string {
  return `mx-jo-${state.toLowerCase().replace(/[_\s-]/g, '')}`;
}

function formatDate(value?: string | null): string {
  if (!value) return '—';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(value));
}

onMounted(async () => {
  try {
    jobOrders.value = await get<JobOrderSummary[]>(`/vessels/${vesselId}/job-orders`);
  } catch (error) {
    if (error instanceof ApiResponseError && error.code === 'NOT_FOUND') {
      isNotFound.value = true;
      return;
    }
    errorMessage.value = error instanceof ApiResponseError ? error.message : 'Unable to load service history.';
  } finally {
    isLoading.value = false;
  }
});
</script>

<template>
  <NotFoundState v-if="isNotFound" />

  <main v-else class="office-route crm-page" aria-labelledby="vessel-history-title">
    <header class="crm-page__header">
      <div>
        <p class="crm-page__eyebrow">Vessel</p>
        <h1 id="vessel-history-title" class="crm-page__title">Service history</h1>
        <p class="record-form__version">
          Vessel ID <MonoText :value="vesselId" />
        </p>
      </div>

      <Button label="New vessel" icon="pi pi-plus" @click="router.push('/vessels/new')" />
    </header>

    <p v-if="errorMessage" class="auth-message auth-message--error" role="alert">
      {{ errorMessage }}
    </p>

    <DataTable
      :value="jobOrders"
      :loading="isLoading"
      data-key="id"
      size="small"
      striped-rows
      removable-sort
      class="crm-table"
    >
      <template #empty>
        <div class="crm-empty">No service history yet.</div>
      </template>

      <Column field="joNumber" header="Job order" sortable>
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
      <Column field="plannedStartDate" header="Planned start" sortable>
        <template #body="{ data }">
          {{ formatDate(data.plannedStartDate) }}
        </template>
      </Column>
    </DataTable>
  </main>
</template>
