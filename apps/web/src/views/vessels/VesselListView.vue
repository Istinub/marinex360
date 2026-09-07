<script setup lang="ts">
import Button from 'primevue/button';
import Column from 'primevue/column';
import DataTable from 'primevue/datatable';
import InputText from 'primevue/inputtext';
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import MonoText from '@/components/common/MonoText.vue';
import { ApiResponseError } from '@/lib/api/errors';
import type { Vessel } from '@/lib/api/types';
import { useClientsStore } from '@/stores/clients';
import { useVesselsStore } from '@/stores/vessels';

const route = useRoute();
const router = useRouter();
const clientsStore = useClientsStore();
const vesselsStore = useVesselsStore();
const search = ref('');
const selectedClientId = ref(typeof route.query.clientId === 'string' ? route.query.clientId : '');
const errorMessage = ref<string | null>(null);
const clientNameById = computed(() => new Map(clientsStore.clients.map((client) => [client.id, client.name])));

const filteredVessels = computed(() => {
  const query = search.value.trim().toLowerCase();
  if (!query) return vesselsStore.sortedVessels;

  return vesselsStore.sortedVessels.filter((vessel) => vessel.name.toLowerCase().includes(query));
});

async function loadVessels(): Promise<void> {
  errorMessage.value = null;
  try {
    await vesselsStore.list(selectedClientId.value || undefined);
  } catch (error) {
    errorMessage.value = error instanceof ApiResponseError ? error.message : 'Unable to load vessels.';
  }
}

async function loadPage(): Promise<void> {
  errorMessage.value = null;
  try {
    await Promise.all([
      clientsStore.clients.length ? Promise.resolve(clientsStore.clients) : clientsStore.loadClients(),
      vesselsStore.list(selectedClientId.value || undefined),
    ]);
  } catch (error) {
    errorMessage.value = error instanceof ApiResponseError ? error.message : 'Unable to load vessels.';
  }
}

function clientLabel(vessel: Vessel): string {
  return clientNameById.value.get(vessel.clientId) ?? vessel.clientId;
}

watch(selectedClientId, (clientId) => {
  void router.replace({ path: '/vessels', query: clientId ? { clientId } : {} });
  void loadVessels();
});

onMounted(loadPage);

function openServiceHistory(vessel: Vessel): void {
  void router.push(`/vessels/${vessel.id}/job-orders`);
}
</script>

<template>
  <main class="office-route crm-page" aria-labelledby="vessels-title">
    <div class="record-list-card">
      <header class="crm-page__header">
        <div>
          <p class="crm-page__eyebrow">CRM</p>
          <h1 id="vessels-title" class="crm-page__title">Vessels</h1>
        </div>

        <Button label="New vessel" icon="pi pi-plus" @click="router.push('/vessels/new')" />
      </header>

      <section class="crm-toolbar" aria-label="Vessel tools">
        <label class="crm-filter crm-toolbar__search" for="vessel-search">
          <span>Search</span>
          <InputText id="vessel-search" v-model="search" class="auth-input" placeholder="Search vessels" />
        </label>

        <label class="crm-filter" for="vessel-client-filter">
          <span>Filter by client</span>
          <select id="vessel-client-filter" v-model="selectedClientId" class="auth-input">
            <option value="">All clients</option>
            <option v-for="client in clientsStore.sortedClients" :key="client.id" :value="client.id">
              {{ client.name }}
            </option>
          </select>
        </label>
      </section>

      <div v-if="errorMessage" class="record-form__actions record-form__actions--left" role="alert">
        <p class="auth-message auth-message--error">
          {{ errorMessage }}
        </p>
        <Button label="Retry" icon="pi pi-refresh" severity="secondary" :loading="vesselsStore.isLoading" @click="loadPage" />
      </div>

      <DataTable
        :value="filteredVessels"
        :loading="vesselsStore.isLoading || clientsStore.isLoading"
        data-key="id"
        size="small"
        striped-rows
        removable-sort
        class="crm-table"
        @row-click="openServiceHistory($event.data)"
      >
        <template #empty>
          <div class="crm-empty">{{ search.trim() ? 'No vessels match your search.' : 'No vessels found.' }}</div>
        </template>

        <Column field="imoNumber" header="IMO number" sortable>
          <template #body="{ data }">
            <MonoText :value="data.imoNumber" />
          </template>
        </Column>
        <Column field="name" header="Name" sortable>
          <template #body="{ data }">
            <span class="vessels-list__name" :title="data.name">{{ data.name }}</span>
          </template>
        </Column>
        <Column field="clientId" header="Client" sortable>
          <template #body="{ data }">
            <span class="vessels-list__client" :title="clientLabel(data)">{{ clientLabel(data) }}</span>
          </template>
        </Column>
        <Column field="type" header="Type" sortable>
          <template #body="{ data }">
            {{ data.type ?? '—' }}
          </template>
        </Column>
        <Column field="flag" header="Flag" sortable>
          <template #body="{ data }">
            {{ data.flag ?? '—' }}
          </template>
        </Column>
      </DataTable>
    </div>
  </main>
</template>

<style scoped>
.vessels-list__name,
.vessels-list__client {
  display: block;
  max-width: 18rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
