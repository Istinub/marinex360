<script setup lang="ts">
import Button from 'primevue/button';
import { onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import FieldError from '@/components/common/FieldError.vue';
import { post } from '@/lib/api/client';
import { ApiResponseError } from '@/lib/api/errors';
import type { Vessel } from '@/lib/api/types';
import { useClientsStore } from '@/stores/clients';

type VesselField = 'clientId' | 'imoNumber' | 'name' | 'type' | 'flag' | 'classification';

interface VesselCreateInput {
  clientId: string;
  imoNumber: string;
  name: string;
  type?: string | null;
  flag?: string | null;
  classification?: string | null;
}

const router = useRouter();
const clientsStore = useClientsStore();
const isLoadingClients = ref(true);
const isSaving = ref(false);
const formError = ref<string | null>(null);
const fieldErrors = reactive<Partial<Record<VesselField, string>>>({});
const form = reactive<Record<VesselField, string>>({
  clientId: '',
  imoNumber: '',
  name: '',
  type: '',
  flag: '',
  classification: '',
});

function clearFieldErrors(): void {
  for (const key of Object.keys(fieldErrors) as VesselField[]) delete fieldErrors[key];
}

function payload(): VesselCreateInput {
  return {
    clientId: form.clientId.trim(),
    imoNumber: form.imoNumber.trim(),
    name: form.name.trim(),
    type: form.type.trim() || null,
    flag: form.flag.trim() || null,
    classification: form.classification.trim() || null,
  };
}

function applyValidation(error: ApiResponseError): boolean {
  if (error.code !== 'VALIDATION_ERROR') return false;

  if (error.message === 'imoNumber already registered') {
    fieldErrors.imoNumber = error.message;
    return true;
  }

  if (error.message.includes('clientId')) fieldErrors.clientId = error.message;
  else if (error.message.includes('imoNumber')) fieldErrors.imoNumber = error.message;
  else if (error.message.includes('name')) fieldErrors.name = error.message;
  else formError.value = error.message;

  return true;
}

async function saveVessel(): Promise<void> {
  clearFieldErrors();
  formError.value = null;
  isSaving.value = true;

  try {
    const created = await post<Vessel, VesselCreateInput>('/vessels', payload());
    await router.replace(`/vessels/${created.id}/job-orders`);
  } catch (error) {
    if (error instanceof ApiResponseError) {
      if (applyValidation(error)) return;
      formError.value = error.message;
      return;
    }

    formError.value = 'Unable to save vessel.';
  } finally {
    isSaving.value = false;
  }
}

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
  <main class="office-route crm-page" aria-labelledby="vessel-form-title">
    <header class="crm-page__header">
      <div>
        <p class="crm-page__eyebrow">Vessel</p>
        <h1 id="vessel-form-title" class="crm-page__title">New vessel</h1>
      </div>
    </header>

    <form class="record-form record-form--structured" @submit.prevent="saveVessel">
      <p v-if="formError" class="auth-message auth-message--error" role="alert">
        {{ formError }}
      </p>

      <section class="record-form__section" aria-labelledby="vessel-ownership-heading">
        <h2 id="vessel-ownership-heading" class="record-form__section-heading">Ownership &amp; registration</h2>

        <label class="auth-field" for="vessel-client-id">
          <span>Client</span>
          <select
            id="vessel-client-id"
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

        <label class="auth-field" for="vessel-imo-number">
          <span>IMO number</span>
          <input
            id="vessel-imo-number"
            v-model="form.imoNumber"
            class="auth-input mono-input"
            placeholder="IMO number"
            required
          />
          <FieldError :message="fieldErrors.imoNumber" />
        </label>

        <p class="record-form__preview" :class="{ 'record-form__preview--empty': !form.imoNumber.trim() }">
          <span class="pi pi-info-circle" aria-hidden="true" />
          <template v-if="form.imoNumber.trim()">IMO {{ form.imoNumber.trim() }}</template>
          <template v-else>IMO number will appear once entered</template>
        </p>
      </section>

      <section class="record-form__section" aria-labelledby="vessel-details-heading">
        <h2 id="vessel-details-heading" class="record-form__section-heading">Vessel details</h2>

        <label class="auth-field" for="vessel-name">
          <span>Name</span>
          <input id="vessel-name" v-model="form.name" class="auth-input" placeholder="Vessel name" required />
          <FieldError :message="fieldErrors.name" />
        </label>

        <label class="auth-field" for="vessel-type">
          <span>Type</span>
          <input id="vessel-type" v-model="form.type" class="auth-input" placeholder="Vessel type" />
          <FieldError :message="fieldErrors.type" />
        </label>
      </section>

      <section class="record-form__section" aria-labelledby="vessel-classification-heading">
        <h2 id="vessel-classification-heading" class="record-form__section-heading">Flag &amp; classification</h2>

        <label class="auth-field" for="vessel-flag">
          <span>Flag</span>
          <input id="vessel-flag" v-model="form.flag" class="auth-input" placeholder="Flag" />
          <FieldError :message="fieldErrors.flag" />
        </label>

        <label class="auth-field" for="vessel-classification">
          <span>Classification</span>
          <input
            id="vessel-classification"
            v-model="form.classification"
            class="auth-input"
            placeholder="Classification"
          />
          <FieldError :message="fieldErrors.classification" />
        </label>
      </section>

      <div class="record-form__actions">
        <Button label="Cancel" severity="secondary" @click="router.back()" />
        <Button type="submit" label="Save" icon="pi pi-save" :loading="isSaving" />
      </div>
    </form>
  </main>
</template>
