<script setup lang="ts">
import Button from 'primevue/button';
import Column from 'primevue/column';
import DataTable from 'primevue/datatable';
import { onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import BackLink from '@/components/common/BackLink.vue';
import MonoText from '@/components/common/MonoText.vue';
import NotFoundState from '@/components/common/NotFoundState.vue';
import { ApiResponseError } from '@/lib/api/errors';
import type { ClientDetail } from '@/lib/api/types';
import { useClientsStore } from '@/stores/clients';

const route = useRoute();
const router = useRouter();
const clientsStore = useClientsStore();

const client = ref<ClientDetail | null>(null);
const isLoading = ref(true);
const isNotFound = ref(false);
const errorMessage = ref<string | null>(null);

onMounted(async () => {
  try {
    client.value = await clientsStore.loadClient(String(route.params.id));
  } catch (error) {
    if (error instanceof ApiResponseError && error.code === 'NOT_FOUND') {
      isNotFound.value = true;
      return;
    }
    errorMessage.value = error instanceof ApiResponseError ? error.message : 'Unable to load client.';
  } finally {
    isLoading.value = false;
  }
});
</script>

<template>
  <NotFoundState v-if="isNotFound" />

  <main v-else class="office-route crm-page" aria-labelledby="client-title">
    <p v-if="isLoading" class="crm-empty">Loading client...</p>
    <p v-else-if="errorMessage" class="auth-message auth-message--error" role="alert">
      {{ errorMessage }}
    </p>

    <template v-else-if="client">
      <header class="crm-page__header">
        <div>
          <BackLink to="/clients" label="Clients" />
          <h1 id="client-title" class="crm-page__title">{{ client.name }}</h1>
        </div>

        <Button label="Edit" icon="pi pi-pencil" @click="router.push(`/clients/${client.id}/edit`)" />
      </header>

      <dl class="detail-grid">
        <div>
          <dt>ID</dt>
          <dd><MonoText :value="client.id" /></dd>
        </div>
        <div>
          <dt>Status</dt>
          <dd>{{ client.status }}</dd>
        </div>
        <div>
          <dt>Address</dt>
          <dd>{{ client.address ?? '—' }}</dd>
        </div>
        <div>
          <dt>Credit terms</dt>
          <dd>{{ client.creditTerms ?? '—' }}</dd>
        </div>
        <div>
          <dt>Primary contact</dt>
          <dd>
            <template v-if="client.primaryContact">
              {{ client.primaryContact.name }}
              <Button
                text
                size="small"
                label="Edit"
                @click="router.push(`/contacts/${client.primaryContact.id}/edit`)"
              />
            </template>
            <template v-else>—</template>
          </dd>
        </div>
        <div>
          <dt>Version</dt>
          <dd><MonoText :value="client.version" /></dd>
        </div>
      </dl>

      <section class="crm-section" aria-labelledby="client-vessels-title">
        <h2 id="client-vessels-title" class="crm-section__title">Vessels</h2>

        <DataTable :value="client.vessels" data-key="id" size="small" striped-rows class="crm-table">
          <template #empty>
            <div class="crm-empty">No vessels linked.</div>
          </template>

          <Column field="name" header="Vessel" sortable />
          <Column field="imoNumber" header="IMO" sortable>
            <template #body="{ data }">
              <MonoText :value="data.imoNumber" />
            </template>
          </Column>
          <Column field="type" header="Type" sortable>
            <template #body="{ data }">{{ data.type ?? '—' }}</template>
          </Column>
          <Column field="flag" header="Flag" sortable>
            <template #body="{ data }">{{ data.flag ?? '—' }}</template>
          </Column>
          <Column field="classification" header="Class" sortable>
            <template #body="{ data }">{{ data.classification ?? '—' }}</template>
          </Column>
        </DataTable>
      </section>
    </template>
  </main>
</template>
