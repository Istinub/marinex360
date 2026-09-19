<script setup lang="ts">
import Button from 'primevue/button';
import Column from 'primevue/column';
import DataTable from 'primevue/datatable';
import { computed, onMounted, ref } from 'vue';
import { RouterLink, useRoute, useRouter } from 'vue-router';
import BackLink from '@/components/common/BackLink.vue';
import MonoText from '@/components/common/MonoText.vue';
import NotFoundState from '@/components/common/NotFoundState.vue';
import { ApiResponseError } from '@/lib/api/errors';
import type { VendorDetail } from '@/lib/api/types';
import { useAuthStore } from '@/stores/auth';
import { useVendorsStore } from '@/stores/vendors';

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const vendorsStore = useVendorsStore();

const vendor = ref<VendorDetail | null>(null);
const isLoading = ref(true);
const isNotFound = ref(false);
const errorMessage = ref<string | null>(null);
const isAdmin = computed(() => auth.identity?.roles.includes('SYSTEM_ADMIN') ?? false);

function formatMoney(amountMinor: number, currency: string): string {
  return `${currency} ${new Intl.NumberFormat('en-SG', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amountMinor / 100)}`;
}

function formatDate(value?: string | null): string {
  if (!value) return '—';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(value));
}

function jobOrderLabel(row: { joNumber?: string | null; id: string }): string {
  return row.joNumber ?? row.id;
}

onMounted(async () => {
  try {
    vendor.value = await vendorsStore.loadVendor(String(route.params.id));
  } catch (error) {
    if (error instanceof ApiResponseError && error.code === 'NOT_FOUND') {
      isNotFound.value = true;
      return;
    }
    errorMessage.value = error instanceof ApiResponseError ? error.message : 'Unable to load vendor.';
  } finally {
    isLoading.value = false;
  }
});
</script>

<template>
  <NotFoundState v-if="isNotFound" />

  <main v-else class="office-route crm-page" aria-labelledby="vendor-title">
    <p v-if="isLoading" class="crm-empty">Loading vendor...</p>
    <p v-else-if="errorMessage" class="auth-message auth-message--error" role="alert">
      {{ errorMessage }}
    </p>

    <template v-else-if="vendor">
      <header class="crm-page__header">
        <div>
          <BackLink to="/vendors" label="Vendors" />
          <h1 id="vendor-title" class="crm-page__title">{{ vendor.name }}</h1>
        </div>

        <Button label="Edit" icon="pi pi-pencil" @click="router.push(`/vendors/${vendor.id}/edit`)" />
      </header>

      <dl class="detail-grid">
        <div>
          <dt>Branch</dt>
          <dd>{{ vendor.branch }}</dd>
        </div>
        <div>
          <dt>Email</dt>
          <dd>{{ vendor.email ?? '—' }}</dd>
        </div>
        <div>
          <dt>Phone</dt>
          <dd>{{ vendor.phone ?? '—' }}</dd>
        </div>
        <div>
          <dt>Address</dt>
          <dd>{{ vendor.address ?? '—' }}</dd>
        </div>
        <div>
          <dt>Version</dt>
          <dd><MonoText :value="vendor.version" /></dd>
        </div>
      </dl>

      <details v-if="isAdmin" class="technical-details">
        <summary>Technical details</summary>
        <dl class="detail-grid detail-grid--single">
          <div>
            <dt>Vendor ID</dt>
            <dd><MonoText :value="vendor.id" /></dd>
          </div>
        </dl>
      </details>

      <section class="crm-section" aria-labelledby="vendor-job-orders-title">
        <h2 id="vendor-job-orders-title" class="crm-section__title">Tagged job orders</h2>

        <DataTable :value="vendor.jobOrders" data-key="id" size="small" striped-rows class="crm-table">
          <template #empty>
            <div class="crm-empty">No job orders tagged with this vendor.</div>
          </template>

          <Column field="joNumber" header="Job order" sortable>
            <template #body="{ data }">
              <RouterLink class="vendor-detail__link" :to="`/job-orders/${data.id}`">
                <MonoText :value="jobOrderLabel(data)" />
              </RouterLink>
            </template>
          </Column>
          <Column field="state" header="State" sortable />
          <Column field="scopeSummary" header="Scope" sortable>
            <template #body="{ data }">
              <span class="vendor-detail__truncate" :title="data.scopeSummary">{{ data.scopeSummary }}</span>
            </template>
          </Column>
          <Column field="client.name" header="Client" sortable>
            <template #body="{ data }">{{ data.client?.name ?? '—' }}</template>
          </Column>
          <Column field="vessel.name" header="Vessel" sortable>
            <template #body="{ data }">{{ data.vessel?.name ?? '—' }}</template>
          </Column>
          <Column field="createdAt" header="Created" sortable>
            <template #body="{ data }">{{ formatDate(data.createdAt) }}</template>
          </Column>
        </DataTable>
      </section>

      <section class="crm-section" aria-labelledby="vendor-variations-title">
        <h2 id="vendor-variations-title" class="crm-section__title">Tagged variations</h2>

        <DataTable :value="vendor.variations" data-key="id" size="small" striped-rows class="crm-table">
          <template #empty>
            <div class="crm-empty">No variations tagged with this vendor.</div>
          </template>

          <Column field="jobOrder.joNumber" header="Job order" sortable>
            <template #body="{ data }">
              <RouterLink class="vendor-detail__link" :to="`/job-orders/${data.jobOrderId}`">
                <MonoText :value="data.jobOrder?.joNumber ?? data.jobOrderId" />
              </RouterLink>
            </template>
          </Column>
          <Column field="status" header="Status" sortable />
          <Column field="reason" header="Reason" sortable>
            <template #body="{ data }">
              <span class="vendor-detail__truncate" :title="data.reason">{{ data.reason }}</span>
            </template>
          </Column>
          <Column field="amountMinor" header="Amount" sortable>
            <template #body="{ data }">{{ formatMoney(data.amountMinor, data.amountCurrency) }}</template>
          </Column>
          <Column field="createdAt" header="Created" sortable>
            <template #body="{ data }">{{ formatDate(data.createdAt) }}</template>
          </Column>
        </DataTable>
      </section>
    </template>
  </main>
</template>

<style scoped>
.technical-details {
  margin-top: 16px;
  padding: 12px;
  border: 0.5px dashed #C2CCD4;
  border-radius: 8px;
  background: #F4F7FA;
  color: #5C7081;
}

.technical-details summary {
  cursor: pointer;
  font-size: 12px;
  font-weight: 600;
}

.technical-details .detail-grid {
  margin-top: 10px;
}

.vendor-detail__link {
  color: var(--color-brand);
  text-decoration: none;
}

.vendor-detail__link:hover {
  text-decoration: underline;
}

.vendor-detail__truncate {
  display: block;
  max-width: 24rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
