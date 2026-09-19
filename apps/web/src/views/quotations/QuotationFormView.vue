<script setup lang="ts">
import Button from 'primevue/button';
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import BackLink from '@/components/common/BackLink.vue';
import MonoText from '@/components/common/MonoText.vue';
import { get, patch, post } from '@/lib/api/client';
import { ApiResponseError } from '@/lib/api/errors';
import { useAuthStore } from '@/stores/auth';

interface Quotation {
  id: string;
  quotationNumber: string;
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
  pdfObjectKey?: string | null;
  status?: string;
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
  priceTba: boolean;
  includedElsewhere: boolean;
}

interface PdfResponse {
  status: 'PENDING' | 'READY';
  url?: string;
}

interface QuotationLineTemplate {
  id: string;
  name: string;
  category: string | null;
  entries: Array<{
    id: string;
    itemCode: string | null;
    description: string;
    unit: string | null;
    typicalUnitPrice: string | number | null;
  }>;
}

interface QuotationLineSearchItem {
  id: string;
  itemCode: string | null;
  description: string;
  unit: string | null;
  quantity: string | number | null;
  unitPrice: string | number | null;
  amount: string | number | null;
  remarks: string | null;
  quotation: {
    id: string;
    quotationNumber: string;
    category: string;
    quotationDate: string;
    currency: string;
    clientName: string | null;
    vesselName: string | null;
  };
}

interface QuotationLineSearchResponse {
  page: number;
  pageSize: number;
  total: number;
  items: QuotationLineSearchItem[];
}

const router = useRouter();
const route = useRoute();
const auth = useAuthStore();
const isSaving = ref(false);
const isLoading = ref(false);
const errorMessage = ref<string | null>(null);
const successMessage = ref<string | null>(null);
const openClauseLineId = ref<string | null>(null);
const isCopyPanelOpen = ref(false);
const isSearchingLines = ref(false);
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
const templates = ref<QuotationLineTemplate[]>([]);
const selectedTemplateId = ref('');
const selectedHistoryLineIds = ref<string[]>([]);
const historyLineResults = ref<QuotationLineSearchItem[]>([]);
const historySearch = ref({
  keyword: '',
  category: '',
  from: '',
  to: '',
  page: 1,
  pageSize: 10,
  total: 0,
});
const standardClauses = [
  'Contractor to provide skilled labour, tools & materials required to complete the stated work safely and professionally.',
  'Quotation shall include removal and refit works required for the described scope unless expressly excluded.',
  'Testing/calibration reports submitted without delay upon completion where applicable.',
  'Machining and repair works subject to approval, charged as additional.',
];
const quotationId = computed(() => typeof route.params.id === 'string' ? route.params.id : null);
const activeQuotationId = computed(() => quotationId.value ?? quotation.value?.id ?? null);
const isEditMode = computed(() => quotationId.value != null);
const pricedItemCount = computed(() => lines.value.filter((line) => amount(line) !== '').length);
const tbaItemCount = computed(() => lines.value.filter((line) => amount(line) === '').length);
const selectedTemplate = computed(() => templates.value.find((template) => template.id === selectedTemplateId.value) ?? null);
const canManageTemplates = computed(() => (auth.identity?.roles ?? []).some((role) => ['DIRECTOR', 'SYSTEM_ADMIN'].includes(role)));

function newLine(): LineDraft {
  return {
    id: crypto.randomUUID(),
    itemCode: '',
    description: '',
    unit: '',
    quantity: '',
    unitPrice: '',
    remarks: '',
    priceTba: false,
    includedElsewhere: false,
  };
}

function lineFromTemplateEntry(entry: QuotationLineTemplate['entries'][number]): LineDraft {
  return {
    id: crypto.randomUUID(),
    itemCode: entry.itemCode ?? '',
    description: entry.description,
    unit: entry.unit ?? '',
    quantity: '',
    unitPrice: entry.typicalUnitPrice == null ? '' : String(entry.typicalUnitPrice),
    remarks: entry.typicalUnitPrice == null ? 'Price TBA subject to inspection.' : '',
    priceTba: entry.typicalUnitPrice == null,
    includedElsewhere: false,
  };
}

