<script setup lang="ts">
import Button from 'primevue/button';
import Tag from 'primevue/tag';
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import BackLink from '@/components/common/BackLink.vue';
import MonoText from '@/components/common/MonoText.vue';
import NotFoundState from '@/components/common/NotFoundState.vue';
import { get, post } from '@/lib/api/client';
import { ApiResponseError } from '@/lib/api/errors';
import type { JobOrder } from '@/lib/api/types';

interface JobRequestClient {
  id: string;
  name: string;
}

interface JobRequest {
  id: string;
  clientId?: string | null;
  client?: JobRequestClient | null;
  guestName?: string | null;
  guestEmail?: string | null;
  guestCompany?: string | null;
  vesselDescription: string;
  scopeSummary: string;
  requestedDate?: string | null;
  branch: string;
  status: string;
  declineReason?: string | null;
  convertedJobOrderId?: string | null;
}

const route = useRoute();
const router = useRouter();
const requestId = computed(() => String(route.params.id));
const request = ref<JobRequest | null>(null);
const isLoading = ref(true);
const isSaving = ref(false);
const isNotFound = ref(false);
const errorMessage = ref<string | null>(null);
const declineReason = ref('Declined by operations');

const sourceLabel = computed(() => (request.value?.clientId ? 'Client portal' : 'Guest'));
const companyLabel = computed(() => request.value?.client?.name ?? request.value?.guestCompany ?? request.value?.guestName ?? '-');

function formatDate(value?: string | null): string {
  if (!value) return '-';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(value));
}

async function load(): Promise<void> {
  isLoading.value = true;
  errorMessage.value = null;
  try {
    request.value = await get<JobRequest>(`/job-requests/${requestId.value}`);
  } catch (error) {
    if (error instanceof ApiResponseError && error.code === 'NOT_FOUND') {
      isNotFound.value = true;
      return;
    }
    errorMessage.value = error instanceof ApiResponseError ? error.message : 'Unable to load request.';
  } finally {
    isLoading.value = false;
  }
}

async function convert(): Promise<void> {
  if (!request.value) return;
  isSaving.value = true;
  errorMessage.value = null;
  try {
    const jobOrder = await post<JobOrder, Record<string, never>>(`/job-requests/${request.value.id}/convert`, {});
    await router.replace(`/job-orders/${jobOrder.id}`);
  } catch (error) {
    errorMessage.value = error instanceof ApiResponseError ? error.message : 'Unable to convert request.';
  } finally {
    isSaving.value = false;
  }
}

async function decline(): Promise<void> {
  if (!request.value) return;
  isSaving.value = true;
  errorMessage.value = null;
  try {
    await post<JobRequest, { declineReason: string }>(`/job-requests/${request.value.id}/decline`, {
      declineReason: declineReason.value.trim() || 'Declined by operations',
    });
    await router.replace('/job-requests');
  } catch (error) {
    errorMessage.value = error instanceof ApiResponseError ? error.message : 'Unable to decline request.';
  } finally {
    isSaving.value = false;
  }
}

onMounted(load);
</script>

<template>
  <NotFoundState v-if="isNotFound" />

  <main v-else class="office-route crm-page" aria-labelledby="job-request-title">
    <p v-if="isLoading" class="crm-empty">Loading request...</p>
    <p v-else-if="errorMessage && !request" class="auth-message auth-message--error" role="alert">{{ errorMessage }}</p>

    <template v-else-if="request">
      <header class="crm-page__header">
        <div>
          <BackLink to="/job-requests" label="Job requests" />
          <h1 id="job-request-title" class="crm-page__title">Service request</h1>
          <p class="record-form__version">
            ID <MonoText :value="request.id" /> · {{ sourceLabel }}
          </p>
        </div>
        <Tag :value="request.status" severity="warn" />
      </header>

      <p v-if="errorMessage" class="auth-message auth-message--error" role="alert">{{ errorMessage }}</p>

      <section class="crm-section" aria-labelledby="request-content-title">
        <h2 id="request-content-title" class="crm-section__title">Submitted content</h2>
        <dl class="record-detail">
          <div>
            <dt>Name</dt>
            <dd>{{ request.guestName ?? '-' }}</dd>
          </div>
          <div>
            <dt>Email</dt>
            <dd>{{ request.guestEmail ?? '-' }}</dd>
          </div>
          <div>
            <dt>Company / client</dt>
            <dd>{{ companyLabel }}</dd>
          </div>
          <div>
            <dt>Branch</dt>
            <dd>{{ request.branch }}</dd>
          </div>
          <div>
            <dt>Vessel description</dt>
            <dd>{{ request.vesselDescription }}</dd>
          </div>
          <div>
            <dt>Scope summary</dt>
            <dd>{{ request.scopeSummary }}</dd>
          </div>
          <div>
            <dt>Requested date</dt>
            <dd>{{ formatDate(request.requestedDate) }}</dd>
          </div>
        </dl>
      </section>

      <section class="crm-section" aria-labelledby="request-actions-title">
        <h2 id="request-actions-title" class="crm-section__title">Actions</h2>
        <label class="auth-field" for="decline-reason">
          <span>Decline reason</span>
          <textarea id="decline-reason" v-model="declineReason" class="auth-input record-form__textarea" />
        </label>
        <div class="record-form__actions record-form__actions--left">
          <Button label="Approve & Convert" icon="pi pi-check" :loading="isSaving" @click="convert" />
          <Button label="Decline" icon="pi pi-times" severity="secondary" :loading="isSaving" @click="decline" />
        </div>
      </section>
    </template>
  </main>
</template>
