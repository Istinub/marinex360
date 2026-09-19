<script setup lang="ts">
import Button from 'primevue/button';
import Column from 'primevue/column';
import DataTable from 'primevue/datatable';
import InputText from 'primevue/inputtext';
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { ApiResponseError } from '@/lib/api/errors';
import type { Vendor } from '@/lib/api/types';
import { useVendorsStore } from '@/stores/vendors';

const router = useRouter();
const vendorsStore = useVendorsStore();
const search = ref('');
const errorMessage = ref<string | null>(null);

const filteredVendors = computed(() => {
  const query = search.value.trim().toLowerCase();
  if (!query) return vendorsStore.sortedVendors;

  return vendorsStore.sortedVendors.filter((vendor) => vendor.name.toLowerCase().includes(query));
});

async function loadVendors(): Promise<void> {
  errorMessage.value = null;
  try {
    await vendorsStore.loadVendors();
  } catch (error) {
    errorMessage.value = error instanceof ApiResponseError ? error.message : 'Unable to load vendors.';
  }
}

function openVendor(vendor: Vendor): void {
  void router.push(`/vendors/${vendor.id}`);
}

onMounted(loadVendors);
</script>

<template>
  <main class="office-route crm-page" aria-labelledby="vendors-title">
    <div class="record-list-card">
      <header class="crm-page__header">
        <div>
          <p class="crm-page__eyebrow">CRM</p>
          <h1 id="vendors-title" class="crm-page__title">Vendors</h1>
        </div>

        <Button label="New vendor" icon="pi pi-plus" @click="router.push('/vendors/new')" />
      </header>

      <section class="crm-toolbar" aria-label="Vendor tools">
        <label class="crm-filter crm-toolbar__search" for="vendor-search">
          <span>Search</span>
          <InputText id="vendor-search" v-model="search" class="auth-input" placeholder="Search vendors" />
        </label>
      </section>

      <div v-if="errorMessage" class="record-form__actions record-form__actions--left" role="alert">
        <p class="auth-message auth-message--error">
          {{ errorMessage }}
        </p>
        <Button label="Retry" icon="pi pi-refresh" severity="secondary" :loading="vendorsStore.isLoading" @click="loadVendors" />
      </div>

      <DataTable
        :value="filteredVendors"
        :loading="vendorsStore.isLoading"
        data-key="id"
        size="small"
        striped-rows
        removable-sort
        class="crm-table"
        @row-click="openVendor($event.data)"
      >
        <template #empty>
          <div class="crm-empty">{{ search.trim() ? 'No vendors match your search.' : 'No vendors yet.' }}</div>
        </template>

        <Column field="name" header="Name" sortable />
        <Column field="branch" header="Branch" sortable />
        <Column field="email" header="Email" sortable>
          <template #body="{ data }">{{ data.email ?? '—' }}</template>
        </Column>
        <Column field="phone" header="Phone" sortable>
          <template #body="{ data }">{{ data.phone ?? '—' }}</template>
        </Column>
        <Column field="address" header="Address" sortable>
          <template #body="{ data }">
            <span class="vendors-list__address" :title="data.address ?? '—'">{{ data.address ?? '—' }}</span>
          </template>
        </Column>
      </DataTable>
    </div>
  </main>
</template>

<style scoped>
.vendors-list__address {
  display: block;
  max-width: 24rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
