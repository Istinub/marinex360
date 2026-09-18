<script setup lang="ts">
import Button from 'primevue/button';
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import BackLink from '@/components/common/BackLink.vue';
import { get, patch, post } from '@/lib/api/client';
import { ApiResponseError } from '@/lib/api/errors';

interface Quotation {
  id: string;
  version: number;
  branch: string;
  clientId: string | null;
  vesselId: string | null;
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
  lines: Array<{
    id: string;
    itemCode: string | null;
    description: string;
    unit: string | null;
    quantity: string | number | null;
    unitPrice: string | number | null;
    remarks: string | null;
  }>;
}

interface LineDraft {
  id: string;
  itemCode: string;
  description: string;
  unit: string;
  quantity: string;
  unitPrice: string;
  remarks: string;
}

const router = useRouter();
const route = useRoute();
const isSaving = ref(false);
const isLoading = ref(false);
const errorMessage = ref<string | null>(null);
const quotation = ref<Quotation | null>(null);
const loadedClientName = ref('');
const loadedVesselName = ref('');
const form = ref({
  clientId: '',
  vesselId: '',
  branch: 'SG',
  manualClientName: '',
  manualVesselName: '',
  category: 'MECHANICAL',
  quotationDate: new Date().toISOString().slice(0, 10),
  location: 'Singapore',
  currency: 'SGD',
  validityDays: 30,
  workDurationText: '',
  exclusionsText: 'Above Quotation Excludes Shipyard Management Fee, Sea Trial Attendance, Owner Supplied Spares, Third Party Charges, GST, and any work not expressly stated above.',
});
const lines = ref<LineDraft[]>([newLine()]);
const currencies = ['SGD', 'MYR', 'USD', 'IDR'];
const branches = ['SG', 'MY', 'ID', 'BD'];
const quotationId = computed(() => typeof route.params.id === 'string' ? route.params.id : null);
const isEditMode = computed(() => quotationId.value != null);

function newLine(): LineDraft {
  return {
    id: crypto.randomUUID(),
    itemCode: '',
    description: '',
    unit: '',
    quantity: '',
    unitPrice: '',
    remarks: '',
  };
}

function amount(line: LineDraft): string {
  const quantity = Number(line.quantity);
  const unitPrice = Number(line.unitPrice);
  if (!Number.isFinite(quantity) || !Number.isFinite(unitPrice)) return '';
  return (quantity * unitPrice).toFixed(2);
}

const total = computed(() => lines.value.reduce((sum, line) => {
  const n = Number(amount(line));
  return Number.isFinite(n) ? sum + n : sum;
}, 0));

function payload() {
  const clientNameChanged = loadedClientName.value && form.value.manualClientName.trim() !== loadedClientName.value;
  const vesselNameChanged = loadedVesselName.value && form.value.manualVesselName.trim() !== loadedVesselName.value;
  return {
    branch: form.value.branch,
    clientId: form.value.clientId && !clientNameChanged ? form.value.clientId : null,
    vesselId: form.value.vesselId && !vesselNameChanged ? form.value.vesselId : null,
    manualClientName: form.value.clientId && !clientNameChanged ? null : form.value.manualClientName,
    manualVesselName: form.value.vesselId && !vesselNameChanged ? null : form.value.manualVesselName,
    category: form.value.category,
    quotationDate: form.value.quotationDate,
    location: form.value.location,
    currency: form.value.currency,
    validityDays: form.value.validityDays,
    workDurationText: form.value.workDurationText,
    exclusionsText: form.value.exclusionsText,
    ...(quotation.value ? { version: quotation.value.version } : {}),
    lines: lines.value
      .filter((line) => line.description.trim())
      .map((line) => ({
        itemCode: line.itemCode || null,
        description: line.description,
        unit: line.unit || null,
        quantity: line.quantity || null,
        unitPrice: line.unitPrice || null,
        remarks: line.remarks || null,
      })),
  };
}

function formatDateForInput(value: string): string {
  return value.slice(0, 10);
}

async function loadQuotation(): Promise<void> {
  if (!quotationId.value) return;
  isLoading.value = true;
  errorMessage.value = null;
  try {
    const loaded = await get<Quotation>(`/quotations/${quotationId.value}`);
    quotation.value = loaded;
    loadedClientName.value = loaded.client?.name ?? loaded.manualClientName ?? '';
    loadedVesselName.value = loaded.vessel?.name ?? loaded.manualVesselName ?? '';
    form.value = {
      clientId: loaded.clientId ?? '',
      vesselId: loaded.vesselId ?? '',
      branch: loaded.branch,
      manualClientName: loadedClientName.value,
      manualVesselName: loadedVesselName.value,
      category: loaded.category,
      quotationDate: formatDateForInput(loaded.quotationDate),
      location: loaded.location ?? '',
      currency: loaded.currency,
      validityDays: loaded.validityDays,
      workDurationText: loaded.workDurationText ?? '',
      exclusionsText: loaded.exclusionsText,
    };
    lines.value = loaded.lines.map((line) => ({
      id: line.id,
      itemCode: line.itemCode ?? '',
      description: line.description,
      unit: line.unit ?? '',
      quantity: line.quantity == null ? '' : String(line.quantity),
      unitPrice: line.unitPrice == null ? '' : String(line.unitPrice),
      remarks: line.remarks ?? '',
    }));
    if (lines.value.length === 0) addLine();
  } catch (error) {
    errorMessage.value = error instanceof ApiResponseError ? error.message : 'Unable to load quotation.';
  } finally {
    isLoading.value = false;
  }
}

