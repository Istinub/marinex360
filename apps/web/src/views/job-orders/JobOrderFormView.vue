<script setup lang="ts">
import Button from 'primevue/button';
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import FieldError from '@/components/common/FieldError.vue';
import MonoText from '@/components/common/MonoText.vue';
import { ApiResponseError } from '@/lib/api/errors';
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

const serviceCategoryOptions = ['mechanical', 'electrical', 'inspection'] as const;

const router = useRouter();
const clientsStore = useClientsStore();
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
  quotedAmountMinor: '',
  quotedCurrency: 'SGD',
});

const vesselOptions = computed(() => clientsStore.selectedClient?.vessels ?? []);

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
  if (!/^-?\d+$/.test(form.quotedAmountMinor.trim())) {
    fieldErrors.quotedAmountMinor = 'Quoted amount must be integer minor units.';
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
    quotedAmountMinor: Number.parseInt(form.quotedAmountMinor.trim(), 10),
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
    await clientsStore.loadClients();
  } catch (error) {
    formError.value = error instanceof ApiResponseError ? error.message : 'Unable to load clients.';
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

    <form class="record-form" @submit.prevent="saveJobOrder">
      <p v-if="formError" class="auth-message auth-message--error" role="alert">
        {{ formError }}
      </p>

      <label class="auth-field" for="jo-client-id">
        <span>Client</span>
        <select id="jo-client-id" v-model="form.clientId" class="auth-input" :disabled="isLoadingClients" required>
          <option value="">{{ isLoadingClients ? 'Loading clients...' : 'Select client' }}</option>
          <option v-for="client in clientsStore.sortedClients" :key="client.id" :value="client.id">
            {{ client.name }}
          </option>
        </select>
        <FieldError :message="fieldErrors.clientId" />
      </label>

      <label class="auth-field" for="jo-vessel-id">
        <span>Vessel</span>
        <select id="jo-vessel-id" v-model="form.vesselId" class="auth-input" :disabled="!form.clientId || isLoadingVessels" required>
          <option value="">{{ isLoadingVessels ? 'Loading vessels...' : 'Select vessel' }}</option>
          <option v-for="vessel in vesselOptions" :key="vessel.id" :value="vessel.id">
            {{ vessel.name }} · {{ vessel.imoNumber }}
          </option>
        </select>
        <FieldError :message="fieldErrors.vesselId" />
      </label>

      <label class="auth-field" for="jo-service-categories-create">
        <span>Service categories</span>
        <select id="jo-service-categories-create" v-model="form.serviceCategories" class="auth-input record-form__multi-select" multiple>
          <option v-for="category in serviceCategoryOptions" :key="category" :value="category">
            {{ category }}
          </option>
        </select>
        <FieldError :message="fieldErrors.serviceCategories" />
      </label>

      <label class="auth-field" for="jo-port-create">
        <span>Port</span>
        <input id="jo-port-create" v-model="form.port" class="auth-input" />
        <FieldError :message="fieldErrors.port" />
      </label>

      <label class="auth-field" for="jo-scope-create">
        <span>Scope summary</span>
        <textarea id="jo-scope-create" v-model="form.scopeSummary" class="auth-input record-form__textarea" required />
        <FieldError :message="fieldErrors.scopeSummary" />
      </label>

      <label class="auth-field" for="jo-external-quote-create">
        <span>External quote ref</span>
        <input id="jo-external-quote-create" v-model="form.externalQuoteRef" class="auth-input mono-input" />
        <FieldError :message="fieldErrors.externalQuoteRef" />
      </label>

      <label class="auth-field" for="jo-external-rfq-create">
        <span>External RFQ ref</span>
        <input id="jo-external-rfq-create" v-model="form.externalRfqRef" class="auth-input mono-input" />
        <FieldError :message="fieldErrors.externalRfqRef" />
      </label>

      <div class="record-form__money-pair">
        <label class="auth-field" for="jo-quoted-amount-minor">
          <span>Quoted amount minor</span>
          <input
            id="jo-quoted-amount-minor"
            v-model="form.quotedAmountMinor"
            class="auth-input mono-input"
            inputmode="numeric"
            required
          />
          <FieldError :message="fieldErrors.quotedAmountMinor" />
        </label>

        <label class="auth-field" for="jo-quoted-currency">
          <span>Currency</span>
          <input id="jo-quoted-currency" v-model="form.quotedCurrency" class="auth-input mono-input" required />
          <FieldError :message="fieldErrors.quotedCurrency" />
        </label>
      </div>

      <p class="record-form__version">
        Selected client <MonoText :value="form.clientId || null" /> · vessel <MonoText :value="form.vesselId || null" />
      </p>

      <div class="record-form__actions">
        <Button label="Cancel" severity="secondary" @click="router.back()" />
        <Button type="submit" label="Create job order" icon="pi pi-save" :loading="isSaving" />
      </div>
    </form>
  </main>
</template>
