<script setup lang="ts">
import Button from 'primevue/button';
import Column from 'primevue/column';
import DataTable from 'primevue/datatable';
import Dialog from 'primevue/dialog';
import InputText from 'primevue/inputtext';
import Password from 'primevue/password';
import Select from 'primevue/select';
import { computed, onMounted, reactive, ref } from 'vue';
import { get, patch, post } from '@/lib/api/client';
import { ApiResponseError } from '@/lib/api/errors';
import type { Device, DeviceUserLookup } from '@/lib/api/types';

interface DeviceForm {
  id: string | null;
  name: string;
  pin: string;
  assignedUserId: string;
}

const devices = ref<Device[]>([]);
const users = ref<DeviceUserLookup[]>([]);
const isLoading = ref(false);
const isSaving = ref(false);
const errorMessage = ref<string | null>(null);
const successMessage = ref<string | null>(null);
const showDialog = ref(false);
const form = reactive<DeviceForm>({
  id: null,
  name: '',
  pin: '',
  assignedUserId: '',
});

const dialogTitle = computed(() => (form.id ? 'Edit device' : 'Register device'));
const userOptions = computed(() => users.value.map((user) => ({
  label: `${user.name} (${user.roles.join(', ')})`,
  value: user.id,
})));

async function load(): Promise<void> {
  isLoading.value = true;
  errorMessage.value = null;
  try {
    const [deviceRows, userRows] = await Promise.all([
      get<Device[]>('/devices'),
      get<DeviceUserLookup[]>('/devices/users'),
    ]);
    devices.value = deviceRows;
    users.value = userRows;
  } catch (error) {
    errorMessage.value = error instanceof ApiResponseError ? error.message : 'Unable to load devices.';
  } finally {
    isLoading.value = false;
  }
}

function resetForm(): void {
  form.id = null;
  form.name = '';
  form.pin = '';
  form.assignedUserId = userOptions.value[0]?.value ?? '';
}

function openCreate(): void {
  resetForm();
  showDialog.value = true;
}

function openEdit(device: Device): void {
  form.id = device.id;
  form.name = device.name ?? '';
  form.pin = '';
  form.assignedUserId = device.assignedUserId;
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
  if (!form.assignedUserId) {
    errorMessage.value = 'Assigned user is required.';
    return;
  }

  isSaving.value = true;
  try {
    const body = {
      name: form.name.trim() || null,
      assignedUserId: form.assignedUserId,
      ...(form.pin ? { pin: form.pin } : {}),
    };
    if (form.id) {
      await patch<Device, typeof body>(`/devices/${encodeURIComponent(form.id)}`, body);
      successMessage.value = 'Device updated.';
    } else {
      await post<Device, typeof body>('/devices', body);
      successMessage.value = 'Device registered.';
    }
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
        <p class="record-form__version">Register tablets and assign the user unlocked by each PIN.</p>
      </div>
      <Button label="Register device" icon="pi pi-plus" @click="openCreate" />
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

        <label class="auth-field" for="device-user">
          Assigned user
          <Select
            id="device-user"
            v-model="form.assignedUserId"
            class="auth-input"
            :options="userOptions"
            option-label="label"
            option-value="value"
            placeholder="Select a user"
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
