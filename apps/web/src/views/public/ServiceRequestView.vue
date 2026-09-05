<script setup lang="ts">
import Button from 'primevue/button';
import { reactive, ref } from 'vue';
import FieldError from '@/components/common/FieldError.vue';
import { post } from '@/lib/api/client';
import { ApiResponseError } from '@/lib/api/errors';

type GuestRequestField =
  | 'guestName'
  | 'guestEmail'
  | 'guestCompany'
  | 'branch'
  | 'vesselDescription'
  | 'scopeSummary'
  | 'requestedDate';

interface PublicJobRequestPayload {
  guestName: string;
  guestEmail: string;
  guestCompany?: string;
  branch: string;
  vesselDescription: string;
  scopeSummary: string;
  requestedDate?: string;
}

const RATE_LIMIT_COPY = 'Too many requests. Please try again later.';
const SUCCESS_COPY = 'Request received. TKMR will contact you shortly.';

const form = reactive<Record<GuestRequestField, string>>({
  guestName: '',
  guestEmail: '',
  guestCompany: '',
  branch: 'SG',
  vesselDescription: '',
  scopeSummary: '',
  requestedDate: '',
});
const fieldErrors = reactive<Partial<Record<GuestRequestField, string>>>({});
const submitted = ref(false);
const errorMessage = ref<string | null>(null);
const submitting = ref(false);

function clearFieldErrors(): void {
  for (const key of Object.keys(fieldErrors) as GuestRequestField[]) delete fieldErrors[key];
}

function setRequired(field: GuestRequestField, label: string): void {
  if (!form[field].trim()) fieldErrors[field] = `${label} is required.`;
}

function validateForm(): boolean {
  clearFieldErrors();
  errorMessage.value = null;

  setRequired('guestName', 'Guest name');
  setRequired('guestEmail', 'Guest email');
  setRequired('branch', 'Branch');
  setRequired('vesselDescription', 'Vessel description');
  setRequired('scopeSummary', 'Scope summary');

  if (form.guestEmail.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.guestEmail.trim())) {
    fieldErrors.guestEmail = 'Enter a valid email address.';
  }

  return Object.keys(fieldErrors).length === 0;
}

function payload(): PublicJobRequestPayload {
  return {
    guestName: form.guestName.trim(),
    guestEmail: form.guestEmail.trim(),
    guestCompany: form.guestCompany.trim() || undefined,
    branch: form.branch.trim().toUpperCase(),
    vesselDescription: form.vesselDescription.trim(),
    scopeSummary: form.scopeSummary.trim(),
    requestedDate: form.requestedDate || undefined,
  };
}

function applyValidationError(error: ApiResponseError): boolean {
  if (error.code !== 'VALIDATION_ERROR') return false;

  const fields: GuestRequestField[] = [
    'guestName',
    'guestEmail',
    'branch',
    'vesselDescription',
    'scopeSummary',
    'requestedDate',
  ];
  const field = fields.find((name) => error.message.includes(name));
  if (!field) {
    errorMessage.value = error.message;
    return true;
  }

  fieldErrors[field] = error.message;
  return true;
}

async function submit(): Promise<void> {
  if (!validateForm()) return;

  submitting.value = true;
  clearFieldErrors();
  errorMessage.value = null;
  try {
    await post('/job-requests/public', payload(), {
      skipAuth: true,
      retryOnUnauthorized: false,
    });
    submitted.value = true;
  } catch (error) {
    if (error instanceof ApiResponseError) {
      if (error.status === 429) {
        errorMessage.value = RATE_LIMIT_COPY;
        return;
      }
      if (applyValidationError(error)) return;
      errorMessage.value = error.message;
      return;
    }

    errorMessage.value = 'Unable to submit request.';
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <main class="auth-page" aria-labelledby="request-title">
    <section v-if="submitted" class="auth-panel">
      <p class="auth-panel__eyebrow">TKMR Marine &amp; Offshore Engineering</p>
      <h1 id="request-title" class="auth-panel__title">Request received</h1>
      <p class="auth-panel__copy">{{ SUCCESS_COPY }}</p>
    </section>

    <form v-else class="auth-panel service-request-form" novalidate @submit.prevent="submit">
      <div class="auth-panel__header">
        <p class="auth-panel__eyebrow">TKMR Marine &amp; Offshore Engineering</p>
        <h1 id="request-title" class="auth-panel__title">Request service</h1>
      </div>

      <p v-if="errorMessage" class="auth-message auth-message--error" role="alert">{{ errorMessage }}</p>

      <label class="auth-field" for="guest-name">
        <span>Guest name</span>
        <input
          id="guest-name"
          v-model="form.guestName"
          class="auth-input"
          autocomplete="name"
          :aria-invalid="Boolean(fieldErrors.guestName)"
        />
        <FieldError :message="fieldErrors.guestName" />
      </label>

      <label class="auth-field" for="guest-email">
        <span>Guest email</span>
        <input
          id="guest-email"
          v-model="form.guestEmail"
          class="auth-input"
          type="email"
          autocomplete="email"
          :aria-invalid="Boolean(fieldErrors.guestEmail)"
        />
        <FieldError :message="fieldErrors.guestEmail" />
      </label>

      <label class="auth-field" for="guest-company">
        <span>Guest company</span>
        <input id="guest-company" v-model="form.guestCompany" class="auth-input" autocomplete="organization" />
        <FieldError :message="fieldErrors.guestCompany" />
      </label>

      <label class="auth-field" for="request-branch">
        <span>Branch</span>
        <input
          id="request-branch"
          v-model="form.branch"
          class="auth-input mono-input"
          :aria-invalid="Boolean(fieldErrors.branch)"
        />
        <FieldError :message="fieldErrors.branch" />
      </label>

      <label class="auth-field" for="vessel-description">
        <span>Vessel description</span>
        <textarea
          id="vessel-description"
          v-model="form.vesselDescription"
          class="auth-input record-form__textarea"
          :aria-invalid="Boolean(fieldErrors.vesselDescription)"
        />
        <FieldError :message="fieldErrors.vesselDescription" />
      </label>

      <label class="auth-field" for="scope-summary">
        <span>Scope summary</span>
        <textarea
          id="scope-summary"
          v-model="form.scopeSummary"
          class="auth-input record-form__textarea"
          :aria-invalid="Boolean(fieldErrors.scopeSummary)"
        />
        <FieldError :message="fieldErrors.scopeSummary" />
      </label>

      <label class="auth-field" for="requested-date">
        <span>Requested date</span>
        <input
          id="requested-date"
          v-model="form.requestedDate"
          class="auth-input"
          type="date"
          :aria-invalid="Boolean(fieldErrors.requestedDate)"
        />
        <FieldError :message="fieldErrors.requestedDate" />
      </label>

      <Button type="submit" label="Send request" icon="pi pi-send" :loading="submitting" />
    </form>
  </main>
</template>

<style scoped>
.service-request-form {
  --auth-panel-width: 34rem;
}
</style>