function lineDraftFromQuotationLine(line: Quotation['lines'][number]): LineDraft {
  return {
    id: line.id,
    itemCode: line.itemCode ?? '',
    description: line.description,
    unit: line.unit ?? '',
    quantity: line.quantity == null ? '' : String(line.quantity),
    unitPrice: line.unitPrice == null ? '' : String(line.unitPrice),
    remarks: line.remarks ?? '',
    priceTba: line.quantity == null && line.unitPrice == null && !String(line.remarks ?? '').toLowerCase().includes('included'),
    includedElsewhere: String(line.remarks ?? '').toLowerCase().includes('included'),
  };
}

function amount(line: LineDraft): string {
  const quantity = Number(line.quantity);
  const unitPrice = Number(line.unitPrice);
  if (!Number.isFinite(quantity) || !Number.isFinite(unitPrice)) return '';
  return (quantity * unitPrice).toFixed(2);
}

function lineTitle(line: LineDraft, index: number): string {
  const text = line.description.trim().split('\n')[0]?.trim();
  return text || `Line item ${index + 1}`;
}

function historyLineParty(line: QuotationLineSearchItem): string {
  return [line.quotation.clientName, line.quotation.vesselName].filter(Boolean).join(' · ') || 'No client or vessel on record';
}

function historyLinePrice(line: QuotationLineSearchItem): string {
  if (line.amount == null || line.amount === '') return `${line.quotation.currency} TBA`;
  const value = Number(line.amount);
  const formatted = Number.isFinite(value)
    ? new Intl.NumberFormat('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)
    : String(line.amount);
  return `${line.quotation.currency} ${formatted}`;
}

function historyLineDate(line: QuotationLineSearchItem): string {
  return new Intl.DateTimeFormat('en-SG', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(line.quotation.quotationDate));
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
        quantity: line.priceTba || line.includedElsewhere ? null : line.quantity || null,
        unitPrice: line.priceTba || line.includedElsewhere ? null : line.unitPrice || null,
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
    lines.value = loaded.lines.map(lineDraftFromQuotationLine);
    if (lines.value.length === 0) addLine();
  } catch (error) {
    errorMessage.value = error instanceof ApiResponseError ? error.message : 'Unable to load quotation.';
  } finally {
    isLoading.value = false;
  }
}

async function loadTemplates(): Promise<void> {
  errorMessage.value = null;
  try {
    const category = form.value.category.trim();
    templates.value = await get<QuotationLineTemplate[]>(`/quotation-line-templates${category ? `?category=${encodeURIComponent(category)}` : ''}`);
    if (selectedTemplateId.value && !templates.value.some((template) => template.id === selectedTemplateId.value)) {
      selectedTemplateId.value = '';
    }
  } catch (error) {
    errorMessage.value = error instanceof ApiResponseError ? error.message : 'Unable to load quotation templates.';
  }
}

function addLine(): void {
  lines.value.push(newLine());
}

function removeLine(id: string): void {
  lines.value = lines.value.filter((line) => line.id !== id);
  if (lines.value.length === 0) addLine();
}

function setPriceTba(line: LineDraft): void {
  if (!line.priceTba) return;
  line.includedElsewhere = false;
  line.quantity = '';
  line.unitPrice = '';
  if (!line.remarks.trim()) line.remarks = 'Price TBA subject to inspection.';
}

function setIncludedElsewhere(line: LineDraft): void {
  if (!line.includedElsewhere) return;
  line.priceTba = false;
  line.quantity = '';
  line.unitPrice = '';
  if (!line.remarks.trim()) line.remarks = 'Included in job no. ';
}

