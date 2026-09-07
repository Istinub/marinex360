<script setup lang="ts">
import Button from 'primevue/button';
import Column from 'primevue/column';
import DataTable from 'primevue/datatable';
import InputText from 'primevue/inputtext';
import { computed, onMounted, ref } from 'vue';
import { RouterLink, useRouter } from 'vue-router';
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

  return clientsStore.sortedClients.filter((client) => client.name.toLowerCase().includes(query));
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
    <div class="record-list-card">
      <header class="crm-page__header">
        <div>
          <p class="crm-page__eyebrow">CRM</p>
          <h1 id="clients-title" class="crm-page__title">Clients</h1>
        </div>

        <Button label="New client" icon="pi pi-plus" @click="router.push('/clients/new')" />
      </header>

      <section class="crm-toolbar" aria-label="Client tools">
        <label class="crm-filter crm-toolbar__search" for="client-search">
          <span>Search</span>
          <InputText id="client-search" v-model="search" class="auth-input" placeholder="Search clients" />
        </label>
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
          <div class="crm-empty">{{ search.trim() ? 'No clients match your search.' : 'No clients yet.' }}</div>
        </template>

        <Column field="name" header="Name" sortable />
        <Column field="status" header="Status" sortable>
          <template #body="{ data }">
            <span class="clients-list__status">{{ data.status }}</span>
          </template>
        </Column>
        <Column field="address" header="Address" sortable>
          <template #body="{ data }">
            <span class="clients-list__address" :title="data.address ?? '—'">{{ data.address ?? '—' }}</span>
          </template>
        </Column>
        <Column field="creditTerms" header="Credit terms" sortable>
          <template #body="{ data }">
            {{ data.creditTerms ?? '—' }}
          </template>
        </Column>
        <Column header="" body-class="clients-list__action-cell">
          <template #body="{ data }">
            <RouterLink
              class="clients-list__icon-link"
              :to="`/vessels?clientId=${encodeURIComponent(data.id)}`"
              aria-label="View client vessels"
              @click.stop
            >
              <span class="pi pi-compass" aria-hidden="true" />
            </RouterLink>
          </template>
        </Column>
      </DataTable>
    </div>
  </main>
</template>

<style scoped>
.clients-list__status {
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  border-radius: 999px;
  background: #ECEFF2;
  color: #44525E;
  font-size: 10px;
  font-weight: 500;
  line-height: var(--lh-tight);
}

.clients-list__address {
  display: block;
  max-width: 24rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.clients-list__icon-link {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 6px;
  color: var(--color-brand);
  text-decoration: none;
}

.clients-list__icon-link:hover {
  background: #F4F7FA;
}

.clients-list__action-cell {
  text-align: right;
}
</style>
