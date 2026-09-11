<script setup lang="ts">
import Button from 'primevue/button';
import MultiSelect from 'primevue/multiselect';
import { computed, nextTick, onMounted, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import FieldError from '@/components/common/FieldError.vue';
import { post } from '@/lib/api/client';
import { ApiResponseError } from '@/lib/api/errors';
import { useChecklistCategoriesStore } from '@/stores/checklistCategories';
import { useClientsStore } from '@/stores/clients';
import { useAuthStore } from '@/stores/auth';
import { useJobOrdersStore, type JobOrderCreateInput, type JobOrderPatchInput } from '@/stores/jobOrders';
import { useVendorsStore } from '@/stores/vendors';
import type { ChecklistTemplate, JobOrder, Variation } from '@/lib/api/types';

type JobOrderField =
  | 'branch'
  | 'clientId'
  | 'vesselId'
  | 'vendorId'
  | 'serviceCategories'
  | 'port'
  | 'deadline'
  | 'scopeSummary'
  | 'externalQuoteRef'
  | 'externalRfqRef'
  | 'quotedAmountMinor'
  | 'quotedCurrency'
  | 'checklistTemplateId'
  | 'checklistItems';

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const clientsStore = useClientsStore();
const checklistCategoriesStore = useChecklistCategoriesStore();
const jobOrdersStore = useJobOrdersStore();
const vendorsStore = useVendorsStore();

const branchOptions = ['SG', 'MY', 'ID', 'BD'];
const currencyOptions = ['SGD', 'MYR', 'USD', 'IDR'];

const isLoadingClients = ref(true);
const isLoadingVessels = ref(false);
const isSaving = ref(false);
const isLoadingTemplates = ref(false);
const formError = ref<string | null>(null);
const fieldErrors = reactive<Partial<Record<JobOrderField, string>>>({});
const allChecklistTemplates = ref<ChecklistTemplate[]>([]);
const checklistMode = ref<'template' | 'custom'>('template');
const selectedChecklistTemplateId = ref('');
const customChecklistItems = ref<string[]>(['']);
const saveCustomAsTemplate = ref(false);
const newTemplateName = ref('');
const variations = ref<Variation[]>([]);
const variationReason = ref('');
const variationAmount = ref('');
const variationError = ref<string | null>(null);
const variationReasonError = ref<string | null>(null);
const variationAmountError = ref<string | null>(null);
const clientSearch = ref('');
const vesselSearch = ref('');
const vendorSearch = ref('');
const debouncedClientSearch = ref('');
const debouncedVesselSearch = ref('');
const debouncedVendorSearch = ref('');
const clientSuggestionsOpen = ref(false);
const vesselSuggestionsOpen = ref(false);
const vendorSuggestionsOpen = ref(false);
const editableJobOrder = ref<JobOrder | null>(null);
const isPrefilling = ref(false);
let clientSearchTimer: ReturnType<typeof setTimeout> | null = null;
let vesselSearchTimer: ReturnType<typeof setTimeout> | null = null;
let vendorSearchTimer: ReturnType<typeof setTimeout> | null = null;
const form = reactive({
  branch: auth.identity?.branch ?? 'SG',
  clientId: '',
  vesselId: '',
  vendorId: '',
  isSubcontracted: false,
  serviceCategories: [] as string[],
  port: '',
  deadline: '',
  scopeSummary: '',
  externalQuoteRef: '',
  externalRfqRef: '',
  quotedAmount: '',
  quotedCurrency: 'SGD',
});

const vesselOptions = computed(() => clientsStore.selectedClient?.vessels ?? []);
const categoryOptions = computed(() => checklistCategoriesStore.options);
const checklistTemplates = computed(() => {
  const selectedCategoryIds = new Set(form.serviceCategories);
  return allChecklistTemplates.value
    .filter((template) => template.categoryId == null || selectedCategoryIds.has(template.categoryId))
    .sort((left, right) => {
      if (left.categoryId == null && right.categoryId != null) return -1;
      if (left.categoryId != null && right.categoryId == null) return 1;
      return left.name.localeCompare(right.name);
    });
});
const selectedChecklistTemplate = computed(() => checklistTemplates.value.find((template) => template.id === selectedChecklistTemplateId.value) ?? null);
const previewChecklistItems = computed(() => {
  if (checklistMode.value === 'template') return selectedChecklistTemplate.value?.entries.map((entry) => entry.label) ?? [];
  return customChecklistItems.value.map((item) => item.trim()).filter(Boolean);
});
const selectedClient = computed(() => clientsStore.sortedClients.find((client) => client.id === form.clientId) ?? null);
const selectedVessel = computed(() => vesselOptions.value.find((vessel) => vessel.id === form.vesselId) ?? null);
const selectedClientName = computed(() => selectedClient.value?.name ?? clientSearch.value.trim());
const selectedVesselName = computed(() => selectedVessel.value?.name ?? vesselSearch.value.trim());
const hasAssignmentPreview = computed(() => Boolean(selectedClientName.value && selectedVesselName.value));
const editJobOrderId = computed(() => (typeof route.params.id === 'string' ? route.params.id : ''));
const isEditMode = computed(() => Boolean(editJobOrderId.value));
const pageTitle = computed(() => (isEditMode.value ? 'Edit job order' : 'New job order'));
const canScheduleOnCreate = computed(() => !isEditMode.value && (auth.identity?.roles.some((role) => ['SYSTEM_ADMIN', 'DIRECTOR'].includes(role)) ?? false));
const canChooseBranch = computed(() => auth.identity?.roles.some((role) => ['SYSTEM_ADMIN', 'DIRECTOR'].includes(role)) ?? false);
const canCreateVariation = computed(() => {
  const state = editableJobOrder.value?.state;
  return Boolean(
    state
    && !['CLOSED', 'CANCELLED'].includes(state)
    && (auth.identity?.roles.some((role) => ['SYSTEM_ADMIN', 'OPS_SUPERVISOR'].includes(role)) ?? false),
  );
});
const clientSuggestions = computed(() => {
  const query = debouncedClientSearch.value.trim().toLowerCase();
  if (!query) return clientsStore.sortedClients.slice(0, 8);
  return clientsStore.sortedClients.filter((client) => client.name.toLowerCase().includes(query)).slice(0, 8);
});
const vendorSuggestions = computed(() => {
  const query = debouncedVendorSearch.value.trim().toLowerCase();
  const branch = form.branch;
  const vendors = vendorsStore.sortedVendors.filter((vendor) => canChooseBranch.value || vendor.branch === branch);
  if (!query) return vendors.slice(0, 8);
  return vendors.filter((vendor) => vendor.name.toLowerCase().includes(query)).slice(0, 8);
});
const vesselSuggestions = computed(() => {
  if (!form.clientId) return [];
  const query = debouncedVesselSearch.value.trim().toLowerCase();
  const vessels = vesselOptions.value;
  if (!query) return vessels.slice(0, 8);
  return vessels.filter((vessel) => {
    const haystack = `${vessel.name} ${vessel.imoNumber ?? ''}`.toLowerCase();
    return haystack.includes(query);
  }).slice(0, 8);
});
const exactClientMatch = computed(() => {
  const query = clientSearch.value.trim().toLowerCase();
  if (!query) return null;
  return clientsStore.sortedClients.find((client) => client.name.trim().toLowerCase() === query) ?? null;
});
const exactVesselMatch = computed(() => {
  const query = vesselSearch.value.trim().toLowerCase();
  if (!query) return null;
  return vesselOptions.value.find((vessel) => vessel.name.trim().toLowerCase() === query) ?? null;
});
const selectedVendor = computed(() => vendorsStore.sortedVendors.find((vendor) => vendor.id === form.vendorId) ?? null);
const exactVendorMatch = computed(() => {
  const query = vendorSearch.value.trim().toLowerCase();
  if (!query) return null;
  return vendorsStore.sortedVendors.find((vendor) => vendor.name.trim().toLowerCase() === query && vendor.branch === form.branch) ?? null;
});

function decimalToMinorUnits(value: string): number | null {
  const match = value.trim().match(/^(-?)(\d+)(?:\.(\d{1,2}))?$/);
  if (!match) return null;

  const absolute = (BigInt(match[2]) * 100n) + BigInt((match[3] ?? '').padEnd(2, '0'));
  const minorUnits = match[1] === '-' ? -absolute : absolute;
  if (minorUnits > BigInt(Number.MAX_SAFE_INTEGER) || minorUnits < BigInt(Number.MIN_SAFE_INTEGER)) return null;
  return Number(minorUnits);
}

function minorUnitsToDecimal(value: number): string {
  return (value / 100).toFixed(2);
}

function displayImo(value?: string | null): string {
  if (!value || value.startsWith('MANUAL-')) return '';
  return value;
}

function moneyLabel(amountMinor: number, currency: string): string {
  return new Intl.NumberFormat('en-SG', { style: 'currency', currency }).format(amountMinor / 100);
}

function clearFieldErrors(): void {
  for (const key of Object.keys(fieldErrors) as JobOrderField[]) delete fieldErrors[key];
}

function normalizedCustomChecklistItems(): { label: string }[] {
  return customChecklistItems.value
    .map((label) => ({ label: label.trim() }))
    .filter((item) => item.label.length > 0);
}

function setValidationFromBackend(error: ApiResponseError): boolean {
  if (error.code !== 'VALIDATION_ERROR') return false;

  if (error.message.includes('clientId')) fieldErrors.clientId = error.message;
  if (error.message.includes('vesselId')) fieldErrors.vesselId = error.message;
  if (error.message.includes('scopeSummary')) fieldErrors.scopeSummary = error.message;
  if (error.message.includes('quotedAmount')) {
    fieldErrors.quotedAmountMinor = error.message;
    fieldErrors.quotedCurrency = error.message;
  }
  if (!Object.keys(fieldErrors).length) formError.value = error.message;
  return true;
}

function validateForm(): boolean {
  clearFieldErrors();
  formError.value = null;

  if (!clientSearch.value.trim()) fieldErrors.clientId = 'Client is required.';
  if (!vesselSearch.value.trim()) fieldErrors.vesselId = 'Vessel is required.';
  if (!form.branch) fieldErrors.branch = 'Branch is required.';
  if (form.isSubcontracted && !vendorSearch.value.trim()) fieldErrors.vendorId = 'Vendor is required for subcontracted jobs.';
  if (!form.scopeSummary.trim()) fieldErrors.scopeSummary = 'Scope summary is required.';
  if (decimalToMinorUnits(form.quotedAmount) == null) {
    fieldErrors.quotedAmountMinor = 'Enter a valid quoted amount with up to two decimal places.';
  }
  if (!form.quotedCurrency.trim()) fieldErrors.quotedCurrency = 'Currency is required.';
  if (checklistMode.value === 'template' && selectedChecklistTemplateId.value && !selectedChecklistTemplate.value) {
    fieldErrors.checklistTemplateId = 'Select a valid checklist template.';
  }
  if (saveCustomAsTemplate.value && !newTemplateName.value.trim()) {
    fieldErrors.checklistItems = 'Template name is required when saving a custom checklist.';
  }

  return Object.keys(fieldErrors).length === 0;
}

async function payload(): Promise<JobOrderCreateInput> {
  const clientId = form.clientId.trim();
  const vesselId = form.vesselId.trim();
  const client = clientId ? { id: clientId } : selectedClient.value ?? exactClientMatch.value;
  const vessel = vesselId ? { id: vesselId } : selectedVessel.value ?? exactVesselMatch.value;
  let vendor = selectedVendor.value ?? exactVendorMatch.value;
  if (form.isSubcontracted && !vendor && vendorSearch.value.trim()) {
    vendor = await vendorsStore.createVendor({ name: vendorSearch.value.trim(), branch: form.branch });
  }
  let checklistTemplateId = checklistMode.value === 'template' ? selectedChecklistTemplateId.value || null : null;
  let checklistItems = checklistMode.value === 'custom' ? normalizedCustomChecklistItems() : [];
  if (checklistMode.value === 'custom' && saveCustomAsTemplate.value && checklistItems.length > 0) {
    const template = await jobOrdersStore.createChecklistTemplate({
      name: newTemplateName.value.trim(),
      categoryId: form.serviceCategories[0] ?? null,
      entries: checklistItems,
    });
    checklistTemplateId = template.id;
    checklistItems = [];
  }
  return {
    branch: form.branch,
    ...(client ? { clientId: client.id } : { newClientName: clientSearch.value.trim() }),
    ...(vessel ? { vesselId: vessel.id } : { newVesselName: vesselSearch.value.trim() }),
    isSubcontracted: form.isSubcontracted,
    vendorId: form.isSubcontracted ? vendor?.id ?? null : null,
    serviceCategories: [...form.serviceCategories],
    port: form.port.trim() || null,
    deadline: form.deadline ? new Date(form.deadline).toISOString() : null,
    scopeSummary: form.scopeSummary.trim(),
    externalQuoteRef: form.externalQuoteRef.trim() || null,
    externalRfqRef: form.externalRfqRef.trim() || null,
    quotedAmountMinor: decimalToMinorUnits(form.quotedAmount)!,
    quotedCurrency: form.quotedCurrency.trim().toUpperCase(),
    checklistTemplateId,
    checklistItems,
  };
}

async function updatePayload(): Promise<JobOrderPatchInput> {
  if (!editableJobOrder.value) throw new Error('Job order is not loaded.');
  return {
    ...(await payload()),
    version: editableJobOrder.value.version,
  };
}

async function prefillJobOrder(jobOrder: JobOrder): Promise<void> {
  if (!['DRAFT', 'SCHEDULED'].includes(jobOrder.state)) {
    formError.value = 'This job order is locked. Use Variations for changes after execution starts.';
    return;
  }

  isPrefilling.value = true;
  try {
    await clientsStore.loadClient(jobOrder.clientId);
    editableJobOrder.value = jobOrder;
    variations.value = [...(jobOrder.variations ?? [])];
    form.branch = jobOrder.branch;
    form.clientId = jobOrder.clientId;
    form.vesselId = jobOrder.vesselId;
    form.vendorId = jobOrder.vendorId ?? '';
    form.isSubcontracted = jobOrder.isSubcontracted;
    form.serviceCategories = [...jobOrder.serviceCategories];
    form.port = jobOrder.port ?? '';
    form.deadline = jobOrder.deadline ? jobOrder.deadline.slice(0, 10) : '';
    form.scopeSummary = jobOrder.scopeSummary;
    form.externalQuoteRef = jobOrder.externalQuoteRef ?? '';
    form.externalRfqRef = jobOrder.externalRfqRef ?? '';
    form.quotedAmount = minorUnitsToDecimal(jobOrder.quotedAmountMinor);
    form.quotedCurrency = jobOrder.quotedCurrency;

    clientSearch.value = jobOrder.client?.name ?? selectedClient.value?.name ?? jobOrder.clientId;
    debouncedClientSearch.value = clientSearch.value;
    vesselSearch.value = jobOrder.vessel?.name ?? selectedVessel.value?.name ?? jobOrder.vesselId;
    debouncedVesselSearch.value = vesselSearch.value;
    vendorSearch.value = jobOrder.vendor?.name ?? selectedVendor.value?.name ?? '';
    debouncedVendorSearch.value = vendorSearch.value;

    const checklistLabels = (jobOrder.checklistItems ?? []).map((item) => item.label);
    checklistMode.value = checklistLabels.length ? 'custom' : 'template';
    selectedChecklistTemplateId.value = '';
    customChecklistItems.value = checklistLabels.length ? checklistLabels : [''];
    saveCustomAsTemplate.value = false;
    newTemplateName.value = '';
  } finally {
    await nextTick();
    isPrefilling.value = false;
  }
}

function validateVariation(): boolean {
  variationReasonError.value = null;
  variationAmountError.value = null;
  variationError.value = null;
  if (!variationReason.value.trim()) variationReasonError.value = 'Reason is required.';
  const amountMinor = decimalToMinorUnits(variationAmount.value);
  if (amountMinor == null || amountMinor <= 0) variationAmountError.value = 'Enter a variation amount greater than zero.';
  return !variationReasonError.value && !variationAmountError.value;
}

async function createVariation(): Promise<void> {
  if (!editableJobOrder.value || !validateVariation()) return;
  isSaving.value = true;
  try {
    const created = await post<Variation, { reason: string; amountMinor: number; amountCurrency: string }>(
      `/job-orders/${editableJobOrder.value.id}/variations`,
      {
        reason: variationReason.value.trim(),
        amountMinor: decimalToMinorUnits(variationAmount.value)!,
        amountCurrency: form.quotedCurrency,
      },
    );
    variations.value = [created, ...variations.value.filter((variation) => variation.id !== created.id)];
    variationReason.value = '';
    variationAmount.value = '';
  } catch (error) {
    variationError.value = error instanceof ApiResponseError ? error.message : 'Unable to create variation.';
  } finally {
    isSaving.value = false;
  }
}

async function loadVesselsForClient(clientId: string): Promise<void> {
  form.vesselId = '';
  vesselSearch.value = '';
  debouncedVesselSearch.value = '';
  if (!clientId) return;

  isLoadingVessels.value = true;
  try {
    await clientsStore.loadClient(clientId);
  } catch (error) {
    fieldErrors.clientId = error instanceof ApiResponseError ? error.message : 'Unable to load client vessels.';
  } finally {
    isLoadingVessels.value = false;
  }
}

function selectClient(client: { id: string; name: string }): void {
  form.clientId = client.id;
  clientSearch.value = client.name;
  debouncedClientSearch.value = client.name;
  clientSuggestionsOpen.value = false;
}

function selectVessel(vessel: { id: string; name: string; imoNumber?: string | null }): void {
  form.vesselId = vessel.id;
  vesselSearch.value = vessel.name;
  debouncedVesselSearch.value = vessel.name;
  vesselSuggestionsOpen.value = false;
}

function selectVendor(vendor: { id: string; name: string }): void {
  form.vendorId = vendor.id;
  vendorSearch.value = vendor.name;
  debouncedVendorSearch.value = vendor.name;
  vendorSuggestionsOpen.value = false;
}

async function loadChecklistTemplates(): Promise<void> {
  isLoadingTemplates.value = true;
  try {
    allChecklistTemplates.value = await jobOrdersStore.loadChecklistTemplates(null);
  } catch (error) {
    formError.value = error instanceof ApiResponseError ? error.message : 'Unable to load checklist templates.';
  } finally {
    isLoadingTemplates.value = false;
  }
}

function addCustomChecklistItem(): void {
  customChecklistItems.value = [...customChecklistItems.value, ''];
}

function removeCustomChecklistItem(index: number): void {
  customChecklistItems.value = customChecklistItems.value.filter((_, itemIndex) => itemIndex !== index);
  if (customChecklistItems.value.length === 0) customChecklistItems.value = [''];
}

async function saveJobOrder(scheduleNow = false): Promise<void> {
  if (!validateForm()) return;
  isSaving.value = true;

  try {
    if (isEditMode.value) {
      const updated = await jobOrdersStore.updateJobOrder(editJobOrderId.value, await updatePayload());
      editableJobOrder.value = updated;
      await router.replace(`/job-orders/${updated.id}`);
      return;
    }

    const created = await jobOrdersStore.createJobOrder(await payload());
    if (scheduleNow) {
      const scheduled = await jobOrdersStore.transitionJobOrder(created.id, {
        to: 'SCHEDULED',
        version: created.version,
      });
      await router.replace(`/job-orders/${scheduled.id}`);
      return;
    }
    await router.replace(`/job-orders/${created.id}`);
  } catch (error) {
    if (error instanceof ApiResponseError) {
      if (setValidationFromBackend(error)) return;
      formError.value = error.message;
      return;
    }
    formError.value = 'Unable to create job order.';
  } finally {
    isSaving.value = false;
  }
}

watch(() => form.clientId, (clientId) => {
  if (isPrefilling.value) return;
  void loadVesselsForClient(clientId);
});

watch(clientSearch, (value) => {
  if (isPrefilling.value) return;
  if (selectedClient.value?.name !== value) {
    form.clientId = '';
    form.vesselId = '';
    vesselSearch.value = '';
  }
  if (clientSearchTimer) clearTimeout(clientSearchTimer);
  clientSearchTimer = setTimeout(() => {
    debouncedClientSearch.value = value;
  }, 250);
});

watch(vesselSearch, (value) => {
  if (isPrefilling.value) return;
  if (selectedVessel.value?.name !== value) form.vesselId = '';
  if (vesselSearchTimer) clearTimeout(vesselSearchTimer);
  vesselSearchTimer = setTimeout(() => {
    debouncedVesselSearch.value = value;
  }, 250);
});

watch(vendorSearch, (value) => {
  if (isPrefilling.value) return;
  if (selectedVendor.value?.name !== value) form.vendorId = '';
  if (vendorSearchTimer) clearTimeout(vendorSearchTimer);
  vendorSearchTimer = setTimeout(() => {
    debouncedVendorSearch.value = value;
  }, 250);
});

watch(() => form.isSubcontracted, (enabled) => {
  if (!enabled) {
    form.vendorId = '';
    vendorSearch.value = '';
    debouncedVendorSearch.value = '';
  }
});

watch(() => form.branch, () => {
  if (isPrefilling.value) return;
  if (!canChooseBranch.value) form.branch = auth.identity?.branch ?? form.branch;
  form.vendorId = '';
  vendorSearch.value = '';
  debouncedVendorSearch.value = '';
});

watch(() => [...form.serviceCategories], () => {
  if (selectedChecklistTemplateId.value && !checklistTemplates.value.some((template) => template.id === selectedChecklistTemplateId.value)) {
    selectedChecklistTemplateId.value = '';
  }
});

onMounted(async () => {
  try {
    if (!canChooseBranch.value) form.branch = auth.identity?.branch ?? form.branch;
    await Promise.all([clientsStore.loadClients(), checklistCategoriesStore.load(), vendorsStore.loadVendors()]);
    await loadChecklistTemplates();
    if (isEditMode.value) {
      const jobOrder = await jobOrdersStore.loadJobOrder(editJobOrderId.value);
      await prefillJobOrder(jobOrder);
    }
  } catch (error) {
    formError.value = error instanceof ApiResponseError ? error.message : 'Unable to load form data.';
  } finally {
    isLoadingClients.value = false;
  }
});
</script>

<template>
  <main class="office-route crm-page" aria-labelledby="job-order-form-title">
    <div class="record-form-card">
      <header class="crm-page__header">
        <div>
          <p class="crm-page__eyebrow">Job order</p>
          <h1 id="job-order-form-title" class="crm-page__title">{{ pageTitle }}</h1>
        </div>
      </header>

      <form class="record-form record-form--structured" @submit.prevent="saveJobOrder(false)">
      <p v-if="formError" class="auth-message auth-message--error" role="alert">
        {{ formError }}
      </p>

      <section class="record-form__section" aria-labelledby="job-order-assignment-heading">
        <h2 id="job-order-assignment-heading" class="record-form__section-heading">Assignment</h2>

        <label class="auth-field" for="jo-branch-create">
          <span>Branch</span>
          <select
            v-if="canChooseBranch"
            id="jo-branch-create"
            v-model="form.branch"
            class="auth-input"
            required
          >
            <option v-for="branch in branchOptions" :key="branch" :value="branch">{{ branch }}</option>
          </select>
          <input v-else id="jo-branch-create" :value="form.branch" class="auth-input mono-input" readonly />
          <FieldError :message="fieldErrors.branch" />
        </label>

        <label class="auth-field" for="jo-client-id">
          <span>Client</span>
          <div class="record-form__combobox">
          <input
            id="jo-client-id"
            v-model="clientSearch"
            class="auth-input"
            autocomplete="off"
            :disabled="isLoadingClients"
            :placeholder="isLoadingClients ? 'Loading clients...' : 'Search or type a client name'"
            required
            @focus="clientSuggestionsOpen = true"
            @blur="clientSuggestionsOpen = false"
            @keydown.escape="clientSuggestionsOpen = false"
            @input="clientSuggestionsOpen = true"
          />
          <ul
            v-if="clientSuggestionsOpen && clientSuggestions.length"
            class="record-form__suggestions"
            role="listbox"
          >
            <li v-for="client in clientSuggestions" :key="client.id">
              <button
                type="button"
                class="record-form__suggestion"
                role="option"
                @mousedown.prevent="selectClient(client)"
              >
                {{ client.name }}
              </button>
            </li>
          </ul>
          </div>
          <FieldError :message="fieldErrors.clientId" />
        </label>

        <label class="auth-field" for="jo-vessel-id">
          <span>Vessel</span>
          <div class="record-form__combobox">
          <input
            id="jo-vessel-id"
            v-model="vesselSearch"
            class="auth-input"
            autocomplete="off"
            :disabled="isLoadingVessels"
            :placeholder="form.clientId ? (isLoadingVessels ? 'Loading vessels...' : 'Search or type a vessel name') : 'Type a vessel name'"
            required
            @focus="vesselSuggestionsOpen = true"
            @blur="vesselSuggestionsOpen = false"
            @keydown.escape="vesselSuggestionsOpen = false"
            @input="vesselSuggestionsOpen = true"
          />
          <ul
            v-if="vesselSuggestionsOpen && vesselSuggestions.length"
            class="record-form__suggestions"
            role="listbox"
          >
            <li v-for="vessel in vesselSuggestions" :key="vessel.id">
              <button
                type="button"
                class="record-form__suggestion"
                role="option"
                @mousedown.prevent="selectVessel(vessel)"
              >
                <span>{{ vessel.name }}</span>
                <span v-if="displayImo(vessel.imoNumber)" class="record-form__suggestion-meta">{{ displayImo(vessel.imoNumber) }}</span>
              </button>
            </li>
          </ul>
          </div>
          <FieldError :message="fieldErrors.vesselId" />
        </label>

        <p class="record-form__preview" :class="{ 'record-form__preview--empty': !hasAssignmentPreview }">
          <template v-if="hasAssignmentPreview">{{ selectedClientName }} · {{ selectedVesselName }}</template>
          <template v-else>Select a client and vessel to see a preview here</template>
        </p>
      </section>

      <section class="record-form__section" aria-labelledby="job-order-scope-heading">
        <h2 id="job-order-scope-heading" class="record-form__section-heading">Scope</h2>

        <label class="auth-field" for="jo-service-categories-create">
          <span>Service categories</span>
          <MultiSelect
            id="jo-service-categories-create"
            v-model="form.serviceCategories"
            class="record-form__select"
            :options="categoryOptions"
            option-label="label"
            option-value="value"
            display="chip"
            placeholder="Select categories"
          />
          <FieldError :message="fieldErrors.serviceCategories" />
        </label>

        <div v-if="canScheduleOnCreate" class="record-form__field--full checklist-setup">
          <div class="checklist-setup__mode" role="group" aria-label="Checklist setup mode">
            <Button
              type="button"
              label="Use template"
              :severity="checklistMode === 'template' ? undefined : 'secondary'"
              :outlined="checklistMode !== 'template'"
              @click="checklistMode = 'template'"
            />
            <Button
              type="button"
              label="Custom list"
              :severity="checklistMode === 'custom' ? undefined : 'secondary'"
              :outlined="checklistMode !== 'custom'"
              @click="checklistMode = 'custom'"
            />
          </div>

          <label v-if="checklistMode === 'template'" class="auth-field" for="jo-checklist-template">
            <span>Checklist template</span>
            <select
              id="jo-checklist-template"
              v-model="selectedChecklistTemplateId"
              class="auth-input"
              :disabled="isLoadingTemplates"
            >
              <option value="">
                {{ isLoadingTemplates ? 'Loading templates...' : form.serviceCategories.length ? 'No template selected' : 'Select a service category first, or choose an independent template' }}
              </option>
              <option v-for="template in checklistTemplates" :key="template.id" :value="template.id">
                {{ template.name }}
              </option>
            </select>
            <FieldError :message="fieldErrors.checklistTemplateId" />
          </label>

          <div v-else class="checklist-setup__custom">
            <label
              v-for="(_, index) in customChecklistItems"
              :key="index"
              class="auth-field checklist-setup__item"
            >
              <span>Checklist item {{ index + 1 }}</span>
              <input v-model="customChecklistItems[index]" class="auth-input" placeholder="Enter checklist item" />
              <Button
                type="button"
                icon="pi pi-times"
                severity="secondary"
                outlined
                aria-label="Remove checklist item"
                @click="removeCustomChecklistItem(index)"
              />
            </label>
            <Button type="button" label="Add item" icon="pi pi-plus" severity="secondary" outlined @click="addCustomChecklistItem" />

            <label class="auth-field checklist-setup__save-template">
              <span>Save custom checklist</span>
              <span class="checklist-setup__checkbox-row">
                <input v-model="saveCustomAsTemplate" type="checkbox" />
                Save as new template
              </span>
            </label>

            <label v-if="saveCustomAsTemplate" class="auth-field" for="jo-new-template-name">
              <span>Template name</span>
              <input id="jo-new-template-name" v-model="newTemplateName" class="auth-input" placeholder="Reusable template name" />
              <FieldError :message="fieldErrors.checklistItems" />
            </label>
          </div>

          <div v-if="previewChecklistItems.length" class="checklist-setup__preview">
            <span>Checklist preview</span>
            <ol>
              <li v-for="item in previewChecklistItems" :key="item">{{ item }}</li>
            </ol>
          </div>
        </div>

        <label class="auth-field" for="jo-port-create">
          <span>Port</span>
          <input id="jo-port-create" v-model="form.port" class="auth-input" placeholder="Enter port" />
          <FieldError :message="fieldErrors.port" />
        </label>

        <label class="auth-field" for="jo-deadline-create">
          <span>Deadline</span>
          <input id="jo-deadline-create" v-model="form.deadline" class="auth-input" type="date" />
          <FieldError :message="fieldErrors.deadline" />
        </label>

        <label class="auth-field record-form__field--full" for="jo-scope-create">
          <span>Scope summary</span>
          <textarea
            id="jo-scope-create"
            v-model="form.scopeSummary"
            class="auth-input record-form__textarea"
            placeholder="Describe the required work"
            required
          />
          <FieldError :message="fieldErrors.scopeSummary" />
        </label>
      </section>

      <section class="record-form__section" aria-labelledby="job-order-references-heading">
        <h2 id="job-order-references-heading" class="record-form__section-heading">
          References <span class="record-form__section-optional">— optional</span>
        </h2>

        <label class="auth-field" for="jo-external-quote-create">
          <span>External quote ref</span>
          <input
            id="jo-external-quote-create"
            v-model="form.externalQuoteRef"
            class="auth-input mono-input"
            placeholder="Quote reference"
          />
          <FieldError :message="fieldErrors.externalQuoteRef" />
        </label>

        <label class="auth-field" for="jo-external-rfq-create">
          <span>External RFQ ref</span>
          <input
            id="jo-external-rfq-create"
            v-model="form.externalRfqRef"
            class="auth-input mono-input"
            placeholder="RFQ reference"
          />
          <FieldError :message="fieldErrors.externalRfqRef" />
        </label>
      </section>

      <section class="record-form__section" aria-labelledby="job-order-commercial-heading">
        <h2 id="job-order-commercial-heading" class="record-form__section-heading">Commercial</h2>

        <label class="auth-field" for="jo-quoted-amount">
          <span>Quoted amount</span>
          <input
            id="jo-quoted-amount"
            v-model="form.quotedAmount"
            class="auth-input mono-input"
            inputmode="decimal"
            placeholder="0.00"
            required
          />
          <FieldError :message="fieldErrors.quotedAmountMinor" />
        </label>

        <label class="auth-field" for="jo-quoted-currency">
          <span>Currency</span>
          <select id="jo-quoted-currency" v-model="form.quotedCurrency" class="auth-input mono-input" required>
            <option v-for="currency in currencyOptions" :key="currency" :value="currency">{{ currency }}</option>
          </select>
          <FieldError :message="fieldErrors.quotedCurrency" />
        </label>

        <label class="auth-field record-form__field--full subcontractor-toggle" for="jo-is-subcontracted">
          <span>Subcontractor</span>
          <span class="checklist-setup__checkbox-row">
            <input id="jo-is-subcontracted" v-model="form.isSubcontracted" type="checkbox" />
            This job is subcontracted
          </span>
        </label>

        <label v-if="form.isSubcontracted" class="auth-field record-form__field--full" for="jo-vendor-id">
          <span>Vendor</span>
          <div class="record-form__combobox">
            <input
              id="jo-vendor-id"
              v-model="vendorSearch"
              class="auth-input"
              autocomplete="off"
              placeholder="Search or type a vendor name"
              required
              @focus="vendorSuggestionsOpen = true"
              @blur="vendorSuggestionsOpen = false"
              @keydown.escape="vendorSuggestionsOpen = false"
              @input="vendorSuggestionsOpen = true"
            />
            <ul
              v-if="vendorSuggestionsOpen && vendorSuggestions.length"
              class="record-form__suggestions"
              role="listbox"
            >
              <li v-for="vendor in vendorSuggestions" :key="vendor.id">
                <button
                  type="button"
                  class="record-form__suggestion"
                  role="option"
                  @mousedown.prevent="selectVendor(vendor)"
                >
                  <span>{{ vendor.name }}</span>
                  <span class="record-form__suggestion-meta">{{ vendor.branch }}</span>
                </button>
              </li>
            </ul>
          </div>
          <FieldError :message="fieldErrors.vendorId" />
        </label>
      </section>

      <section v-if="isEditMode && editableJobOrder" class="record-form__section" aria-labelledby="job-order-variation-heading">
        <div class="record-form__section-header">
          <h2 id="job-order-variation-heading" class="record-form__section-heading">Variations</h2>
          <p class="record-form__section-optional">Proposed variations are reviewed by Director/Admin.</p>
        </div>

        <p v-if="variationError" class="auth-message auth-message--error record-form__field--full" role="alert">
          {{ variationError }}
        </p>

        <div v-if="canCreateVariation" class="record-form__inline-form record-form__field--full">
          <label class="auth-field" for="edit-variation-reason">
            <span>Reason</span>
            <input id="edit-variation-reason" v-model="variationReason" class="auth-input" placeholder="Describe the scope or cost change" />
            <FieldError :message="variationReasonError" />
          </label>
          <label class="auth-field" for="edit-variation-amount">
            <span>Amount</span>
            <input id="edit-variation-amount" v-model="variationAmount" class="auth-input mono-input" inputmode="decimal" placeholder="0.00" />
            <FieldError :message="variationAmountError" />
          </label>
          <Button type="button" label="Add Variation" icon="pi pi-plus" :loading="isSaving" @click="createVariation" />
        </div>

        <div v-if="variations.length" class="record-form__field--full variation-summary-list">
          <article v-for="variation in variations" :key="variation.id" class="variation-summary-item">
            <div>
              <strong>{{ variation.reason }}</strong>
              <p>{{ variation.status }}</p>
            </div>
            <span class="mx-money">{{ moneyLabel(variation.amountMinor, variation.amountCurrency) }}</span>
          </article>
        </div>

        <p v-else class="crm-empty record-form__field--full">
          No variations yet.
        </p>
      </section>

      <div class="record-form__actions">
        <Button label="Cancel" severity="secondary" @click="isEditMode && editableJobOrder ? router.push(`/job-orders/${editableJobOrder.id}`) : router.back()" />
        <Button type="submit" :label="isEditMode ? 'Save changes' : 'Save as draft'" icon="pi pi-save" :loading="isSaving" />
        <Button
          v-if="canScheduleOnCreate"
          type="button"
          label="Schedule now"
          icon="pi pi-calendar"
          :loading="isSaving"
          @click="saveJobOrder(true)"
        />
      </div>
      </form>
    </div>
  </main>
</template>

<style scoped>
.checklist-setup,
.checklist-setup__custom {
  display: grid;
  gap: 12px;
}

.checklist-setup__mode,
.checklist-setup__checkbox-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.checklist-setup__item {
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: end;
}

.checklist-setup__item > span {
  grid-column: 1 / -1;
}

.checklist-setup__preview {
  padding: 12px;
  border: 0.5px solid #D3DCE3;
  border-radius: 8px;
  background: #F4F7FA;
  color: #34495C;
  font-size: 13px;
}

.checklist-setup__preview span {
  font-weight: 600;
}

.checklist-setup__preview ol {
  margin: 8px 0 0;
  padding-left: 20px;
}

.record-form__section-header {
  grid-column: 1 / -1;
}

.record-form__inline-form {
  display: grid;
  grid-template-columns: minmax(0, 2fr) minmax(160px, 1fr) auto;
  gap: 12px;
  align-items: end;
}

.variation-summary-list {
  display: grid;
  gap: 8px;
}

.variation-summary-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 10px 12px;
  border: 0.5px solid #D3DCE3;
  border-radius: 8px;
  background: #fff;
}

.variation-summary-item p {
  margin: 2px 0 0;
  color: #5C7081;
  font-size: 12px;
}

.record-form__combobox {
  position: relative;
}

.record-form__suggestions {
  position: absolute;
  z-index: 20;
  top: calc(100% + 4px);
  right: 0;
  left: 0;
  max-height: 220px;
  margin: 0;
  padding: 4px;
  overflow-y: auto;
  list-style: none;
  background: #fff;
  border: 0.5px solid #D3DCE3;
  border-radius: 8px;
  box-shadow: 0 12px 24px rgba(7, 34, 61, 0.12);
}

.record-form__suggestion {
  display: flex;
  width: 100%;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 10px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: #11202E;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.record-form__suggestion:hover {
  background: #F4F7FA;
}

.record-form__suggestion-meta {
  flex: 0 0 auto;
  color: #5C7081;
  font-family: 'IBM Plex Mono', ui-monospace, monospace;
  font-size: 12px;
}

@media (max-width: 768px) {
  .record-form__inline-form {
    grid-template-columns: 1fr;
  }
}
</style>
