<script setup lang="ts">
import Button from 'primevue/button';
import Column from 'primevue/column';
import DataTable from 'primevue/datatable';
import InputText from 'primevue/inputtext';
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import MonoText from '@/components/common/MonoText.vue';
import { get, post } from '@/lib/api/client';
import { ApiResponseError } from '@/lib/api/errors';
import { useAuthStore } from '@/stores/auth';

interface Quotation {
  id: string;
  quotationNumber: string;
  status: string;
  category: string;
  quotationDate: string;
  currency: string;
  client?: { name: string } | null;
  vessel?: { name: string } | null;
  manualClientName?: string | null;
  manualVesselName?: string | null;
  lines?: Array<{ amount: string | number | null }>;
}

const router = useRouter();
const auth = useAuthStore();
const quotations = ref<Quotation[]>([]);
const isLoading = ref(false);
const errorMessage = ref<string | null>(null);
const search = ref('');
const canCreate = computed(() => (auth.identity?.roles ?? []).some((role) => ['SYSTEM_ADMIN', 'DIRECTOR', 'OPS_SUPERVISOR'].includes(role)));
const canDelete = computed(() => (auth.identity?.roles ?? []).some((role) => ['SYSTEM_ADMIN', 'DIRECTOR', 'OPS_SUPERVISOR'].includes(role)));
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

const statusMeta: Record<string, { label: string; text: string; bg: string }> = {
  DRAFT: { label: 'Draft', text: '#44525E', bg: '#ECEFF2' },
  SENT: { label: 'Sent', text: '#0F4C92', bg: '#E2EFFC' },
  ACCEPTED: { label: 'Accepted', text: '#14692F', bg: '#E3F3E8' },
  DECLINED: { label: 'Declined', text: '#7A2E2E', bg: '#F3E0E0' },
};

function party(quotation: Quotation): string {
  return [quotation.client?.name ?? quotation.manualClientName, quotation.vessel?.name ?? quotation.manualVesselName]
    .filter(Boolean)
    .join(' · ') || 'Unnamed';
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('en-SG', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(value));
}

function statusLabel(status: string): string {
  return statusMeta[status]?.label ?? status.toLowerCase().replaceAll('_', ' ');
}

function totalAmount(quotation: Quotation): string {
  const sum = (quotation.lines ?? []).reduce((acc, line) => {
    const n = Number(line.amount);
    return Number.isFinite(n) ? acc + n : acc;
  }, 0);
  return new Intl.NumberFormat('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(sum);
}

function tbaCount(quotation: Quotation): number {
  return (quotation.lines ?? []).filter((line) => line.amount == null || line.amount === '').length;
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

async function moveToTrash(quotation: Quotation): Promise<void> {
  errorMessage.value = null;
  try {
    await post(`/quotations/${quotation.id}/delete`, {});
    quotations.value = quotations.value.filter((row) => row.id !== quotation.id);
  } catch (error) {
    errorMessage.value = error instanceof ApiResponseError ? error.message : 'Unable to move quotation to trash.';
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
        <div class="quotation-actions">
          <Button v-if="canDelete" label="Trash" icon="pi pi-trash" severity="secondary" outlined @click="router.push('/quotations/trash')" />
          <Button v-if="canCreate" label="New quotation" icon="pi pi-plus" @click="router.push('/quotations/new')" />
        </div>
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
          <template #body="{ data }">
            <span class="quotation-truncate" :title="party(data)">{{ party(data) }}</span>
          </template>
        </Column>
        <Column field="category" header="Category" sortable>
          <template #body="{ data }">
            <span class="quotation-truncate" :title="data.category">{{ data.category }}</span>
          </template>
        </Column>
        <Column field="status" header="Status" sortable>
          <template #body="{ data }">
            <span
              class="quotation-status-pill"
              :style="{ color: statusMeta[data.status]?.text ?? '#44525E', background: statusMeta[data.status]?.bg ?? '#ECEFF2' }"
            >
              {{ statusLabel(data.status) }}
            </span>
          </template>
        </Column>
        <Column field="quotationDate" header="Date" sortable>
          <template #body="{ data }">{{ formatDate(data.quotationDate) }}</template>
        </Column>
        <Column header="Amount" header-class="quotation-amount-head" body-class="quotation-amount-cell">
          <template #body="{ data }">
            <span class="currency-code">{{ data.currency }}</span>
            <MonoText :value="totalAmount(data)" />
            <span v-if="tbaCount(data)" class="quotation-tba-note">{{ tbaCount(data) }} TBA</span>
          </template>
        </Column>
        <Column v-if="canDelete" header="Actions">
          <template #body="{ data }">
            <Button label="Move to trash" icon="pi pi-trash" severity="secondary" text @click.stop="moveToTrash(data)" />
          </template>
        </Column>
      </DataTable>
    </div>
  </main>
</template>

<style scoped>
.quotation-status-pill {
  display: inline-flex;
  align-items: center;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 500;
  padding: 3px 10px;
}

.quotation-actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--sp-2);
}

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

.quotation-tba-note {
  display: block;
  margin-top: 2px;
  color: #8b98a3;
  font-size: 11px;
}

:deep(.quotation-amount-head),
:deep(.quotation-amount-cell) {
  text-align: right;
  white-space: nowrap;
}
</style>
