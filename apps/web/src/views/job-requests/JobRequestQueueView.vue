<script setup lang="ts">
import Button from 'primevue/button';
import Column from 'primevue/column';
import DataTable from 'primevue/datatable';
import Tag from 'primevue/tag';
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { get } from '@/lib/api/client';
import { ApiResponseError } from '@/lib/api/errors';

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
}

const requests = ref<JobRequest[]>([]);
const router = useRouter();
const errorMessage = ref<string | null>(null);
const isLoading = ref(false);

function sourceLabel(request: JobRequest): string {
  return request.clientId ? 'Client portal' : 'Guest';
}

function companyLabel(request: JobRequest): string {
  return request.client?.name ?? request.guestCompany ?? request.guestName ?? 'Not provided';
}

function contactLabel(request: JobRequest): string {
  return request.guestEmail ?? '—';
}

function formatDate(value?: string | null): string {
  if (!value) return '—';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(value));
}

async function load(): Promise<void> {
  isLoading.value = true;
  errorMessage.value = null;
  try {
    requests.value = await get<JobRequest[]>('/job-requests');
  } catch (error) {
    errorMessage.value = error instanceof ApiResponseError ? error.message : 'Unable to load requests.';
  } finally {
    isLoading.value = false;
  }
}

function openRequest(request: JobRequest): void {
  void router.push(`/job-requests/${request.id}`);
}

onMounted(load);
</script>

<template>
  <main class="office-route crm-page" aria-labelledby="requests-title">
    <header class="crm-page__header">
      <div>
        <p class="crm-page__eyebrow">Operations</p>
        <h1 id="requests-title" class="crm-page__title">Job requests</h1>
      </div>

      <Button icon="pi pi-refresh" label="Refresh" :loading="isLoading" @click="load" />
    </header>

    <div v-if="errorMessage" class="record-form__actions record-form__actions--left" role="alert">
      <p class="auth-message auth-message--error">{{ errorMessage }}</p>
      <Button label="Retry" icon="pi pi-refresh" severity="secondary" :loading="isLoading" @click="load" />
    </div>

    <DataTable
      :value="requests"
      :loading="isLoading"
      data-key="id"
      size="small"
      striped-rows
      removable-sort
      class="crm-table"
      @row-click="openRequest($event.data)"
    >
      <template #empty>
        <div class="crm-empty">No pending job requests.</div>
      </template>

      <Column header="Source">
        <template #body="{ data }">
          {{ sourceLabel(data) }}
        </template>
      </Column>
      <Column header="Company / client">
        <template #body="{ data }">
          <strong>{{ companyLabel(data) }}</strong>
          <p class="record-form__version">{{ contactLabel(data) }}</p>
        </template>
      </Column>
      <Column field="vesselDescription" header="Vessel" sortable />
      <Column field="scopeSummary" header="Scope" sortable />
      <Column field="branch" header="Branch" sortable />
      <Column field="requestedDate" header="Requested" sortable>
        <template #body="{ data }">
          {{ formatDate(data.requestedDate) }}
        </template>
      </Column>
      <Column field="status" header="Status" sortable>
        <template #body="{ data }">
          <Tag :value="data.status" severity="warn" />
        </template>
      </Column>
      <Column header="Open">
        <template #body="{ data }">
          <Button label="Review" icon="pi pi-arrow-right" size="small" text @click.stop="openRequest(data)" />
        </template>
      </Column>
    </DataTable>
  </main>
</template>
