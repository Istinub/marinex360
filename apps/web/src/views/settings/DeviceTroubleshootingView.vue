<script setup lang="ts">
import Column from 'primevue/column';
import DataTable from 'primevue/datatable';
import { onMounted, ref } from 'vue';
import { get } from '@/lib/api/client';
import { ApiResponseError } from '@/lib/api/errors';
import type { Device } from '@/lib/api/types';

const devices = ref<Device[]>([]);
const isLoading = ref(false);
const errorMessage = ref<string | null>(null);

async function loadDevices(): Promise<void> {
  isLoading.value = true;
  errorMessage.value = null;
  try {
    devices.value = await get<Device[]>('/devices');
  } catch (error) {
    errorMessage.value = error instanceof ApiResponseError ? error.message : 'Unable to load devices.';
  } finally {
    isLoading.value = false;
  }
}

onMounted(loadDevices);
</script>

<template>
  <main class="office-route crm-page" aria-labelledby="device-troubleshooting-title">
    <header class="crm-page__header">
      <div>
        <p class="crm-page__eyebrow">App Settings</p>
        <h1 id="device-troubleshooting-title" class="crm-page__title">Device Troubleshooting</h1>
        <p class="record-form__version">Online detection is deferred; device status is shown as pending for now.</p>
      </div>
    </header>

    <p v-if="errorMessage" class="auth-message auth-message--error">{{ errorMessage }}</p>

    <DataTable :value="devices" :loading="isLoading" data-key="id" striped-rows>
      <Column field="id" header="Device ID" sortable />
      <Column field="name" header="Name" sortable>
        <template #body="{ data }">{{ data.name ?? 'Unnamed device' }}</template>
      </Column>
      <Column field="assignedUser.name" header="Assigned user" sortable>
        <template #body="{ data }">{{ data.assignedUser?.name ?? data.assignedUserId }}</template>
      </Column>
      <Column field="branch" header="Branch" sortable />
      <Column header="Online/Offline">
        <template #body>
          <span class="status-pill">Pending</span>
        </template>
      </Column>
    </DataTable>
  </main>
</template>
