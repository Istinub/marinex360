<script setup lang="ts">
import Button from 'primevue/button';
import { computed, onMounted, reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import FieldError from '@/components/common/FieldError.vue';
import MonoText from '@/components/common/MonoText.vue';
import NotFoundState from '@/components/common/NotFoundState.vue';
import VersionConflictDialog from '@/components/common/VersionConflictDialog.vue';
import { ApiResponseError } from '@/lib/api/errors';
import type { ClientDetail } from '@/lib/api/types';
import { useClientsStore, type ClientInput } from '@/stores/clients';

type ClientField = 'name' | 'address' | 'creditTerms' | 'status' | 'primaryContactId';

const route = useRoute();
const router = useRouter();
const clientsStore = useClientsStore();

const isEdit = computed(() => route.name === 'client-edit');
const clientId = computed(() => String(route.params.id ?? ''));
const loadedClient = ref<ClientDetail | null>(null);
const isLoading = ref(false);
const isSaving = ref(false);
const isNotFound = ref(false);
const showConflict = ref(false);
const formError = ref<string | null>(null);
const fieldErrors = reactive<Partial<Record<ClientField, string>>>({});
const form = reactive<Record<ClientField, string>>({
  name: '',
  address: '',
  creditTerms: '',
  status: 'ACTIVE',
  primaryContactId: '',
});

function clearFieldErrors(): void {
  for (const key of Object.keys(fieldErrors) as ClientField[]) delete fieldErrors[key];
}

function applyLoadedClient(client: ClientDetail): void {
  loadedClient.value = client;
  form.name = client.name;
  form.address = client.address ?? '';
  form.creditTerms = client.creditTerms ?? '';
  form.status = client.status;
  form.primaryContactId = client.primaryContactId ?? '';
}

function payload(): ClientInput {
  return {
    name: form.name.trim(),
    address: form.address.trim() || null,
    creditTerms: form.creditTerms.trim() || null,
    status: form.status.trim() || 'ACTIVE',
    primaryContactId: form.primaryContactId.trim() || null,
  };
}

function applyValidation(error: ApiResponseError): boolean {
  if (error.code !== 'VALIDATION_ERROR') return false;
  if (error.message.includes('name')) fieldErrors.name = error.message;
  else formError.value = error.message;
  return true;
}

async function loadForEdit(): Promise<void> {
  if (!isEdit.value) return;

  isLoading.value = true;
  try {
    applyLoadedClient(await clientsStore.loadClient(clientId.value));
  } catch (error) {
    if (error instanceof ApiResponseError && error.code === 'NOT_FOUND') {
      isNotFound.value = true;
      return;
    }
    formError.value = error instanceof ApiResponseError ? error.message : 'Unable to load client.';
  } finally {
    isLoading.value = false;
  }
}

async function reloadVersionForConflict(): Promise<void> {
  const fresh = await clientsStore.loadClient(clientId.value);
  loadedClient.value = fresh;
  showConflict.value = true;
}

async function saveClient(isConflictConfirm = false): Promise<void> {
  clearFieldErrors();
  formError.value = null;
  isSaving.value = true;

  try {
    if (isEdit.value) {
      if (!loadedClient.value) throw new Error('Client is not loaded.');
      const updated = await clientsStore.updateClient(clientId.value, {
        ...payload(),
        version: loadedClient.value.version,
      });
      showConflict.value = false;
      await router.replace(`/clients/${updated.id}`);
      return;
    }

    const created = await clientsStore.createClient(payload());
    await router.replace(`/clients/${created.id}`);
  } catch (error) {
    if (error instanceof ApiResponseError) {
      if (error.code === 'VERSION_CONFLICT' && isEdit.value && !isConflictConfirm) {
        await reloadVersionForConflict();
        return;
      }
      if (applyValidation(error)) return;
      formError.value = error.message;
      return;
    }
    formError.value = 'Unable to save client.';
  } finally {
    isSaving.value = false;
  }
}

onMounted(loadForEdit);
</script>

<template>
  <NotFoundState v-if="isNotFound" />

  <main v-else class="office-route crm-page" aria-labelledby="client-form-title">
    <header class="crm-page__header">
      <div>
        <p class="crm-page__eyebrow">Client</p>
        <h1 id="client-form-title" class="crm-page__title">
          {{ isEdit ? 'Edit client' : 'New client' }}
        </h1>
      </div>
    </header>

    <p v-if="isLoading" class="crm-empty">Loading client...</p>

    <form v-else class="record-form" @submit.prevent="saveClient(false)">
      <p v-if="formError" class="auth-message auth-message--error" role="alert">
        {{ formError }}
      </p>

      <label class="auth-field" for="client-name">
        <span>Name</span>
        <input id="client-name" v-model="form.name" class="auth-input" required />
        <FieldError :message="fieldErrors.name" />
      </label>

      <label class="auth-field" for="client-status">
        <span>Status</span>
        <input id="client-status" v-model="form.status" class="auth-input" />
        <FieldError :message="fieldErrors.status" />
      </label>

      <label class="auth-field" for="client-address">
        <span>Address</span>
        <textarea id="client-address" v-model="form.address" class="auth-input record-form__textarea" />
        <FieldError :message="fieldErrors.address" />
      </label>

      <label class="auth-field" for="client-credit-terms">
        <span>Credit terms</span>
        <input id="client-credit-terms" v-model="form.creditTerms" class="auth-input" />
        <FieldError :message="fieldErrors.creditTerms" />
      </label>

      <label class="auth-field" for="client-contact-id">
        <span>Primary contact ID</span>
        <input id="client-contact-id" v-model="form.primaryContactId" class="auth-input" />
        <FieldError :message="fieldErrors.primaryContactId" />
      </label>

      <p v-if="loadedClient" class="record-form__version">
        Version <MonoText :value="loadedClient.version" />
      </p>

      <div class="record-form__actions">
        <Button label="Cancel" severity="secondary" @click="router.back()" />
        <Button type="submit" label="Save" icon="pi pi-save" :loading="isSaving" />
      </div>
    </form>

    <VersionConflictDialog
      v-if="showConflict"
      :is-saving="isSaving"
      @cancel="showConflict = false"
      @confirm="saveClient(true)"
    />
  </main>
</template>
