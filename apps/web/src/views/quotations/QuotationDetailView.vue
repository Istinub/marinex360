<script setup lang="ts">
import Button from 'primevue/button';
import Column from 'primevue/column';
import DataTable from 'primevue/datatable';
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import BackLink from '@/components/common/BackLink.vue';
import MonoText from '@/components/common/MonoText.vue';
import NotFoundState from '@/components/common/NotFoundState.vue';
import { get, post } from '@/lib/api/client';
import { ApiResponseError } from '@/lib/api/errors';
import { useAuthStore } from '@/stores/auth';

interface QuotationLine {
  id: string;
  itemCode: string | null;
  description: string;
  unit: string | null;
  quantity: string | number | null;
  unitPrice: string | number | null;
  amount: string | number | null;
  remarks: string | null;
}

interface Quotation {
  id: string;
  quotationNumber: string;
  client?: { name: string } | null;
  vessel?: { name: string } | null;
  manualClientName: string | null;
  manualVesselName: string | null;
  category: string;
  quotationDate: string;
  location: string | null;
  currency: string;
  validityDays: number;
  workDurationText: string | null;
  exclusionsText: string;
  status: string;
  pdfObjectKey: string | null;
  version: number;
  lines: QuotationLine[];
}

interface PdfResponse {
  status: 'PENDING' | 'READY';
  url?: string;
}

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const quotation = ref<Quotation | null>(null);
const isLoading = ref(true);
const isGenerating = ref(false);
const isNotFound = ref(false);
const errorMessage = ref<string | null>(null);
const successMessage = ref<string | null>(null);
const quotationId = computed(() => String(route.params.id));
const roles = computed(() => auth.identity?.roles ?? []);
const canWrite = computed(() => roles.value.some((role) => ['OPS_SUPERVISOR', 'DIRECTOR', 'SYSTEM_ADMIN'].includes(role)));
const canEditDraft = computed(() => canWrite.value && quotation.value?.status === 'DRAFT');
const clientName = computed(() => quotation.value?.client?.name ?? quotation.value?.manualClientName ?? 'Unnamed client');
const vesselName = computed(() => quotation.value?.vessel?.name ?? quotation.value?.manualVesselName ?? 'Unnamed vessel');

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('en-SG', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(value));
}

