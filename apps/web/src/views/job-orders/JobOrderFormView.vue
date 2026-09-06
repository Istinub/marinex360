<script setup lang="ts">
import Button from 'primevue/button';
import MultiSelect from 'primevue/multiselect';
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import FieldError from '@/components/common/FieldError.vue';
import { ApiResponseError } from '@/lib/api/errors';
import { useChecklistCategoriesStore } from '@/stores/checklistCategories';
import { useClientsStore } from '@/stores/clients';
import { useJobOrdersStore, type JobOrderCreateInput } from '@/stores/jobOrders';

type JobOrderField =
  | 'clientId'
  | 'vesselId'
  | 'serviceCategories'
  | 'port'
  | 'scopeSummary'
  | 'externalQuoteRef'
  | 'externalRfqRef'
  | 'quotedAmountMinor'
  | 'quotedCurrency';

const router = useRouter();
const clientsStore = useClientsStore();
const checklistCategoriesStore = useChecklistCategoriesStore();
const jobOrdersStore = useJobOrdersStore();

const isLoadingClients = ref(true);
const isLoadingVessels = ref(false);
const isSaving = ref(false);
const formError = ref<string | null>(null);
const fieldErrors = reactive<Partial<Record<JobOrderField, string>>>({});
const form = reactive({
  clientId: '',
  vesselId: '',
  serviceCategories: [] as string[],
  port: '',
  scopeSummary: '',
  externalQuoteRef: '',
  externalRfqRef: '',
  quotedAmount: '',
  quotedCurrency: 'SGD',
});

const vesselOptions = computed(() => clientsStore.selectedClient?.vessels ?? []);
const categoryOptions = computed(() => checklistCategoriesStore.options);
const selectedClientName = computed(() =>
  clientsStore.sortedClients.find((client) => client.id === form.clientId)?.name ?? '');
const selectedVesselName = computed(() =>
  vesselOptions.value.find((vessel) => vessel.id === form.vesselId)?.name ?? '');
const hasAssignmentPreview = computed(() => Boolean(selectedClientName.value && selectedVesselName.value));

function decimalToMinorUnits(value: string): number | null {
  const match = value.trim().match(/^(-?)(\d+)(?:\.(\d{1,2}))?$/);
  if (!match) return null;

  const absolute = (BigInt(match[2]) * 100n) + BigInt((match[3] ?? '').padEnd(2, '0'));
  const minorUnits = match[1] === '-' ? -absolute : absolute;
  if (minorUnits > BigInt(Number.MAX_SAFE_INTEGER) || minorUnits < BigInt(Number.MIN_SAFE_INTEGER)) return null;
  return Number(minorUnits);
}

function clearFieldErrors(): void {
  for (const key of Object.keys(fieldErrors) as JobOrderField[]) delete fieldErrors[key];
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

  if (!form.clientId) fieldErrors.clientId = 'Client is required.';
  if (!form.vesselId) fieldErrors.vesselId = 'Vessel is required.';
  if (!form.scopeSummary.trim()) fieldErrors.scopeSummary = 'Scope summary is required.';
  if (decimalToMinorUnits(form.quotedAmount) == null) {
    fieldErrors.quotedAmountMinor = 'Enter a valid quoted amount with up to two decimal places.';
  }
  if (!form.quotedCurrency.trim()) fieldErrors.quotedCurrency = 'Currency is required.';

  return Object.keys(fieldErrors).length === 0;
}

function payload(): JobOrderCreateInput {
  return {
    clientId: form.clientId,
    vesselId: form.vesselId,
    serviceCategories: [...form.serviceCategories],
    port: form.port.trim() || null,
    scopeSummary: form.scopeSummary.trim(),
    externalQuoteRef: form.externalQuoteRef.trim() || null,
    externalRfqRef: form.externalRfqRef.trim() || null,
    quotedAmountMinor: decimalToMinorUnits(form.quotedAmount)!,
    quotedCurrency: form.quotedCurrency.trim().toUpperCase(),
  };
}

async function loadVesselsForClient(clientId: string): Promise<void> {
  form.vesselId = '';
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

async function saveJobOrder(): Promise<void> {
  if (!validateForm()) return;
  isSaving.value = true;

  try {
    const created = await jobOrdersStore.createJobOrder(payload());
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
  void loadVesselsForClient(clientId);
});

onMounted(async () => {
  try {
    await Promise.all([clientsStore.loadClients(), checklistCategoriesStore.load()]);
  } catch (error) {
    formError.value = error instanceof ApiResponseError ? error.message : 'Unable to load form data.';
  } finally {
    isLoadingClients.value = false;
  }
});
</script>

<template>
  <main class="office-route crm-page" aria-labelledby="job-order-form-title">
    <header class="crm-page__header">
      <div>
        <p class="crm-page__eyebrow">Job order</p>
        <h1 id="job-order-form-title" class="crm-page__title">New job order</h1>
      </div>
    </header>

    <form class="record-form record-form--structured" @submit.prevent="saveJobOrder">
      <p v-if="formError" class="auth-message auth-message--error" role="alert">
        {{ formError }}
      </p>

      <section class="record-form__section" aria-labelledby="job-order-assignment-heading">
        <h2 id="job-order-assignment-heading" class="record-form__section-heading">Assignment</h2>

        <label class="auth-field" for="jo-client-id">
          <span>Client</span>
          <select
            id="jo-client-id"
            v-model="form.clientId"
            class="auth-input"
            :class="{ 'record-form__control--placeholder': !form.clientId }"
            :disabled="isLoadingClients"
            required
          >
            <option value="">{{ isLoadingClients ? 'Loading clients...' : 'Select client' }}</option>
            <option v-for="client in clientsStore.sortedClients" :key="client.id" :value="client.id">
              {{ client.name }}
            </option>
          </select>
          <FieldError :message="fieldErrors.clientId" />
        </label>

        <label class="auth-field" for="jo-vessel-id">
          <span>Vessel</span>
          <select
            id="jo-vessel-id"
            v-model="form.vesselId"
            class="auth-input"
            :class="{ 'record-form__control--placeholder': !form.vesselId }"
            :disabled="!form.clientId || isLoadingVessels"
            required
          >
            <option value="">{{ isLoadingVessels ? 'Loading vessels...' : 'Select vessel' }}</option>
            <option v-for="vessel in vesselOptions" :key="vessel.id" :value="vessel.id">
              {{ vessel.name }} · {{ vessel.imoNumber }}
            </option>
          </select>
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

        <label class="auth-field" for="jo-port-create">
          <span>Port</span>
          <input id="jo-port-create" v-model="form.port" class="auth-input" placeholder="Enter port" />
          <FieldError :message="fieldErrors.port" />
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
          <input id="jo-quoted-currency" v-model="form.quotedCurrency" class="auth-input mono-input" required />
          <FieldError :message="fieldErrors.quotedCurrency" />
        </label>
      </section>

      <div class="record-form__actions">
        <Button label="Cancel" severity="secondary" @click="router.back()" />
        <Button type="submit" label="Create job order" icon="pi pi-save" :loading="isSaving" />
      </div>
    </form>
  </main>
</template>