function appendClause(line: LineDraft, clause: string): void {
  const prefix = line.description.trim() ? '\n' : '';
  line.description = `${line.description}${prefix}${clause}`;
  openClauseLineId.value = null;
}

async function saveDraft(): Promise<Quotation | null> {
  isSaving.value = true;
  errorMessage.value = null;
  try {
    const targetId = activeQuotationId.value;
    const saved = targetId
      ? await patch<Quotation>(`/quotations/${targetId}`, payload())
      : await post<Quotation>('/quotations', payload());
    quotation.value = saved;
    lines.value = saved.lines.map(lineDraftFromQuotationLine);
    return saved;
  } catch (error) {
    errorMessage.value = error instanceof ApiResponseError ? error.message : 'Unable to save quotation.';
    return null;
  } finally {
    isSaving.value = false;
  }
}

async function applyTemplate(): Promise<void> {
  const template = selectedTemplate.value;
  if (!template) return;
  errorMessage.value = null;
  successMessage.value = null;
  try {
    if (quotationId.value) {
      const updated = await post<Quotation>(`/quotations/${quotationId.value}/apply-template/${template.id}`, {});
      quotation.value = updated;
      lines.value = updated.lines.map(lineDraftFromQuotationLine);
    } else {
      lines.value.push(...template.entries.map(lineFromTemplateEntry));
    }
    selectedTemplateId.value = '';
    successMessage.value = 'Template lines inserted.';
  } catch (error) {
    errorMessage.value = error instanceof ApiResponseError ? error.message : 'Unable to apply template.';
  }
}

async function searchHistoryLines(page = 1): Promise<void> {
  isSearchingLines.value = true;
  errorMessage.value = null;
  historySearch.value.page = page;
  try {
    const params = new URLSearchParams({
      page: String(historySearch.value.page),
      pageSize: String(historySearch.value.pageSize),
    });
    if (historySearch.value.keyword.trim()) params.set('keyword', historySearch.value.keyword.trim());
    if (historySearch.value.category.trim()) params.set('category', historySearch.value.category.trim());
    if (historySearch.value.from) params.set('from', historySearch.value.from);
    if (historySearch.value.to) params.set('to', historySearch.value.to);
    const result = await get<QuotationLineSearchResponse>(`/quotations/lines/search?${params.toString()}`);
    historyLineResults.value = result.items;
    historySearch.value.total = result.total;
    selectedHistoryLineIds.value = selectedHistoryLineIds.value.filter((id) => result.items.some((line) => line.id === id));
  } catch (error) {
    errorMessage.value = error instanceof ApiResponseError ? error.message : 'Unable to search previous quotation lines.';
  } finally {
    isSearchingLines.value = false;
  }
}

function toggleHistoryLine(lineId: string, event: Event): void {
  const checked = (event.target as HTMLInputElement).checked;
  selectedHistoryLineIds.value = checked
    ? [...new Set([...selectedHistoryLineIds.value, lineId])]
    : selectedHistoryLineIds.value.filter((id) => id !== lineId);
}

async function copySelectedHistoryLines(): Promise<void> {
  if (selectedHistoryLineIds.value.length === 0) return;
  successMessage.value = null;
  errorMessage.value = null;
  const saved = await saveDraft();
  if (!saved) return;
  try {
    const updated = await post<Quotation>(`/quotations/${saved.id}/copy-lines`, selectedHistoryLineIds.value);
    quotation.value = updated;
    lines.value = updated.lines.map(lineDraftFromQuotationLine);
    selectedHistoryLineIds.value = [];
    successMessage.value = 'Selected quotation lines copied.';
  } catch (error) {
    errorMessage.value = error instanceof ApiResponseError ? error.message : 'Unable to copy selected quotation lines.';
  }
}

