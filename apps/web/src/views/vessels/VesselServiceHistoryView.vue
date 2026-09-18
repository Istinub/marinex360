<script setup lang="ts">
import Button from 'primevue/button';
import Column from 'primevue/column';
import DataTable from 'primevue/datatable';
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import BackLink from '@/components/common/BackLink.vue';
import MonoText from '@/components/common/MonoText.vue';
import NotFoundState from '@/components/common/NotFoundState.vue';
import { get } from '@/lib/api/client';
import { ApiResponseError } from '@/lib/api/errors';
import type { JobOrderSummary, Vessel } from '@/lib/api/types';
import { useAuthStore } from '@/stores/auth';
import { useVesselsStore } from '@/stores/vessels';

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const vesselsStore = useVesselsStore();
const vesselId = String(route.params.id);
const jobOrders = ref<JobOrderSummary[]>([]);
const vessel = ref<Vessel | null>(null);
const isLoading = ref(true);
const isNotFound = ref(false);
const errorMessage = ref<string | null>(null);
const isAdmin = computed(() => auth.identity?.roles.includes('SYSTEM_ADMIN') ?? false);
const vesselName = computed(() => vessel.value?.name ?? 'Unnamed vessel');

function jobOrderStateClass(state: string): string {
  return `mx-jo-${state.toLowerCase().replace(/[_\s-]/g, '')}`;
}

function formatDate(value?: string | null): string {
  if (!value) return '—';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(value));
}

onMounted(async () => {
  try {
    const [orders, vessels] = await Promise.all([
      get<JobOrderSummary[]>(`/vessels/${vesselId}/job-orders`),
      vesselsStore.list(),
    ]);
    jobOrders.value = orders;
    vessel.value = vessels.find((item) => item.id === vesselId) ?? null;
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
        <BackLink to="/vessels" label="Vessels" />
        <h1 id="vessel-history-title" class="crm-page__title">Service history</h1>
        <p class="record-form__version">
          {{ vesselName }}
        </p>
        <p v-if="isAdmin" class="record-form__version technical-id">
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

<style scoped>
.technical-id {
  color: #5C7081;
  font-size: 12px;
}
</style>
