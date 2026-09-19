<script setup lang="ts">
import Button from 'primevue/button';
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
const canDuplicate = computed(() => canWrite.value && quotation.value != null);
const canEditDraft = computed(() => canWrite.value && quotation.value?.status === 'DRAFT');
const canMoveToTrash = computed(() => canWrite.value && quotation.value != null);
const clientName = computed(() => quotation.value?.client?.name ?? quotation.value?.manualClientName ?? 'Unnamed client');
const vesselName = computed(() => quotation.value?.vessel?.name ?? quotation.value?.manualVesselName ?? 'Unnamed vessel');
const statusMeta: Record<string, { label: string; text: string; bg: string }> = {
  DRAFT: { label: 'Draft', text: '#44525E', bg: '#ECEFF2' },
  SENT: { label: 'Sent', text: '#0F4C92', bg: '#E2EFFC' },
  ACCEPTED: { label: 'Accepted', text: '#14692F', bg: '#E3F3E8' },
  DECLINED: { label: 'Declined', text: '#7A2E2E', bg: '#F3E0E0' },
};
const pricedItems = computed(() => (quotation.value?.lines ?? []).filter((line) => line.amount != null && line.amount !== '').length);
const tbaItems = computed(() => (quotation.value?.lines ?? []).filter((line) => line.amount == null || line.amount === '').length);

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('en-SG', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(value));
}

function decimalText(value: string | number | null): string {
  if (value == null || value === '') return '';
  const n = Number(value);
  return Number.isFinite(n) ? new Intl.NumberFormat('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n) : '';
}

function statusLabel(status: string): string {
  return statusMeta[status]?.label ?? status.toLowerCase().replaceAll('_', ' ');
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

async function duplicateQuotation(): Promise<void> {
  if (!quotation.value) return;
  errorMessage.value = null;
  try {
    const duplicated = await post<Quotation>(`/quotations/${quotation.value.id}/duplicate`, {});
    await router.push(`/quotations/${duplicated.id}/edit`);
  } catch (error) {
    errorMessage.value = error instanceof ApiResponseError ? error.message : 'Unable to duplicate quotation.';
  }
}

async function moveToTrash(): Promise<void> {
  if (!quotation.value) return;
  errorMessage.value = null;
  successMessage.value = null;
  try {
    await post(`/quotations/${quotation.value.id}/delete`, {});
    await router.replace('/quotations/trash');
  } catch (error) {
    errorMessage.value = error instanceof ApiResponseError ? error.message : 'Unable to move quotation to trash.';
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
          <span
            class="quotation-status-pill"
            :style="{ color: statusMeta[quotation.status]?.text ?? '#44525E', background: statusMeta[quotation.status]?.bg ?? '#ECEFF2' }"
          >
            {{ statusLabel(quotation.status) }}
          </span>
          <Button v-if="canDuplicate" label="Duplicate" icon="pi pi-copy" severity="secondary" @click="duplicateQuotation" />
          <Button v-if="canEditDraft" label="Edit" icon="pi pi-pencil" severity="secondary" @click="router.push(`/quotations/${quotation.id}/edit`)" />
          <Button v-if="canMoveToTrash" label="Move to trash" icon="pi pi-trash" severity="danger" outlined @click="moveToTrash" />
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
        <div class="quotation-lines">
          <article v-for="(line, index) in quotation.lines" :key="line.id" class="quotation-line-card">
            <header class="quotation-line-card__header">
              <div>
                <span class="quotation-job-tag"><MonoText :value="line.itemCode || `JOB-${index + 1}`" /></span>
                <strong>{{ line.description.split('\n')[0] || `Line item ${index + 1}` }}</strong>
              </div>
              <span v-if="line.amount == null" class="quotation-status-pill quotation-status-pill--tba">TBA</span>
            </header>
            <p class="quotation-description">{{ line.description }}</p>
            <dl class="quotation-line-grid">
              <div>
                <dt>Unit</dt>
                <dd>{{ line.unit || '—' }}</dd>
              </div>
              <div>
                <dt>Qty</dt>
                <dd><MonoText :value="decimalText(line.quantity) || '—'" /></dd>
              </div>
              <div>
                <dt>Unit price</dt>
                <dd><MonoText :value="decimalText(line.unitPrice) || '—'" /></dd>
              </div>
              <div>
                <dt>Amount</dt>
                <dd><MonoText :value="decimalText(line.amount) || 'TBA'" /></dd>
              </div>
              <div>
                <dt>Remarks</dt>
                <dd>{{ line.remarks || '—' }}</dd>
              </div>
            </dl>
          </article>
        </div>
      </section>

      <section class="crm-section quotation-totals" aria-label="Quotation totals">
        <dl>
          <div>
            <dt>Priced items</dt>
            <dd>{{ pricedItems }}</dd>
          </div>
          <div>
            <dt>TBA items</dt>
            <dd>{{ tbaItems }}</dd>
          </div>
          <div class="quotation-totals__total">
            <dt>Total</dt>
            <dd><span>{{ quotation.currency }}</span> {{ totalAmount() }}</dd>
          </div>
        </dl>
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
        <p class="quotation-notes"><strong>Work duration:</strong> {{ quotation.workDurationText || 'Not stated' }}</p>
        <p class="quotation-notes"><strong>Exclusions:</strong> {{ quotation.exclusionsText }}</p>
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

.quotation-status-pill {
  display: inline-flex;
  align-items: center;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 500;
  padding: 3px 10px;
}

.quotation-status-pill--tba {
  background: #fbf1c9;
  color: #7a5a00;
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

.quotation-lines {
  display: grid;
  gap: var(--sp-4);
}

.quotation-line-card {
  display: grid;
  gap: var(--sp-3);
  padding: var(--sp-4);
  border: 0.5px solid #d3dce3;
  border-radius: 10px;
  background: #fff;
}

.quotation-line-card__header {
  display: flex;
  justify-content: space-between;
  gap: var(--sp-3);
  align-items: center;
}

.quotation-line-card__header > div {
  display: flex;
  gap: var(--sp-2);
  align-items: center;
  min-width: 0;
}

.quotation-job-tag {
  background: #f4f7fa;
  border-radius: 4px;
  padding: 2px 6px;
  font-size: 0.78rem;
}

.quotation-description {
  margin: 0;
  white-space: pre-wrap;
  line-height: 1.5;
}

.quotation-line-grid {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: var(--sp-3);
  margin: 0;
}

.quotation-line-grid div {
  min-width: 0;
}

.quotation-line-grid dt,
.quotation-totals dt {
  color: var(--color-text-muted);
  font-size: 0.78rem;
  font-weight: 600;
}

.quotation-line-grid dd,
.quotation-totals dd {
  margin: 0;
}

.quotation-totals {
  display: flex;
  justify-content: flex-end;
}

.quotation-totals dl {
  width: min(360px, 100%);
  margin: 0;
  display: grid;
  gap: var(--sp-2);
}

.quotation-totals div {
  display: flex;
  justify-content: space-between;
  gap: var(--sp-4);
}

.quotation-totals dd {
  font-family: 'IBM Plex Mono', ui-monospace, monospace;
}

.quotation-totals__total {
  padding-top: var(--sp-2);
  border-top: 0.5px solid #d3dce3;
  font-weight: 700;
}

@media (max-width: 900px) {
  .quotation-line-grid {
    grid-template-columns: 1fr;
  }
}
</style>