async function saveAsTemplate(): Promise<void> {
  if (!canManageTemplates.value) return;
  const name = window.prompt('Template name');
  if (!name?.trim()) return;
  successMessage.value = null;
  errorMessage.value = null;
  try {
    const saved = await saveDraft();
    if (!saved) return;
    await post<QuotationLineTemplate>(`/quotation-line-templates/from-quotation/${saved.id}`, {
      name: name.trim(),
      category: form.value.category.trim() || null,
    });
    successMessage.value = 'Template saved from quotation lines.';
    await loadTemplates();
  } catch (error) {
    errorMessage.value = error instanceof ApiResponseError ? error.message : 'Unable to save template.';
  }
}

async function save(): Promise<void> {
  const saved = await saveDraft();
  if (saved) await router.push(`/quotations/${saved.id}`);
}

async function generatePdf(): Promise<void> {
  const saved = await saveDraft();
  if (!saved) return;
  try {
    await post(`/quotations/${saved.id}/generate-pdf`, {});
    await router.push(`/quotations/${saved.id}`);
  } catch (error) {
    errorMessage.value = error instanceof ApiResponseError ? error.message : 'Unable to generate quotation PDF.';
  }
}

async function previewPdf(): Promise<void> {
  if (!quotationId.value) return;
  errorMessage.value = null;
  try {
    const pdf = await get<PdfResponse>(`/quotations/${quotationId.value}/pdf`);
    if (pdf.status !== 'READY' || !pdf.url) {
      errorMessage.value = 'PDF is still generating. Try again in a moment.';
      return;
    }
    window.open(pdf.url, '_blank', 'noopener,noreferrer');
  } catch (error) {
    errorMessage.value = error instanceof ApiResponseError ? error.message : 'Unable to preview quotation PDF.';
  }
}

