<script setup lang="ts">
import Button from 'primevue/button';
import { onMounted, reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import FieldError from '@/components/common/FieldError.vue';
import MonoText from '@/components/common/MonoText.vue';
import NotFoundState from '@/components/common/NotFoundState.vue';
import VersionConflictDialog from '@/components/common/VersionConflictDialog.vue';
import { get, patch } from '@/lib/api/client';
import { ApiResponseError } from '@/lib/api/errors';
import type { Contact } from '@/lib/api/types';

type ContactField = 'name' | 'email' | 'phone';

const route = useRoute();
const router = useRouter();
const contactId = String(route.params.id);

const loadedContact = ref<Contact | null>(null);
const isLoading = ref(true);
const isSaving = ref(false);
const isNotFound = ref(false);
const showConflict = ref(false);
const formError = ref<string | null>(null);
const fieldErrors = reactive<Partial<Record<ContactField, string>>>({});
const form = reactive<Record<ContactField, string>>({
  name: '',
  email: '',
  phone: '',
});

function clearFieldErrors(): void {
  for (const key of Object.keys(fieldErrors) as ContactField[]) delete fieldErrors[key];
}

function applyLoadedContact(contact: Contact, overwriteForm: boolean): void {
  loadedContact.value = contact;
  if (!overwriteForm) return;
  form.name = contact.name;
  form.email = contact.email ?? '';
  form.phone = contact.phone ?? '';
}

function contactPayload(): { name: string; email: string | null; phone: string | null; version: number } {
  if (!loadedContact.value) throw new Error('Contact is not loaded.');
  return {
    name: form.name.trim(),
    email: form.email.trim() || null,
    phone: form.phone.trim() || null,
    version: loadedContact.value.version,
  };
}

function applyValidation(error: ApiResponseError): boolean {
  if (error.code !== 'VALIDATION_ERROR') return false;
  if (error.message.includes('name')) fieldErrors.name = error.message;
  else formError.value = error.message;
  return true;
}

async function loadContact(overwriteForm = true): Promise<Contact> {
  const contact = await get<Contact>(`/contacts/${contactId}`);
  applyLoadedContact(contact, overwriteForm);
  return contact;
}

async function saveContact(isConflictConfirm = false): Promise<void> {
  clearFieldErrors();
  formError.value = null;
  isSaving.value = true;

  try {
    const updated = await patch<Contact, ReturnType<typeof contactPayload>>(`/contacts/${contactId}`, contactPayload());
    showConflict.value = false;
    applyLoadedContact(updated, true);
    router.back();
  } catch (error) {
    if (error instanceof ApiResponseError) {
      if (error.code === 'VERSION_CONFLICT' && !isConflictConfirm) {
        await loadContact(false);
        showConflict.value = true;
        return;
      }
      if (error.code === 'NOT_FOUND') {
        isNotFound.value = true;
        return;
      }
      if (applyValidation(error)) return;
      formError.value = error.message;
      return;
    }
    formError.value = 'Unable to save contact.';
  } finally {
    isSaving.value = false;
  }
}

onMounted(async () => {
  try {
    await loadContact();
  } catch (error) {
    if (error instanceof ApiResponseError && error.code === 'NOT_FOUND') {
      isNotFound.value = true;
      return;
    }
    formError.value = error instanceof ApiResponseError ? error.message : 'Unable to load contact.';
  } finally {
    isLoading.value = false;
  }
});
</script>

<template>
  <NotFoundState v-if="isNotFound" />

  <main v-else class="office-route crm-page" aria-labelledby="contact-form-title">
    <header class="crm-page__header">
      <div>
        <p class="crm-page__eyebrow">Contact</p>
        <h1 id="contact-form-title" class="crm-page__title">Edit contact</h1>
      </div>
    </header>

    <p v-if="isLoading" class="crm-empty">Loading contact...</p>

    <form v-else class="record-form" @submit.prevent="saveContact(false)">
      <p v-if="formError" class="auth-message auth-message--error" role="alert">
        {{ formError }}
      </p>

      <label class="auth-field" for="contact-name">
        <span>Name</span>
        <input id="contact-name" v-model="form.name" class="auth-input" required />
        <FieldError :message="fieldErrors.name" />
      </label>

      <label class="auth-field" for="contact-email">
        <span>Email</span>
        <input id="contact-email" v-model="form.email" class="auth-input" type="email" />
        <FieldError :message="fieldErrors.email" />
      </label>

      <label class="auth-field" for="contact-phone">
        <span>Phone</span>
        <input id="contact-phone" v-model="form.phone" class="auth-input" />
        <FieldError :message="fieldErrors.phone" />
      </label>

      <p v-if="loadedContact" class="record-form__version">
        Version <MonoText :value="loadedContact.version" />
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
      @confirm="saveContact(true)"
    />
  </main>
</template>
