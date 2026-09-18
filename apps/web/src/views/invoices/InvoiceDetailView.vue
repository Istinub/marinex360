<script setup lang="ts">
import Button from 'primevue/button';
import Column from 'primevue/column';
import DataTable from 'primevue/datatable';
import InputText from 'primevue/inputtext';
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import BackLink from '@/components/common/BackLink.vue';
import MonoText from '@/components/common/MonoText.vue';
import NotFoundState from '@/components/common/NotFoundState.vue';
import { del, get, patch, post } from '@/lib/api/client';
import { ApiResponseError } from '@/lib/api/errors';
import type { Invoice, InvoiceLine } from '@/lib/api/types';
import { formatMoney } from '@/lib/money';
import { useAuthStore } from '@/stores/auth';

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const invoice = ref<Invoice | null>(null);
const isLoading = ref(true);
const isSaving = ref(false);
const isIssuing = ref(false);
const isNotFound = ref(false);
const errorMessage = ref<string | null>(null);
const successMessage = ref<string | null>(null);
const invoiceId = computed(() => String(route.params.id));
const jobOrderBackLink = computed(() => invoice.value ? `/job-orders/${invoice.value.jobOrderId}` : '/job-orders');
const roles = computed(() => auth.identity?.roles ?? []);
const canEditDraft = computed(() => invoice.value?.status === 'DRAFT' && roles.value.some((role) => ['SYSTEM_ADMIN', 'DIRECTOR', 'FINANCE'].includes(role)));
const canIssue = computed(() => canEditDraft.value);

interface EditableInvoiceLine {
  id: string;
  kind: string;
  description: string;
  quantity: string;
  unit: string;
  unitPriceAmountMinor: string;
  unitPriceCurrency: string;
}

const editLines = ref<EditableInvoiceLine[]>([]);
const newLine = ref<EditableInvoiceLine>({
  id: '',
  kind: 'OTHER',
  description: '',
  quantity: '1',
  unit: '',
  unitPriceAmountMinor: '0',
  unitPriceCurrency: 'SGD',
});

function money(amountMinor: number, currency: string): string {
  return formatMoney({ amountMinor, currency });
}

function centsFromInput(value: string): number {
  const trimmed = value.trim();
  if (!trimmed) return 0;
  return Math.round(Number(trimmed) * 100);
}

function moneyInputFromMinor(amountMinor: number): string {
  return (amountMinor / 100).toFixed(2);
}

function lineToEdit(line: InvoiceLine): EditableInvoiceLine {
  return {
    id: line.id,
    kind: line.kind,
    description: line.description,
    quantity: String(line.quantity),
    unit: line.unit ?? '',
    unitPriceAmountMinor: moneyInputFromMinor(line.unitPriceAmountMinor),
    unitPriceCurrency: line.unitPriceCurrency,
  };
}

function resetEditableLines(): void {
  editLines.value = (invoice.value?.lines ?? []).map(lineToEdit);
  newLine.value = {
    id: '',
    kind: 'OTHER',
    description: '',
    quantity: '1',
    unit: '',
    unitPriceAmountMinor: '0.00',
    unitPriceCurrency: invoice.value?.totalCurrency ?? 'SGD',
  };
}

function linePayload(line: EditableInvoiceLine) {
  return {
    version: invoice.value?.version ?? 0,
    kind: line.kind,
    description: line.description,
    quantity: Number(line.quantity),
    unit: line.unit.trim() || null,
    unitPriceAmountMinor: centsFromInput(line.unitPriceAmountMinor),
    unitPriceCurrency: invoice.value?.totalCurrency ?? line.unitPriceCurrency,
  };
}

async function loadInvoice(): Promise<void> {
  isLoading.value = true;
  errorMessage.value = null;
  try {
    invoice.value = await get<Invoice>(`/invoices/${invoiceId.value}`);
    resetEditableLines();
  } catch (error) {
    if (error instanceof ApiResponseError && error.code === 'NOT_FOUND') {
      isNotFound.value = true;
      return;
    }
    errorMessage.value = error instanceof ApiResponseError ? error.message : 'Unable to load invoice.';
  } finally {
    isLoading.value = false;
  }
}

async function saveLine(line: EditableInvoiceLine): Promise<void> {
  if (!invoice.value) return;
  isSaving.value = true;
  errorMessage.value = null;
  successMessage.value = null;
  try {
    invoice.value = await patch<Invoice>(`/invoices/${invoice.value.id}/lines/${line.id}`, linePayload(line));
    resetEditableLines();
    successMessage.value = 'Invoice line updated.';
  } catch (error) {
    errorMessage.value = error instanceof ApiResponseError ? error.message : 'Unable to update invoice line.';
  } finally {
    isSaving.value = false;
  }
}

