<script setup lang="ts">
import Button from 'primevue/button';
import Column from 'primevue/column';
import DataTable from 'primevue/datatable';
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import BackLink from '@/components/common/BackLink.vue';
import MonoText from '@/components/common/MonoText.vue';
import NotFoundState from '@/components/common/NotFoundState.vue';
import { get } from '@/lib/api/client';
import { ApiResponseError } from '@/lib/api/errors';
import type { Invoice } from '@/lib/api/types';
import { formatMoney } from '@/lib/money';

const route = useRoute();
const router = useRouter();
const invoice = ref<Invoice | null>(null);
const isLoading = ref(true);
const isNotFound = ref(false);
const errorMessage = ref<string | null>(null);
const invoiceId = computed(() => String(route.params.id));
const jobOrderBackLink = computed(() => invoice.value ? `/job-orders/${invoice.value.jobOrderId}` : '/job-orders');

function money(amountMinor: number, currency: string): string {
  return formatMoney({ amountMinor, currency });
}

onMounted(async () => {
  isLoading.value = true;
  try {
    invoice.value = await get<Invoice>(`/invoices/${invoiceId.value}`);
  } catch (error) {
    if (error instanceof ApiResponseError && error.code === 'NOT_FOUND') {
      isNotFound.value = true;
      return;
    }
    errorMessage.value = error instanceof ApiResponseError ? error.message : 'Unable to load invoice.';
  } finally {
    isLoading.value = false;
  }
});
</script>

<template>
  <NotFoundState v-if="isNotFound" />

  <main v-else class="office-route crm-page" aria-labelledby="invoice-title">
    <p v-if="isLoading" class="crm-empty">Loading invoice...</p>
    <p v-else-if="errorMessage" class="auth-message auth-message--error" role="alert">{{ errorMessage }}</p>

    <div v-else-if="invoice" class="record-form-card">
      <header class="crm-page__header">
        <div>
          <BackLink :to="jobOrderBackLink" label="Job order" />
          <p class="crm-page__eyebrow">Invoice draft</p>
          <h1 id="invoice-title" class="crm-page__title">
            <MonoText :value="invoice.invoiceNumber" />
          </h1>
          <p class="record-form__version">Prefilled from completed job execution data.</p>
        </div>
        <span class="jo-chip mx-jo-draft">{{ invoice.status }}</span>
      </header>

      <section class="crm-section" aria-labelledby="bill-to-title">
        <h2 id="bill-to-title" class="crm-section__title">Bill to</h2>
        <dl class="detail-grid">
          <div>
            <dt>Name</dt>
            <dd>{{ invoice.billToName }}</dd>
          </div>
          <div>
            <dt>Email</dt>
            <dd>{{ invoice.billToEmail ?? '—' }}</dd>
          </div>
          <div>
            <dt>Address</dt>
            <dd>{{ invoice.billToAddress ?? '—' }}</dd>
          </div>
        </dl>
      </section>

      <section class="crm-section" aria-labelledby="invoice-lines-title">
        <h2 id="invoice-lines-title" class="crm-section__title">Draft lines</h2>
        <DataTable :value="invoice.lines ?? []" data-key="id" size="small" striped-rows class="crm-table">
          <Column field="kind" header="Type" />
          <Column field="description" header="Description" />
          <Column field="quantity" header="Qty">
            <template #body="{ data }">{{ Number(data.quantity) }} {{ data.unit ?? '' }}</template>
          </Column>
          <Column field="unitPriceAmountMinor" header="Unit price">
            <template #body="{ data }">{{ money(data.unitPriceAmountMinor, data.unitPriceCurrency) }}</template>
          </Column>
          <Column field="lineTotalAmountMinor" header="Total">
            <template #body="{ data }"><span class="mx-money">{{ money(data.lineTotalAmountMinor, data.lineTotalCurrency) }}</span></template>
          </Column>
        </DataTable>
      </section>

      <section class="crm-section" aria-labelledby="invoice-total-title">
        <h2 id="invoice-total-title" class="crm-section__title">Totals</h2>
        <dl class="detail-grid">
          <div>
            <dt>GST</dt>
            <dd>{{ invoice.gstAmountMinor == null ? '—' : money(invoice.gstAmountMinor, invoice.gstCurrency ?? invoice.totalCurrency) }}</dd>
          </div>
          <div>
            <dt>Total</dt>
            <dd><span class="mx-money">{{ money(invoice.totalAmountMinor, invoice.totalCurrency) }}</span></dd>
          </div>
        </dl>
      </section>

      <div class="record-form__actions">
        <Button label="Back to job order" severity="secondary" @click="router.push(jobOrderBackLink)" />
      </div>
    </div>
  </main>
</template>
