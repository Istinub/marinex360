<script setup lang="ts">
import Button from 'primevue/button';
import { onMounted, reactive, ref } from 'vue';
import { get, post } from '@/lib/api/client';

interface Job { id: string; joNumber: string; state: string; scopeSummary: string; }
interface Invoice { id: string; invoiceNumber: string; status: string; totalAmountMinor: number; totalCurrency: string; }
const jobs = ref<Job[]>([]);
const invoices = ref<Invoice[]>([]);
const errorMessage = ref<string | null>(null);
const submitted = ref(false);
const form = reactive({ vesselDescription: '', scopeSummary: '', requestedDate: '' });

async function load(): Promise<void> {
  try {
    [jobs.value, invoices.value] = await Promise.all([get<Job[]>('/job-orders'), get<Invoice[]>('/invoices')]);
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : 'Unable to load your dashboard.';
  }
}
async function submitRequest(): Promise<void> {
  await post('/job-requests', { ...form, requestedDate: form.requestedDate || undefined });
  submitted.value = true;
  form.vesselDescription = '';
  form.scopeSummary = '';
  form.requestedDate = '';
}
onMounted(load);
</script>

<template>
  <main class="office-route crm-page" aria-labelledby="client-dashboard-title">
    <header class="crm-page__header"><div><p class="crm-page__eyebrow">Client portal</p><h1 id="client-dashboard-title" class="crm-page__title">Your dashboard</h1></div></header>
    <p v-if="errorMessage" class="auth-message auth-message--error" role="alert">{{ errorMessage }}</p>
    <section class="dashboard-grid" aria-label="Your jobs and invoices">
      <section class="dashboard-panel" aria-labelledby="client-jobs-title"><h2 id="client-jobs-title" class="crm-section__title">Your jobs</h2><div v-if="jobs.length"><p v-for="job in jobs" :key="job.id">{{ job.joNumber }} · {{ job.state }} · {{ job.scopeSummary }}</p></div><p v-else class="crm-empty">No jobs yet.</p></section>
      <section class="dashboard-panel" aria-labelledby="client-invoices-title"><h2 id="client-invoices-title" class="crm-section__title">Your invoices</h2><div v-if="invoices.length"><p v-for="invoice in invoices" :key="invoice.id">{{ invoice.invoiceNumber }} · {{ invoice.status }} · {{ invoice.totalAmountMinor }} {{ invoice.totalCurrency }}</p></div><p v-else class="crm-empty">No invoices yet.</p></section>
    </section>
    <section class="dashboard-panel" aria-labelledby="request-title"><h2 id="request-title" class="crm-section__title">Request a service</h2><p v-if="submitted" role="status">Request received. TKMR will contact you.</p><form v-else class="record-form" @submit.prevent="submitRequest"><label class="auth-field">Vessel description<input v-model="form.vesselDescription" class="auth-input" required /></label><label class="auth-field">Scope summary<textarea v-model="form.scopeSummary" class="auth-input record-form__textarea" required /></label><label class="auth-field">Requested date<input v-model="form.requestedDate" class="auth-input" type="date" /></label><Button type="submit" label="Submit request" icon="pi pi-send" /></form></section>
  </main>
</template>
