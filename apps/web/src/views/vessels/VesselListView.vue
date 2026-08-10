<script setup lang="ts">
import Button from 'primevue/button';
import Column from 'primevue/column';
import DataTable from 'primevue/datatable';
import InputText from 'primevue/inputtext';
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import MonoText from '@/components/common/MonoText.vue';
import { ApiResponseError } from '@/lib/api/errors';
import type { Vessel } from '@/lib/api/types';
import { useVesselsStore } from '@/stores/vessels';

const router = useRouter();
const vesselsStore = useVesselsStore();
const search = ref('');
const errorMessage = ref<string | null>(null);

const filteredVessels = computed(() => {
  const query = search.value.trim().toLowerCase();
  if (!query) return vesselsStore.sortedVessels;

  return vesselsStore.sortedVessels.filter((vessel) =>
    [vessel.imoNumber, vessel.name, vessel.type, vessel.flag, vessel.classification, vessel.clientId]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(query)),
  );
});

async function loadVessels(): Promise<void> {
  errorMessage.value = null;
  try {
    await vesselsStore.list();
  } catch (error) {
    errorMessage.value = error instanceof ApiResponseError ? error.message : 'Unable to load vessels.';
  }
}

onMounted(loadVessels);

function openServiceHistory(vessel: Vessel): void {
  void router.push(`/vessels/${vessel.id}/job-orders`);
}
</script>

<template>
  <main class="office-route crm-page" aria-labelledby="vessels-title">
    <header class="crm-page__header">
      <div>
        <p class="crm-page__eyebrow">CRM</p>
        <h1 id="vessels-title" class="crm-page__title">Vessels</h1>
      </div>

      <Button label="New vessel" icon="pi pi-plus" @click="router.push('/vessels/new')" />
    </header>

    <section class="crm-toolbar" aria-label="Vessel tools">
      <span class="p-input-icon-left crm-toolbar__search">
        <i class="pi pi-search" aria-hidden="true" />
        <InputText v-model="search" placeholder="Search vessels" />
      </span>
    </section>

    <div v-if="errorMessage" class="record-form__actions record-form__actions--left" role="alert">
      <p class="auth-message auth-message--error">
        {{ errorMessage }}
      </p>
      <Button label="Retry" icon="pi pi-refresh" severity="secondary" :loading="vesselsStore.isLoading" @click="loadVessels" />
    </div>

    <DataTable
      :value="filteredVessels"
      :loading="vesselsStore.isLoading"
      data-key="id"
      size="small"
      striped-rows
      removable-sort
      class="crm-table"
    >
      <template #empty>
        <div class="crm-empty">No vessels found.</div>
      </template>

      <Column field="imoNumber" header="IMO" sortable>
        <template #body="{ data }">
          <MonoText :value="data.imoNumber" />
        </template>
      </Column>
      <Column field="name" header="Name" sortable />
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
      <Column field="classification" header="Classification" sortable>
        <template #body="{ data }">
          {{ data.classification ?? '—' }}
        </template>
      </Column>
      <Column header="History">
        <template #body="{ data }">
          <Button
            label="Service history"
            icon="pi pi-history"
            severity="secondary"
            size="small"
            @click="openServiceHistory(data)"
          />
        </template>
      </Column>
    </DataTable>
  </main>
</template>
