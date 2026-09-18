<script setup lang="ts">
import Button from 'primevue/button';
import Column from 'primevue/column';
import DataTable from 'primevue/datatable';
import InputText from 'primevue/inputtext';
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import MonoText from '@/components/common/MonoText.vue';
import { get } from '@/lib/api/client';
import { ApiResponseError } from '@/lib/api/errors';
import { useAuthStore } from '@/stores/auth';

interface Quotation {
  id: string;
  quotationNumber: string;
  status: string;
  category: string;
  quotationDate: string;
  client?: { name: string } | null;
  vessel?: { name: string } | null;
  manualClientName?: string | null;
  manualVesselName?: string | null;
}

const router = useRouter();
const auth = useAuthStore();
const quotations = ref<Quotation[]>([]);
const isLoading = ref(false);
const errorMessage = ref<string | null>(null);
const search = ref('');
const canCreate = computed(() => (auth.identity?.roles ?? []).some((role) => ['SYSTEM_ADMIN', 'DIRECTOR', 'OPS_SUPERVISOR'].includes(role)));
const filtered = computed(() => {
  const query = search.value.trim().toLowerCase();
  if (!query) return quotations.value;
  return quotations.value.filter((quotation) => [
    quotation.quotationNumber,
    quotation.client?.name ?? quotation.manualClientName,
    quotation.vessel?.name ?? quotation.manualVesselName,
    quotation.category,
    quotation.status,
  ].join(' ').toLowerCase().includes(query));
});

function party(quotation: Quotation): string {
  return [quotation.client?.name ?? quotation.manualClientName, quotation.vessel?.name ?? quotation.manualVesselName]
    .filter(Boolean)
    .join(' · ') || 'Unnamed';
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('en-SG', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(value));
}

async function load(): Promise<void> {
  isLoading.value = true;
  errorMessage.value = null;
  try {
    quotations.value = await get<Quotation[]>('/quotations');
  } catch (error) {
    errorMessage.value = error instanceof ApiResponseError ? error.message : 'Unable to load quotations.';
  } finally {
    isLoading.value = false;
  }
}

onMounted(load);
</script>

<template>
  <main class="office-route crm-page" aria-labelledby="quotations-title">
    <div class="record-list-card">
      <header class="crm-page__header">
        <div>
          <p class="crm-page__eyebrow">Job Management</p>
          <h1 id="quotations-title" class="crm-page__title">Quotations</h1>
        </div>
        <Button v-if="canCreate" label="New quotation" icon="pi pi-plus" @click="router.push('/quotations/new')" />
      </header>

      <section class="crm-toolbar" aria-label="Quotation tools">
        <label class="crm-filter crm-toolbar__search" for="quotation-search">
          <span>Search</span>
          <InputText id="quotation-search" v-model="search" class="auth-input" placeholder="Search quotations" />
        </label>
      </section>

      <p v-if="errorMessage" class="auth-message auth-message--error" role="alert">{{ errorMessage }}</p>

      <DataTable
        :value="filtered"
        :loading="isLoading"
        data-key="id"
        size="small"
        striped-rows
        class="crm-table"
        @row-click="router.push(`/quotations/${$event.data.id}`)"
      >
        <template #empty>
          <div class="crm-empty">No quotations yet.</div>
        </template>
        <Column field="quotationNumber" header="Quotation" sortable>
          <template #body="{ data }"><MonoText :value="data.quotationNumber" /></template>
        </Column>
        <Column header="Client / Ship">
          <template #body="{ data }">{{ party(data) }}</template>
        </Column>
        <Column field="category" header="Category" sortable />
        <Column field="status" header="Status" sortable>
          <template #body="{ data }"><span class="jo-chip mx-jo-draft">{{ data.status }}</span></template>
        </Column>
        <Column field="quotationDate" header="Date" sortable>
          <template #body="{ data }">{{ formatDate(data.quotationDate) }}</template>
        </Column>
      </DataTable>
    </div>
  </main>
</template>
