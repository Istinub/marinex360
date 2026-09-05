<script setup lang="ts">
import Button from 'primevue/button';
import Column from 'primevue/column';
import DataTable from 'primevue/datatable';
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import MonoText from '@/components/common/MonoText.vue';
import { ApiResponseError } from '@/lib/api/errors';
import type { JobOrder } from '@/lib/api/types';
import { useAuthStore } from '@/stores/auth';
import { useJobOrdersStore } from '@/stores/jobOrders';

type Bucket = 'trash' | 'archive';

const auth = useAuthStore();
const route = useRoute();
const jobOrdersStore = useJobOrdersStore();
const jobOrders = ref<JobOrder[]>([]);
const isLoading = ref(false);
const errorMessage = ref<string | null>(null);
const actionMessage = ref<string | null>(null);

const bucket = computed<Bucket>(() => (route.meta.lifecycleBucket === 'archive' ? 'archive' : 'trash'));
const isDirector = computed(() => auth.identity?.roles.includes('DIRECTOR') ?? false);
const title = computed(() => (bucket.value === 'trash' ? 'Job order trash' : 'Job order archive'));
const emptyCopy = computed(() => (bucket.value === 'trash' ? 'Trash is empty.' : 'Archive is empty.'));

function formatDate(value?: string | null): string {
  if (!value) return '-';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(value));
}

async function loadRows(): Promise<void> {
  isLoading.value = true;
  errorMessage.value = null;
  try {
    jobOrders.value = bucket.value === 'trash'
      ? await jobOrdersStore.loadTrashedJobOrders()
      : await jobOrdersStore.loadArchivedJobOrders();
  } catch (error) {
    errorMessage.value = error instanceof ApiResponseError ? error.message : 'Unable to load job orders.';
  } finally {
    isLoading.value = false;
  }
}

async function runAction(action: () => Promise<unknown>, message: string): Promise<void> {
  actionMessage.value = null;
  errorMessage.value = null;
  try {
    await action();
    actionMessage.value = message;
    await loadRows();
  } catch (error) {
    errorMessage.value = error instanceof ApiResponseError ? error.message : 'Unable to update job order.';
  }
}

function moveToTrash(jobOrder: JobOrder): Promise<void> {
  return runAction(() => jobOrdersStore.deleteJobOrder(jobOrder.id), 'Job order moved to trash.');
}

function moveToArchive(jobOrder: JobOrder): Promise<void> {
  return runAction(() => jobOrdersStore.archiveJobOrder(jobOrder.id), 'Job order archived.');
}

function purge(jobOrder: JobOrder): Promise<void> {
  return runAction(() => jobOrdersStore.purgeJobOrder(jobOrder.id), 'Job order purged.');
}

function emptyTrash(): Promise<void> {
  return runAction(() => jobOrdersStore.emptyTrash(), 'Trash emptied.');
}

onMounted(loadRows);
watch(bucket, loadRows);
</script>

<template>
  <main class="office-route crm-page" :aria-labelledby="`${bucket}-title`">
    <header class="crm-page__header">
      <div>
        <p class="crm-page__eyebrow">Operations</p>
        <h1 :id="`${bucket}-title`" class="crm-page__title">{{ title }}</h1>
      </div>

      <Button
        v-if="bucket === 'trash' && jobOrders.length"
        label="Empty trash"
        icon="pi pi-trash"
        severity="danger"
        outlined
        @click="emptyTrash"
      />
    </header>

    <p v-if="actionMessage" class="auth-message auth-message--success" role="status">{{ actionMessage }}</p>
    <p v-if="errorMessage" class="auth-message auth-message--error" role="alert">{{ errorMessage }}</p>

    <DataTable :value="jobOrders" :loading="isLoading" data-key="id" size="small" striped-rows class="crm-table">
      <template #empty>
        <div class="crm-empty">{{ emptyCopy }}</div>
      </template>

      <Column field="joNumber" header="JO">
        <template #body="{ data }">
          <MonoText :value="data.joNumber" />
        </template>
      </Column>
      <Column field="state" header="State" />
      <Column field="scopeSummary" header="Scope" />
      <Column field="branch" header="Branch" />
      <Column v-if="bucket === 'trash'" field="deletedAt" header="Deleted">
        <template #body="{ data }">
          {{ formatDate(data.deletedAt) }}
        </template>
      </Column>
      <Column v-if="bucket === 'archive'" field="archivedAt" header="Archived">
        <template #body="{ data }">
          {{ formatDate(data.archivedAt) }}
        </template>
      </Column>
      <Column header="Actions">
        <template #body="{ data }">
          <div class="record-form__actions record-form__actions--left">
            <Button
              v-if="bucket === 'trash'"
              label="Archive"
              icon="pi pi-box"
              severity="secondary"
              outlined
              @click="moveToArchive(data)"
            />
            <Button
              v-if="bucket === 'archive'"
              label="Move to trash"
              icon="pi pi-trash"
              severity="secondary"
              outlined
              @click="moveToTrash(data)"
            />
            <Button
              v-if="bucket === 'trash' || isDirector"
              label="Purge"
              icon="pi pi-times"
              severity="danger"
              outlined
              @click="purge(data)"
            />
          </div>
        </template>
      </Column>
    </DataTable>
  </main>
</template>