onMounted(() => {
  void loadQuotation();
  void loadTemplates();
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
          <p class="record-form__version">Quotations remain editable while DRAFT. Generating the PDF does not finalize status in the current API.</p>
        </div>
      </header>

      <p v-if="errorMessage" class="auth-message auth-message--error" role="alert">{{ errorMessage }}</p>
      <p v-if="successMessage" class="auth-message auth-message--success" role="status">{{ successMessage }}</p>

      <form class="record-form record-form--structured record-form--wide" @submit.prevent="save">
      <section class="record-form__section" aria-labelledby="quotation-header-heading">
        <h2 id="quotation-header-heading" class="record-form__section-heading">Header</h2>
          <label class="auth-field">
            <span>Quotation No.</span>
            <input class="auth-input quotation-readonly" :value="quotation?.quotationNumber ?? 'Assigned on save'" readonly />
          </label>
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
            <span>Ship / Company name</span>
            <input v-model="form.manualClientName" class="auth-input" required />
          </label>
          <label class="auth-field">
            <span>Ship / vessel name</span>
            <input v-model="form.manualVesselName" class="auth-input" required />
          </label>
          <label class="auth-field">
            <span>Machinery / Equipment / Job title</span>
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
      </section>

      <section class="record-form__section" aria-labelledby="quotation-line-items-heading">
        <div class="record-form__section-header">
          <h2 id="quotation-line-items-heading" class="record-form__section-heading">Line items</h2>
          <div class="quotation-actions">
            <select v-model="selectedTemplateId" class="auth-input quotation-template-select" @focus="loadTemplates">
              <option value="">Insert from template</option>
              <option v-for="template in templates" :key="template.id" :value="template.id">
                {{ template.name }}{{ template.category ? ` · ${template.category}` : ' · Independent' }}
              </option>
            </select>
            <Button type="button" label="Insert" icon="pi pi-download" severity="secondary" :disabled="!selectedTemplateId" @click="applyTemplate" />
            <Button v-if="canManageTemplates" type="button" label="Save as template" icon="pi pi-bookmark" severity="secondary" @click="saveAsTemplate" />
            <Button
              type="button"
              label="Copy from previous quotation"
              icon="pi pi-copy"
              severity="secondary"
              @click="isCopyPanelOpen = !isCopyPanelOpen; if (isCopyPanelOpen && historyLineResults.length === 0) searchHistoryLines();"
            />
            <Button type="button" label="Add line" icon="pi pi-plus" severity="secondary" @click="addLine" />
          </div>
        </div>
        <div v-if="isCopyPanelOpen" class="quotation-history-copy record-form__field--full">
          <div class="quotation-history-copy__filters">
            <label class="auth-field">
              <span>Search previous lines</span>
              <input
                v-model="historySearch.keyword"
                class="auth-input"
                placeholder="Search description or item code"
                @keydown.enter.prevent="searchHistoryLines(1)"
              />
            </label>
            <label class="auth-field">
              <span>Category</span>
              <input v-model="historySearch.category" class="auth-input" placeholder="Any category" @keydown.enter.prevent="searchHistoryLines(1)" />
            </label>
            <label class="auth-field">
              <span>From</span>
              <input v-model="historySearch.from" class="auth-input" type="date" />
            </label>
            <label class="auth-field">
              <span>To</span>
              <input v-model="historySearch.to" class="auth-input" type="date" />
            </label>
            <Button type="button" label="Search" icon="pi pi-search" :loading="isSearchingLines" @click="searchHistoryLines(1)" />
          </div>

          <div class="quotation-history-copy__results">
            <article v-for="line in historyLineResults" :key="line.id" class="quotation-history-line">
              <label class="quotation-history-line__select">
                <input
                  type="checkbox"
                  :checked="selectedHistoryLineIds.includes(line.id)"
                  @change="toggleHistoryLine(line.id, $event)"
                />
                <span class="sr-only">Select line</span>
              </label>
              <div>
                <div class="quotation-history-line__title">
                  <MonoText v-if="line.itemCode" :value="line.itemCode" />
                  <strong>{{ line.description }}</strong>
                </div>
                <p>{{ line.quotation.quotationNumber }} · {{ historyLineParty(line) }}</p>
                <p>{{ line.quotation.category }} · {{ historyLineDate(line) }}</p>
              </div>
              <span class="quotation-history-line__amount">{{ historyLinePrice(line) }}</span>
            </article>
            <p v-if="!isSearchingLines && historyLineResults.length === 0" class="crm-empty">
              No previous quotation lines found.
            </p>
          </div>

          <div class="quotation-history-copy__footer">
            <span>{{ historySearch.total }} matching line{{ historySearch.total === 1 ? '' : 's' }}</span>
            <div>
              <Button
                type="button"
                label="Previous"
                severity="secondary"
                :disabled="historySearch.page <= 1 || isSearchingLines"
                @click="searchHistoryLines(historySearch.page - 1)"
              />
              <Button
                type="button"
                label="Next"
                severity="secondary"
                :disabled="historySearch.page * historySearch.pageSize >= historySearch.total || isSearchingLines"
                @click="searchHistoryLines(historySearch.page + 1)"
              />
              <Button
                type="button"
                label="Add selected lines"
                icon="pi pi-plus"
                :disabled="selectedHistoryLineIds.length === 0"
                @click="copySelectedHistoryLines"
              />
            </div>
          </div>
        </div>
        <div class="quotation-lines record-form__field--full">
          <div v-for="(line, index) in lines" :key="line.id" class="quotation-line-card">
            <div class="quotation-line-card__header">
              <div>
                <span class="quotation-job-tag"><MonoText :value="line.itemCode || `JOB-${index + 1}`" /></span>
                <strong>{{ lineTitle(line, index) }}</strong>
              </div>
              <Button type="button" icon="pi pi-trash" text severity="secondary" aria-label="Remove line" @click="removeLine(line.id)" />
            </div>

            <label class="auth-field quotation-job-input">
              <span>Job No.</span>
              <input v-model="line.itemCode" class="auth-input mono-input" placeholder="Optional" />
            </label>

            <label class="auth-field">
              <span>Description</span>
              <textarea v-model="line.description" class="auth-input quotation-description" rows="5" placeholder="Describe the work scope for this item" required />
            </label>

            <div class="clause-picker">
              <Button
                type="button"
                label="Insert standard clause"
                icon="pi pi-chevron-down"
                icon-pos="right"
                severity="secondary"
                outlined
                @click="openClauseLineId = openClauseLineId === line.id ? null : line.id"
              />
              <ul v-if="openClauseLineId === line.id" class="clause-picker__menu">
                <li v-for="clause in standardClauses" :key="clause">
                  <button type="button" class="clause-picker__option" @click="appendClause(line, clause)">
                    {{ clause }}
                  </button>
                </li>
              </ul>
            </div>

            <div class="quotation-line-grid">
              <label class="auth-field">
                <span>Unit</span>
                <input v-model="line.unit" class="auth-input" placeholder="sets" />
              </label>
              <label class="auth-field">
                <span>Qty</span>
                <input v-model="line.quantity" class="auth-input mono-input" inputmode="decimal" :disabled="line.priceTba || line.includedElsewhere" />
              </label>
              <label class="auth-field">
                <span>Unit price</span>
                <input v-model="line.unitPrice" class="auth-input mono-input" inputmode="decimal" :disabled="line.priceTba || line.includedElsewhere" />
              </label>
              <label class="auth-field">
                <span>Amount</span>
                <input class="auth-input mono-input quotation-readonly" :value="amount(line) || 'TBA'" readonly />
              </label>
              <label class="auth-field">
                <span>Remarks</span>
                <input v-model="line.remarks" class="auth-input" placeholder="Optional remarks or included job no." />
              </label>
            </div>

            <div class="quotation-flags">
              <label>
                <input v-model="line.priceTba" type="checkbox" @change="setPriceTba(line)" />
                Price TBA (subject to inspection)
              </label>
              <label>
                <input v-model="line.includedElsewhere" type="checkbox" @change="setIncludedElsewhere(line)" />
                Included in another job no.
              </label>
            </div>
          </div>
        </div>
      </section>

      <section class="record-form__section quotation-totals" aria-label="Quotation totals">
        <dl>
          <div>
            <dt>Priced items</dt>
            <dd>{{ pricedItemCount }}</dd>
          </div>
          <div>
            <dt>TBA items</dt>
            <dd>{{ tbaItemCount }}</dd>
          </div>
          <div class="quotation-totals__total">
            <dt>Total</dt>
            <dd><span>{{ form.currency }}</span> {{ total.toFixed(2) }}</dd>
          </div>
        </dl>
      </section>

      <section class="record-form__section" aria-labelledby="quotation-notes-heading">
        <h2 id="quotation-notes-heading" class="record-form__section-heading">Notes &amp; terms</h2>
          <label class="auth-field">
            <span>Work duration</span>
            <input v-model="form.workDurationText" class="auth-input" />
          </label>
          <label class="auth-field">
            <span>Validity days</span>
            <input v-model.number="form.validityDays" class="auth-input" type="number" min="1" />
          </label>
        <label class="auth-field record-form__field--full">
          <span>Exclusions</span>
          <textarea v-model="form.exclusionsText" class="auth-input" rows="4" />
        </label>
      </section>

      <div class="record-form__actions">
        <Button type="button" label="Cancel" severity="secondary" @click="router.push('/quotations')" />
        <Button type="button" label="Save draft" icon="pi pi-save" severity="secondary" :loading="isSaving" @click="save" />
        <Button v-if="isEditMode" type="button" label="Preview PDF" icon="pi pi-eye" severity="secondary" :disabled="!quotation?.pdfObjectKey" @click="previewPdf" />
        <Button type="button" label="Generate PDF" icon="pi pi-file-pdf" :loading="isSaving" @click="generatePdf" />
      </div>
      </form>
    </div>
  </main>
</template>

<style scoped>
.quotation-lines {
  display: grid;
  gap: var(--sp-4);
}

.quotation-line-card {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: var(--sp-3);
  padding: var(--sp-4);
  border: 0.5px solid #d3dce3;
  border-radius: 10px;
  background: #fff;
}

.quotation-line-card__header {
  grid-column: 1 / -1;
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
  min-height: 120px;
}

.quotation-job-input {
  max-width: 220px;
}

.clause-picker {
  position: relative;
  display: flex;
  align-items: flex-start;
  gap: var(--sp-2);
  grid-column: 1 / -1;
}

.clause-picker__menu {
  position: absolute;
  z-index: 20;
  top: calc(100% + 4px);
  left: 0;
  width: min(520px, 100%);
  margin: 0;
  padding: 4px;
  list-style: none;
  background: #fff;
  border: 0.5px solid #D3DCE3;
  border-radius: 8px;
  box-shadow: 0 12px 24px rgba(7, 34, 61, 0.12);
}

.clause-picker__option {
  display: block;
  width: 100%;
  padding: 8px 10px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: #11202E;
  font: inherit;
  font-size: 13px;
  text-align: left;
  cursor: pointer;
}

.clause-picker__option:hover {
  background: #F4F7FA;
}

.quotation-line-grid {
  display: grid;
  grid-column: 1 / -1;
  grid-template-columns: 1fr 1fr 0.8fr 1fr 1fr;
  gap: var(--sp-2);
}

.quotation-readonly {
  background: #f4f7fa;
  color: var(--color-text-muted);
}

.quotation-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--sp-2);
}