function addLine(): void {
  lines.value.push(newLine());
}

function removeLine(id: string): void {
  lines.value = lines.value.filter((line) => line.id !== id);
  if (lines.value.length === 0) addLine();
}

async function save(): Promise<void> {
  isSaving.value = true;
  errorMessage.value = null;
  try {
    const saved = quotationId.value
      ? await patch<Quotation>(`/quotations/${quotationId.value}`, payload())
      : await post<Quotation>('/quotations', payload());
    await router.push(`/quotations/${saved.id}`);
  } catch (error) {
    errorMessage.value = error instanceof ApiResponseError ? error.message : 'Unable to save quotation.';
  } finally {
    isSaving.value = false;
  }
}

onMounted(() => {
  void loadQuotation();
});
</script>

<template>
  <main class="office-route crm-page" aria-labelledby="quotation-form-title">
    <p v-if="isLoading" class="crm-empty">Loading quotation...</p>

    <div v-else class="record-form-card">
      <header class="crm-page__header">
        <div>
          <BackLink to="/quotations" label="Quotations" />
          <p class="crm-page__eyebrow">Quotation</p>
          <h1 id="quotation-form-title" class="crm-page__title">{{ isEditMode ? 'Edit quotation' : 'New quotation' }}</h1>
        </div>
      </header>

      <p v-if="errorMessage" class="auth-message auth-message--error" role="alert">{{ errorMessage }}</p>

      <section class="record-form__section">
        <h2>Header</h2>
        <div class="record-form__grid record-form__grid--two">
          <label class="auth-field">
            <span>Branch</span>
            <select v-model="form.branch" class="auth-input">
              <option v-for="branch in branches" :key="branch" :value="branch">{{ branch }}</option>
            </select>
          </label>
          <label class="auth-field">
            <span>Currency</span>
            <select v-model="form.currency" class="auth-input">
              <option v-for="currency in currencies" :key="currency" :value="currency">{{ currency }}</option>
            </select>
          </label>
          <label class="auth-field">
            <span>Client / company name</span>
            <input v-model="form.manualClientName" class="auth-input" required />
          </label>
          <label class="auth-field">
            <span>Ship / vessel name</span>
            <input v-model="form.manualVesselName" class="auth-input" required />
          </label>
          <label class="auth-field">
            <span>Category</span>
            <input v-model="form.category" class="auth-input" required />
          </label>
          <label class="auth-field">
            <span>Quotation date</span>
            <input v-model="form.quotationDate" class="auth-input" type="date" required />
          </label>
          <label class="auth-field">
            <span>Location</span>
            <input v-model="form.location" class="auth-input" />
          </label>
          <label class="auth-field">
            <span>Validity days</span>
            <input v-model.number="form.validityDays" class="auth-input" type="number" min="1" />
          </label>
          <label class="auth-field">
            <span>Work duration</span>
            <input v-model="form.workDurationText" class="auth-input" />
          </label>
        </div>
        <label class="auth-field">
          <span>Exclusions</span>
          <textarea v-model="form.exclusionsText" class="auth-input" rows="3" />
        </label>
      </section>

      <section class="record-form__section">
        <div class="crm-page__header">
          <h2>Line items</h2>
          <Button label="Add line" icon="pi pi-plus" severity="secondary" @click="addLine" />
        </div>
        <div class="quotation-lines">
          <div v-for="line in lines" :key="line.id" class="quotation-line">
            <input v-model="line.itemCode" class="auth-input" placeholder="Item code" />
            <input v-model="line.description" class="auth-input quotation-line__description" placeholder="Description" />
            <input v-model="line.unit" class="auth-input" placeholder="Unit" />
            <input v-model="line.quantity" class="auth-input mono-input" placeholder="Qty" inputmode="decimal" />
            <input v-model="line.unitPrice" class="auth-input mono-input" placeholder="Unit price" inputmode="decimal" />
            <span class="quotation-line__amount mono-input">{{ amount(line) || 'TBA' }}</span>
            <input v-model="line.remarks" class="auth-input" placeholder="Remarks" />
            <Button icon="pi pi-trash" text severity="secondary" aria-label="Remove line" @click="removeLine(line.id)" />
          </div>
        </div>
        <p class="record-form__version">Total {{ form.currency }} {{ total.toFixed(2) }}. Blank unit price lines render as TBA.</p>
      </section>

      <div class="record-form__actions">
        <Button label="Cancel" severity="secondary" @click="router.push('/quotations')" />
        <Button label="Save quotation" icon="pi pi-save" :loading="isSaving" @click="save" />
      </div>
    </div>
  </main>
</template>

<style scoped>
.quotation-lines {
  display: grid;
  gap: var(--sp-2);
}

.quotation-line {
  display: grid;
  grid-template-columns: 0.8fr 2fr 0.7fr 0.6fr 0.8fr 0.8fr 1fr auto;
  gap: var(--sp-2);
  align-items: center;
}

.quotation-line__amount {
  padding: var(--sp-2);
  color: var(--color-text-muted);
}

@media (max-width: 900px) {
  .quotation-line {
    grid-template-columns: 1fr;
  }
}
</style>