async function addLine(): Promise<void> {
  if (!invoice.value) return;
  isSaving.value = true;
  errorMessage.value = null;
  successMessage.value = null;
  try {
    invoice.value = await post<Invoice>(`/invoices/${invoice.value.id}/lines`, linePayload(newLine.value));
    resetEditableLines();
    successMessage.value = 'Invoice line added.';
  } catch (error) {
    errorMessage.value = error instanceof ApiResponseError ? error.message : 'Unable to add invoice line.';
  } finally {
    isSaving.value = false;
  }
}

async function removeLine(line: EditableInvoiceLine): Promise<void> {
  if (!invoice.value) return;
  isSaving.value = true;
  errorMessage.value = null;
  successMessage.value = null;
  try {
    invoice.value = await del<Invoice>(`/invoices/${invoice.value.id}/lines/${line.id}?version=${invoice.value.version ?? 0}`);
    resetEditableLines();
    successMessage.value = 'Invoice line removed.';
  } catch (error) {
    errorMessage.value = error instanceof ApiResponseError ? error.message : 'Unable to remove invoice line.';
  } finally {
    isSaving.value = false;
  }
}

async function issueInvoice(): Promise<void> {
  if (!invoice.value) return;
  isIssuing.value = true;
  errorMessage.value = null;
  successMessage.value = null;
  try {
    invoice.value = await post<Invoice>(`/invoices/${invoice.value.id}/issue`, { version: invoice.value.version ?? 0 });
    resetEditableLines();
    successMessage.value = 'Invoice issued. PDF generation has started.';
  } catch (error) {
    errorMessage.value = error instanceof ApiResponseError ? error.message : 'Unable to issue invoice.';
  } finally {
    isIssuing.value = false;
  }
}

onMounted(() => {
  void loadInvoice();
});
</script>

