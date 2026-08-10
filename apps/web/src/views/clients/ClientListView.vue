<script setup lang="ts">
import Button from 'primevue/button';
import Column from 'primevue/column';
import DataTable from 'primevue/datatable';
import InputText from 'primevue/inputtext';
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import MonoText from '@/components/common/MonoText.vue';
import { ApiResponseError } from '@/lib/api/errors';
import type { Client } from '@/lib/api/types';
import { useClientsStore } from '@/stores/clients';

const router = useRouter();
const clientsStore = useClientsStore();
const search = ref('');
const errorMessage = ref<string | null>(null);

const filteredClients = computed(() => {
  const query = search.value.trim().toLowerCase();
  if (!query) return clientsStore.sortedClients;

  return clientsStore.sortedClients.filter((client) =>
    [client.name, client.status, client.address, client.creditTerms, client.id]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(query)),
  );
});

async function loadClients(): Promise<void> {
  errorMessage.value = null;
  try {
    await clientsStore.loadClients();
  } catch (error) {
    errorMessage.value = error instanceof ApiResponseError ? error.message : 'Unable to load clients.';
  }
}

onMounted(loadClients);

function openClient(client: Client): void {
  void router.push(`/clients/${client.id}`);
}
</script>

<template>
  <main class="office-route crm-page" aria-labelledby="clients-title">
    <header class="crm-page__header">
      <div>
        <p class="crm-page__eyebrow">CRM</p>
        <h1 id="clients-title" class="crm-page__title">Clients</h1>
      </div>

      <Button label="New client" icon="pi pi-plus" @click="router.push('/clients/new')" />
    </header>

    <section class="crm-toolbar" aria-label="Client tools">
      <span class="p-input-icon-left crm-toolbar__search">
        <i class="pi pi-search" aria-hidden="true" />
        <InputText v-model="search" placeholder="Search clients" />
      </span>
    </section>

    <div v-if="errorMessage" class="record-form__actions record-form__actions--left" role="alert">
      <p class="auth-message auth-message--error">
        {{ errorMessage }}
      </p>
      <Button label="Retry" icon="pi pi-refresh" severity="secondary" :loading="clientsStore.isLoading" @click="loadClients" />
    </div>

    <DataTable
      :value="filteredClients"
      :loading="clientsStore.isLoading"
      data-key="id"
      size="small"
      striped-rows
      removable-sort
      class="crm-table"
      @row-click="openClient($event.data)"
    >
      <template #empty>
        <div class="crm-empty">No clients yet.</div>
      </template>

      <Column field="name" header="Client" sortable />
      <Column field="status" header="Status" sortable />
      <Column field="creditTerms" header="Credit terms" sortable>
        <template #body="{ data }">
          {{ data.creditTerms ?? '—' }}
        </template>
      </Column>
      <Column field="address" header="Address" sortable>
        <template #body="{ data }">
          {{ data.address ?? '—' }}
        </template>
      </Column>
      <Column field="version" header="Version" sortable>
        <template #body="{ data }">
          <MonoText :value="data.version" />
        </template>
      </Column>
    </DataTable>
  </main>
</template>
