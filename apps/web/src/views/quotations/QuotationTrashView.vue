<script setup lang="ts">
import Button from 'primevue/button';
import Column from 'primevue/column';
import DataTable from 'primevue/datatable';
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import MonoText from '@/components/common/MonoText.vue';
import { get, post } from '@/lib/api/client';
import { ApiResponseError } from '@/lib/api/errors';

interface Quotation {
  id: string;
  quotationNumber: string;
  status: string;
  category: string;
  quotationDate: string;
  currency: string;
  deletedAt: string | null;
  client?: { name: string } | null;
  vessel?: { name: string } | null;
  manualClientName?: string | null;
  manualVesselName?: string | null;
  lines?: Array<{ amount: string | number | null }>;
}

const router = useRouter();
const quotations = ref<Quotation[]>([]);
const isLoading = ref(false);
const errorMessage = ref<string | null>(null);
const actionMessage = ref<string | null>(null);

function party(quotation: Quotation): string {
  return [quotation.client?.name ?? quotation.manualClientName, quotation.vessel?.name ?? quotation.manualVesselName]
    .filter(Boolean)
    .join(' · ') || 'Unnamed';
}

function formatDate(value?: string | null): string {
  if (!value) return '-';
  return new Intl.DateTimeFormat('en-SG', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(value));
}

function totalAmount(quotation: Quotation): string {
  const sum = (quotation.lines ?? []).reduce((acc, line) => {
    const n = Number(line.amount);
    return Number.isFinite(n) ? acc + n : acc;
  }, 0);
  return new Intl.NumberFormat('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(sum);
}

async function load(): Promise<void> {
  isLoading.value = true;
  errorMessage.value = null;
  try {
    quotations.value = await get<Quotation[]>('/quotations/trash');
  } catch (error) {
    errorMessage.value = error instanceof ApiResponseError ? error.message : 'Unable to load quotation trash.';
  } finally {
    isLoading.value = false;
  }
}

async function restore(quotation: Quotation): Promise<void> {
  errorMessage.value = null;
  actionMessage.value = null;
  try {
    await post(`/quotations/${quotation.id}/restore`, {});
    actionMessage.value = 'Quotation restored.';
    await load();
  } catch (error) {
    errorMessage.value = error instanceof ApiResponseError ? error.message : 'Unable to restore quotation.';
  }
}

onMounted(load);
</script>

<template>
  <main class="office-route crm-page" aria-labelledby="quotation-trash-title">
    <div class="record-list-card">
      <header class="crm-page__header">
        <div>
          <p class="crm-page__eyebrow">Job Management</p>
          <h1 id="quotation-trash-title" class="crm-page__title">Quotation trash</h1>
        </div>
        <Button label="Back to quotations" icon="pi pi-arrow-left" severity="secondary" outlined @click="router.push('/quotations')" />
      </header>

      <p v-if="actionMessage" class="auth-message auth-message--success" role="status">{{ actionMessage }}</p>
      <p v-if="errorMessage" class="auth-message auth-message--error" role="alert">{{ errorMessage }}</p>

      <DataTable :value="quotations" :loading="isLoading" data-key="id" size="small" striped-rows class="crm-table">
        <template #empty>
          <div class="crm-empty">Quotation trash is empty.</div>
        </template>

        <Column field="quotationNumber" header="Quotation">
          <template #body="{ data }"><MonoText :value="data.quotationNumber" /></template>
        </Column>
        <Column header="Client / Ship">
          <template #body="{ data }">
            <span class="quotation-truncate" :title="party(data)">{{ party(data) }}</span>
          </template>
        </Column>
        <Column field="category" header="Category" />
        <Column field="status" header="Status" />
        <Column field="deletedAt" header="Deleted">
          <template #body="{ data }">{{ formatDate(data.deletedAt) }}</template>
        </Column>
        <Column header="Amount" header-class="quotation-amount-head" body-class="quotation-amount-cell">
          <template #body="{ data }">
            <span class="currency-code">{{ data.currency }}</span>
            <MonoText :value="totalAmount(data)" />
          </template>
        </Column>
        <Column header="Actions">
          <template #body="{ data }">
            <Button label="Restore" icon="pi pi-refresh" severity="secondary" outlined @click="restore(data)" />
          </template>
        </Column>
      </DataTable>
    </div>
  </main>
</template>

<style scoped>
.quotation-truncate {
  display: block;
  max-width: 260px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.currency-code {
  color: #8b98a3;
  font-size: 11px;
  margin-right: 4px;
}

:deep(.quotation-amount-head),
:deep(.quotation-amount-cell) {
  text-align: right;
  white-space: nowrap;
}
</style>
