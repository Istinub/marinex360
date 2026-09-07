<script setup lang="ts">
import Button from 'primevue/button';
import Column from 'primevue/column';
import DataTable from 'primevue/datatable';
import Dialog from 'primevue/dialog';
import InputText from 'primevue/inputtext';
import Password from 'primevue/password';
import { computed, onMounted, reactive, ref } from 'vue';
import { get, patch } from '@/lib/api/client';
import { ApiResponseError } from '@/lib/api/errors';
import type { Device } from '@/lib/api/types';

interface DeviceForm {
  id: string | null;
  name: string;
  pin: string;
}

const devices = ref<Device[]>([]);
const isLoading = ref(false);
const isSaving = ref(false);
const errorMessage = ref<string | null>(null);
const successMessage = ref<string | null>(null);
const showDialog = ref(false);
const form = reactive<DeviceForm>({
  id: null,
  name: '',
  pin: '',
});

const dialogTitle = computed(() => (form.id ? 'Edit device' : 'Device'));

async function load(): Promise<void> {
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

function openEdit(device: Device): void {
  form.id = device.id;
  form.name = device.name ?? '';
  form.pin = '';
  showDialog.value = true;
}

async function save(): Promise<void> {
  errorMessage.value = null;
  successMessage.value = null;
  if (!/^\d{4}$/.test(form.pin) && !form.id) {
    errorMessage.value = 'PIN must be four digits.';
    return;
  }
  if (form.pin && !/^\d{4}$/.test(form.pin)) {
    errorMessage.value = 'PIN must be four digits.';
    return;
  }

  isSaving.value = true;
  try {
    const body = {
      name: form.name.trim() || null,
      ...(form.pin ? { pin: form.pin } : {}),
    };
    if (!form.id) return;
    await patch<Device, typeof body>(`/devices/${encodeURIComponent(form.id)}`, body);
    successMessage.value = 'Device updated.';
    showDialog.value = false;
    await load();
  } catch (error) {
    errorMessage.value = error instanceof ApiResponseError ? error.message : 'Unable to save device.';
  } finally {
    isSaving.value = false;
  }
}

onMounted(load);
</script>

<template>
  <main class="office-route crm-page" aria-labelledby="devices-title">
    <header class="crm-page__header">
      <div>
        <p class="crm-page__eyebrow">Settings</p>
        <h1 id="devices-title" class="crm-page__title">Devices</h1>
        <p class="record-form__version">Fixed technician and leadership devices for PIN troubleshooting.</p>
      </div>
    </header>

    <p v-if="errorMessage" class="auth-message auth-message--error">{{ errorMessage }}</p>
    <p v-if="successMessage" class="auth-message auth-message--success">{{ successMessage }}</p>

    <DataTable :value="devices" :loading="isLoading" data-key="id" striped-rows>
      <Column field="id" header="Device ID" sortable />
      <Column field="name" header="Name" sortable>
        <template #body="{ data }">{{ data.name ?? 'Unnamed device' }}</template>
      </Column>
      <Column field="assignedUser.name" header="Assigned user" sortable>
        <template #body="{ data }">{{ data.assignedUser?.name ?? data.assignedUserId }}</template>
      </Column>
      <Column field="branch" header="Branch" sortable />
      <Column header="Actions">
        <template #body="{ data }">
          <Button label="Edit" icon="pi pi-pencil" severity="secondary" @click="openEdit(data)" />
        </template>
      </Column>
    </DataTable>

    <Dialog v-model:visible="showDialog" modal :header="dialogTitle" class="devices-dialog">
      <form class="record-form" @submit.prevent="save">
        <label class="auth-field" for="device-name">
          Name
          <InputText id="device-name" v-model="form.name" class="auth-input" />
        </label>

        <label class="auth-field" for="device-pin">
          PIN
          <Password
            v-model="form.pin"
            input-id="device-pin"
            class="auth-input"
            :feedback="false"
            inputmode="numeric"
            maxlength="4"
            pattern="[0-9]*"
            toggle-mask
          />
        </label>

        <div class="record-form__actions">
          <Button type="button" label="Cancel" severity="secondary" @click="showDialog = false" />
          <Button type="submit" label="Save" icon="pi pi-save" :loading="isSaving" />
        </div>
      </form>
    </Dialog>
  </main>
</template>

<style scoped>
.devices-dialog {
  width: min(100%, 34rem);
}
</style>