.quotation-template-select {
  min-width: 240px;
  width: auto;
}

.quotation-history-copy {
  display: grid;
  gap: var(--sp-3);
  padding: var(--sp-4);
  border: 0.5px solid #D3DCE3;
  border-radius: 10px;
  background: #F4F7FA;
}

.quotation-history-copy__filters {
  display: grid;
  grid-template-columns: minmax(180px, 1.4fr) minmax(140px, 0.8fr) minmax(130px, 0.7fr) minmax(130px, 0.7fr) auto;
  gap: var(--sp-2);
  align-items: end;
}

.quotation-history-copy__results {
  display: grid;
  gap: var(--sp-2);
}

.quotation-history-line {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  gap: var(--sp-3);
  align-items: start;
  padding: 10px 12px;
  border: 0.5px solid #D3DCE3;
  border-radius: 8px;
  background: #fff;
}

.quotation-history-line__select {
  padding-top: 2px;
}

.quotation-history-line__title {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sp-2);
  align-items: baseline;
}

.quotation-history-line p {
  margin: 2px 0 0;
  color: #5C7081;
  font-size: 12px;
}

.quotation-history-line__amount {
  color: #11202E;
  font-family: 'IBM Plex Mono', ui-monospace, monospace;
  font-size: 13px;
  white-space: nowrap;
}

.quotation-history-copy__footer {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--sp-3);
  color: #5C7081;
  font-size: 12px;
}

.quotation-history-copy__footer > div {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sp-2);
  justify-content: flex-end;
}

.quotation-flags {
  display: flex;
  grid-column: 1 / -1;
  flex-wrap: wrap;
  gap: var(--sp-4);
  color: var(--color-text);
  font-size: 0.9rem;
}

.quotation-flags label {
  display: inline-flex;
  gap: var(--sp-2);
  align-items: center;
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

.quotation-totals dt {
  color: var(--color-text-muted);
}

.quotation-totals dd {
  margin: 0;
  font-family: 'IBM Plex Mono', ui-monospace, monospace;
}

.quotation-totals__total {
  padding-top: var(--sp-2);
  border-top: 0.5px solid #d3dce3;
  font-weight: 700;
}

@media (max-width: 900px) {
  .quotation-history-copy__filters,
  .quotation-line-grid {
    grid-template-columns: 1fr;
  }
}

@media (min-width: 768px) {
  .quotation-line-card {
    grid-template-columns: minmax(0, 0.45fr) minmax(0, 1fr);
  }
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
</style>