function decimalText(value: string | number | null): string {
  if (value == null || value === '') return '';
  const n = Number(value);
  return Number.isFinite(n) ? new Intl.NumberFormat('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n) : '';
}

function totalAmount(): string {
  const sum = (quotation.value?.lines ?? []).reduce((acc, line) => {
    const n = Number(line.amount);
    return Number.isFinite(n) ? acc + n : acc;
  }, 0);
  return decimalText(sum);
}

async function loadQuotation(): Promise<void> {
  isLoading.value = true;
  errorMessage.value = null;
  try {
    quotation.value = await get<Quotation>(`/quotations/${quotationId.value}`);
  } catch (error) {
    if (error instanceof ApiResponseError && error.code === 'NOT_FOUND') {
      isNotFound.value = true;
      return;
    }
    errorMessage.value = error instanceof ApiResponseError ? error.message : 'Unable to load quotation.';
  } finally {
    isLoading.value = false;
  }
}

async function generatePdf(): Promise<void> {
  isGenerating.value = true;
  errorMessage.value = null;
  successMessage.value = null;
  try {
    await post(`/quotations/${quotationId.value}/generate-pdf`, {});
    successMessage.value = 'PDF generation queued.';
    await loadQuotation();
  } catch (error) {
    errorMessage.value = error instanceof ApiResponseError ? error.message : 'Unable to generate PDF.';
  } finally {
    isGenerating.value = false;
  }
}

async function openPdf(download = false): Promise<void> {
  errorMessage.value = null;
  try {
    const pdf = await get<PdfResponse>(`/quotations/${quotationId.value}/pdf`);
    if (pdf.status !== 'READY' || !pdf.url) {
      successMessage.value = 'PDF is still generating.';
      return;
    }
    if (download) {
      const link = document.createElement('a');
      link.href = pdf.url;
      link.download = `${quotation.value?.quotationNumber ?? 'quotation'}.pdf`;
      link.click();
      return;
    }
    window.open(pdf.url, '_blank', 'noopener,noreferrer');
  } catch (error) {
    errorMessage.value = error instanceof ApiResponseError ? error.message : 'Unable to open PDF.';
  }
}

onMounted(() => {
  void loadQuotation();
});
</script>

<template>
  <NotFoundState v-if="isNotFound" />

  <main v-else class="office-route crm-page" aria-labelledby="quotation-title">
    <p v-if="isLoading" class="crm-empty">Loading quotation...</p>
    <p v-else-if="errorMessage" class="auth-message auth-message--error" role="alert">{{ errorMessage }}</p>

    <div v-else-if="quotation" class="record-form-card">
      <header class="crm-page__header">
        <div>
          <BackLink to="/quotations" label="Quotations" />
          <p class="crm-page__eyebrow">Quotation</p>
          <h1 id="quotation-title" class="crm-page__title">
            <MonoText :value="quotation.quotationNumber" />
          </h1>
          <p class="record-form__version">{{ clientName }} · {{ vesselName }}</p>
        </div>
        <div class="quotation-actions">
          <span class="jo-chip mx-jo-draft">{{ quotation.status }}</span>
          <Button v-if="canEditDraft" label="Edit" icon="pi pi-pencil" severity="secondary" @click="router.push(`/quotations/${quotation.id}/edit`)" />
        </div>
      </header>

      <p v-if="successMessage" class="auth-message auth-message--success" role="status">{{ successMessage }}</p>

      <section class="crm-section" aria-labelledby="quotation-info-title">
        <h2 id="quotation-info-title" class="crm-section__title">Details</h2>
        <dl class="detail-grid">
          <div>
            <dt>Client</dt>
            <dd>{{ clientName }}</dd>
          </div>
          <div>
            <dt>Ship / vessel</dt>
            <dd>{{ vesselName }}</dd>
          </div>
          <div>
            <dt>Category</dt>
            <dd>{{ quotation.category }}</dd>
          </div>
          <div>
            <dt>Quotation date</dt>
            <dd>{{ formatDate(quotation.quotationDate) }}</dd>
          </div>
          <div>
            <dt>Location</dt>
            <dd>{{ quotation.location || 'Not stated' }}</dd>
          </div>
          <div>
            <dt>Validity</dt>
            <dd>{{ quotation.validityDays }} days</dd>
          </div>
          <div>
            <dt>Work duration</dt>
            <dd>{{ quotation.workDurationText || 'Not stated' }}</dd>
          </div>
          <div>
            <dt>Total</dt>
            <dd><span class="currency-code">{{ quotation.currency }}</span> <MonoText :value="totalAmount()" /></dd>
          </div>
        </dl>
      </section>

      <section class="crm-section" aria-labelledby="quotation-lines-title">
        <h2 id="quotation-lines-title" class="crm-section__title">Line items</h2>
        <DataTable :value="quotation.lines" responsive-layout="scroll">
          <Column header="SL.NO">
            <template #body="{ index }">{{ index + 1 }}</template>
          </Column>
          <Column field="itemCode" header="Item code" />
          <Column field="description" header="Description" />
          <Column field="unit" header="Unit" />
          <Column header="Qty">
            <template #body="{ data }">{{ decimalText(data.quantity) }}</template>
          </Column>
          <Column header="Unit price">
            <template #body="{ data }">{{ decimalText(data.unitPrice) }}</template>
          </Column>
          <Column header="Amount">
            <template #body="{ data }">{{ decimalText(data.amount) }}</template>
          </Column>
          <Column field="remarks" header="Remarks" />
        </DataTable>
      </section>

      <section class="crm-section" aria-labelledby="quotation-pdf-title">
        <h2 id="quotation-pdf-title" class="crm-section__title">PDF</h2>
        <div class="quotation-actions">
          <Button label="Generate PDF" icon="pi pi-file-pdf" :loading="isGenerating" @click="generatePdf" />
          <Button label="Preview PDF" icon="pi pi-eye" severity="secondary" :disabled="!quotation.pdfObjectKey" @click="openPdf(false)" />
          <Button label="Download PDF" icon="pi pi-download" severity="secondary" :disabled="!quotation.pdfObjectKey" @click="openPdf(true)" />
          <span v-if="!quotation.pdfObjectKey" class="record-form__version">PDF not generated yet.</span>
        </div>
      </section>

      <section class="crm-section" aria-labelledby="quotation-notes-title">
        <h2 id="quotation-notes-title" class="crm-section__title">Notes</h2>
        <p class="quotation-notes">{{ quotation.exclusionsText }}</p>
      </section>
    </div>
  </main>
</template>

<style scoped>
.quotation-actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--sp-2);
}

.currency-code {
  color: var(--color-text-muted);
  font-size: 0.82rem;
}

.quotation-notes {
  margin: 0;
  color: var(--color-text-muted);
  line-height: 1.5;
}
</style>