<template>
  <NotFoundState v-if="isNotFound" />

  <main v-else class="office-route crm-page" aria-labelledby="invoice-title">
    <p v-if="isLoading" class="crm-empty">Loading invoice...</p>
    <p v-else-if="errorMessage" class="auth-message auth-message--error" role="alert">{{ errorMessage }}</p>

    <div v-else-if="invoice" class="record-form-card">
      <header class="crm-page__header">
        <div>
          <BackLink :to="jobOrderBackLink" label="Job order" />
          <p class="crm-page__eyebrow">{{ invoice.status === 'DRAFT' ? 'Invoice draft' : 'Invoice' }}</p>
          <h1 id="invoice-title" class="crm-page__title">
            <MonoText :value="invoice.invoiceNumber" />
          </h1>
          <p class="record-form__version">
            {{ invoice.status === 'DRAFT' ? 'Review and adjust line items before issuing.' : 'Issued invoices are locked.' }}
          </p>
        </div>
        <span class="jo-chip mx-jo-draft">{{ invoice.status }}</span>
      </header>
      <p v-if="successMessage" class="auth-message auth-message--success" role="status">{{ successMessage }}</p>

      <section class="crm-section" aria-labelledby="bill-to-title">
        <h2 id="bill-to-title" class="crm-section__title">Bill to</h2>
        <dl class="detail-grid">
          <div>
            <dt>Name</dt>
            <dd>{{ invoice.billToName }}</dd>
          </div>
          <div>
            <dt>Email</dt>
            <dd>{{ invoice.billToEmail ?? '—' }}</dd>
          </div>
          <div>
            <dt>Address</dt>
            <dd>{{ invoice.billToAddress ?? '—' }}</dd>
          </div>
        </dl>
      </section>

      <section class="crm-section" aria-labelledby="invoice-lines-title">
        <h2 id="invoice-lines-title" class="crm-section__title">Draft lines</h2>
        <DataTable :value="invoice.lines ?? []" data-key="id" size="small" striped-rows class="crm-table">
          <Column field="kind" header="Type" />
          <Column field="description" header="Description" />
          <Column field="quantity" header="Qty">
            <template #body="{ data }">{{ Number(data.quantity) }} {{ data.unit ?? '' }}</template>
          </Column>
          <Column field="unitPriceAmountMinor" header="Unit price">
            <template #body="{ data }">{{ money(data.unitPriceAmountMinor, data.unitPriceCurrency) }}</template>
          </Column>
          <Column field="lineTotalAmountMinor" header="Total">
            <template #body="{ data }"><span class="mx-money">{{ money(data.lineTotalAmountMinor, data.lineTotalCurrency) }}</span></template>
          </Column>
        </DataTable>
      </section>

      <section v-if="canEditDraft" class="crm-section" aria-labelledby="invoice-line-editor-title">
        <h2 id="invoice-line-editor-title" class="crm-section__title">Edit draft lines</h2>
        <div class="invoice-line-editor">
          <article v-for="line in editLines" :key="line.id" class="invoice-line-editor__row">
            <label>
              <span>Type</span>
              <select v-model="line.kind" class="record-form__input">
                <option value="LABOUR">Labour</option>
                <option value="MATERIAL">Material</option>
                <option value="VARIATION">Variation</option>
                <option value="OTHER">Other</option>
              </select>
            </label>
            <label>
              <span>Description</span>
              <InputText v-model="line.description" class="record-form__input" />
            </label>
            <label>
              <span>Qty</span>
              <InputText v-model="line.quantity" class="record-form__input" inputmode="decimal" />
            </label>
            <label>
              <span>Unit</span>
              <InputText v-model="line.unit" class="record-form__input" />
            </label>
            <label>
              <span>Unit price</span>
              <InputText v-model="line.unitPriceAmountMinor" class="record-form__input" inputmode="decimal" />
            </label>
            <div class="invoice-line-editor__actions">
              <Button label="Save" size="small" :loading="isSaving" @click="saveLine(line)" />
              <Button label="Remove" size="small" severity="danger" outlined :loading="isSaving" @click="removeLine(line)" />
            </div>
          </article>

          <article class="invoice-line-editor__row invoice-line-editor__row--new">
            <label>
              <span>Type</span>
              <select v-model="newLine.kind" class="record-form__input">
                <option value="LABOUR">Labour</option>
                <option value="MATERIAL">Material</option>
                <option value="VARIATION">Variation</option>
                <option value="OTHER">Other</option>
              </select>
            </label>
            <label>
              <span>Description</span>
              <InputText v-model="newLine.description" class="record-form__input" />
            </label>
            <label>
              <span>Qty</span>
              <InputText v-model="newLine.quantity" class="record-form__input" inputmode="decimal" />
            </label>
            <label>
              <span>Unit</span>
              <InputText v-model="newLine.unit" class="record-form__input" />
            </label>
            <label>
              <span>Unit price</span>
              <InputText v-model="newLine.unitPriceAmountMinor" class="record-form__input" inputmode="decimal" />
            </label>
            <div class="invoice-line-editor__actions">
              <Button label="Add line" size="small" icon="pi pi-plus" :loading="isSaving" @click="addLine" />
            </div>
          </article>
        </div>
      </section>

      <section class="crm-section" aria-labelledby="invoice-total-title">
        <h2 id="invoice-total-title" class="crm-section__title">Totals</h2>
        <dl class="detail-grid">
          <div>
            <dt>GST</dt>
            <dd>{{ invoice.gstAmountMinor == null ? '—' : money(invoice.gstAmountMinor, invoice.gstCurrency ?? invoice.totalCurrency) }}</dd>
          </div>
          <div>
            <dt>Total</dt>
            <dd><span class="mx-money">{{ money(invoice.totalAmountMinor, invoice.totalCurrency) }}</span></dd>
          </div>
        </dl>
      </section>

      <div class="record-form__actions">
        <Button label="Back to job order" severity="secondary" @click="router.push(jobOrderBackLink)" />
        <Button v-if="canIssue" label="Issue Invoice" icon="pi pi-send" :loading="isIssuing" @click="issueInvoice" />
      </div>
    </div>
  </main>
</template>

<style scoped>
.invoice-line-editor {
  display: grid;
  gap: 12px;
}

.invoice-line-editor__row {
  display: grid;
  grid-template-columns: 0.8fr minmax(12rem, 2fr) 0.6fr 0.7fr 0.9fr auto;
  gap: 10px;
  align-items: end;
  padding: 12px;
  border: 0.5px solid #D3DCE3;
  border-radius: 8px;
  background: #FFFFFF;
}

.invoice-line-editor__row--new {
  background: #F4F7FA;
}

.invoice-line-editor__row label {
  display: grid;
  gap: 4px;
}

.invoice-line-editor__row span {
  color: #5C7081;
  font-size: 12px;
  font-weight: 600;
}

.invoice-line-editor__actions {
  display: flex;
  gap: 8px;
}

@media (max-width: 900px) {
  .invoice-line-editor__row {
    grid-template-columns: 1fr 1fr;
  }

  .invoice-line-editor__actions {
    grid-column: 1 / -1;
  }
}
</style>
