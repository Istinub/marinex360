<script setup lang="ts">
import Button from 'primevue/button';
import Message from 'primevue/message';
import ProgressSpinner from 'primevue/progressspinner';
import { computed, onMounted, ref } from 'vue';
import { RouterLink, useRoute, useRouter } from 'vue-router';
import MobileBackLink from '@/components/MobileBackLink.vue';
import { loadLiveJobOrder, transitionJobOrder, type MobileJobOrder } from '@/composables/useJobOrders';
import { useExecutionSummary } from '@/composables/useExecutionSummary';

const route = useRoute();
const router = useRouter();

const jobOrderId = computed(() => {
  const id = route.params.id;
  return (Array.isArray(id) ? id[0] : id) ?? '';
});
const isReport = computed(() => route.name === 'job-completion-report');
const {
  summary,
  isLoading: isSummaryLoading,
  errorMessage: summaryErrorMessage,
  hasContent,
  load: loadSummary,
} = useExecutionSummary(() => jobOrderId.value);
const jobOrder = ref<MobileJobOrder | null>(null);
const isSubmitting = ref(false);
const showConfirm = ref(false);
const showSuccess = ref(false);
const errorMessage = ref<string | null>(null);

function money(amountMinor: number, currency: string): string {
  return `${currency} ${(amountMinor / 100).toFixed(2)}`;
}

function resultText(value: unknown): string {
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `${String(record.itemId ?? 'Item')}: ${String(record.na ? 'N/A' : record.value ?? 'No value')}`;
  }
  return String(value ?? 'No value');
}

async function load(): Promise<void> {
  errorMessage.value = null;
  try {
    const [job] = await Promise.all([
      loadLiveJobOrder(jobOrderId.value),
      loadSummary(),
    ]);
    jobOrder.value = job;
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : 'Unable to load completion summary.';
  }
}

async function submitForReview(): Promise<void> {
  if (!jobOrder.value) return;

  isSubmitting.value = true;
  errorMessage.value = null;
  try {
    await transitionJobOrder(jobOrder.value, 'PENDING_REVIEW');
    showConfirm.value = false;
    showSuccess.value = true;
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : 'Unable to submit for review.';
  } finally {
    isSubmitting.value = false;
  }
}

async function openReport(): Promise<void> {
  showSuccess.value = false;
  await router.push(`/jobs/${jobOrderId.value}/completion-report`);
}

onMounted(() => {
  void load();
});
</script>

<template>
  <main class="execution-summary" aria-labelledby="execution-summary-title">
    <header class="execution-summary__header">
      <MobileBackLink :to="`/jobs/${jobOrderId}`" label="Return" />
      <p class="execution-summary__eyebrow">{{ isReport ? 'Completion report' : 'Completion preview' }}</p>
      <h1 id="execution-summary-title" class="execution-summary__title">
        {{ isReport ? 'Submitted execution summary' : 'Review before submitting' }}
      </h1>
    </header>

    <div v-if="isSummaryLoading" class="execution-summary__loading" aria-live="polite">
      <ProgressSpinner class="execution-summary__spinner" stroke-width="4" />
    </div>

    <Message v-if="errorMessage || summaryErrorMessage" severity="error" :closable="false">
      {{ errorMessage ?? summaryErrorMessage }}
    </Message>

    <Message v-if="!hasContent && !isSummaryLoading" severity="info" :closable="false">
      No execution data has been captured for this job yet.
    </Message>

    <div v-if="summary" class="execution-summary__sections">
      <section class="execution-summary__section">
        <header class="execution-summary__section-header">
          <h2>Checklist</h2>
          <RouterLink v-if="!isReport" :to="`/jobs/${jobOrderId}/checklist`">Edit</RouterLink>
        </header>
        <p v-if="summary.checklists.length === 0" class="execution-summary__empty">No checklist responses.</p>
        <article v-for="checklist in summary.checklists" :key="checklist.id" class="execution-summary__item">
          <strong>{{ checklist.templateId }}</strong>
          <span>{{ checklist.completedAt ?? 'Pending time' }} · {{ checklist.syncState }}</span>
          <ul>
            <li v-for="(result, index) in checklist.results" :key="index">{{ resultText(result) }}</li>
          </ul>
        </article>
      </section>

      <section class="execution-summary__section">
        <header class="execution-summary__section-header">
          <h2>Observations</h2>
          <RouterLink v-if="!isReport" :to="`/jobs/${jobOrderId}/observations`">Edit</RouterLink>
        </header>
        <p v-if="summary.observations.length === 0" class="execution-summary__empty">No observations.</p>
        <article v-for="observation in summary.observations" :key="observation.id" class="execution-summary__item">
          <strong>{{ observation.createdAt }}</strong>
          <span>{{ observation.syncState }}</span>
          <p>{{ observation.body }}</p>
        </article>
      </section>

      <section class="execution-summary__section">
        <header class="execution-summary__section-header">
          <h2>Materials</h2>
          <RouterLink v-if="!isReport" :to="`/jobs/${jobOrderId}/materials`">Edit</RouterLink>
        </header>
        <p v-if="summary.materials.length === 0" class="execution-summary__empty">No materials.</p>
        <article v-for="material in summary.materials" :key="material.id" class="execution-summary__item">
          <strong>{{ material.description }}</strong>
          <span>{{ material.quantity }} {{ material.unit }} · {{ money(material.unitCostAmountMinor, material.unitCostCurrency) }} · {{ material.syncState }}</span>
        </article>
      </section>

      <section class="execution-summary__section">
        <header class="execution-summary__section-header">
          <h2>Photos</h2>
          <RouterLink v-if="!isReport" :to="`/jobs/${jobOrderId}/checklist`">Edit</RouterLink>
        </header>
        <p v-if="summary.photos.length === 0" class="execution-summary__empty">No photos.</p>
        <article v-for="photo in summary.photos" :key="photo.id" class="execution-summary__item">
          <strong>{{ photo.phase }}</strong>
          <span>{{ photo.takenAt }} · {{ photo.syncState }}</span>
          <small>{{ photo.localPath ?? photo.s3Key ?? 'Queued image' }}</small>
        </article>
      </section>

      <section class="execution-summary__section">
        <header class="execution-summary__section-header">
          <h2>Signature</h2>
          <RouterLink v-if="!isReport" :to="`/jobs/${jobOrderId}/sign`">Edit</RouterLink>
        </header>
        <p v-if="summary.signatures.length === 0" class="execution-summary__empty">No signature.</p>
        <article v-for="signature in summary.signatures" :key="signature.id" class="execution-summary__item">
          <strong>{{ signature.signerName ?? 'Signer pending' }}</strong>
          <span>{{ signature.signerRole ?? 'Role pending' }} · {{ signature.signedAt ?? 'Pending time' }} · {{ signature.syncState }}</span>
          <small v-if="signature.documentHash">{{ signature.documentHash }}</small>
        </article>
      </section>
    </div>

    <div v-if="!isReport" class="execution-summary__actions">
      <Button label="Submit for review" icon="pi pi-send" :loading="isSubmitting" @click="showConfirm = true" />
    </div>

    <div v-if="showConfirm" class="execution-summary__dialog" role="presentation">
      <section class="execution-summary__dialog-card" role="dialog" aria-modal="true" aria-labelledby="submit-confirm-title">
        <h2 id="submit-confirm-title">Submit for review?</h2>
        <p>Are you sure? This cannot be undone once submitted</p>
        <div class="execution-summary__dialog-actions">
          <Button label="No" severity="secondary" @click="showConfirm = false" />
          <Button label="Yes" :loading="isSubmitting" @click="submitForReview" />
        </div>
      </section>
    </div>

    <div v-if="showSuccess" class="execution-summary__dialog" role="presentation">
      <section class="execution-summary__dialog-card" role="dialog" aria-modal="true" aria-labelledby="submit-success-title">
        <h2 id="submit-success-title">Submitted successfully</h2>
        <div class="execution-summary__dialog-actions">
          <Button label="View report" @click="openReport" />
        </div>
      </section>
    </div>
  </main>
</template>

<style scoped>
.execution-summary {
  min-height: 100%;
  padding: var(--sp-4);
  background: var(--color-canvas);
  color: var(--color-text);
  font-family: var(--font-ui);
}

.execution-summary__header,
.execution-summary__sections,
.execution-summary__section,
.execution-summary__item {
  display: grid;
  gap: var(--sp-3);
}

.execution-summary__header {
  margin-bottom: var(--sp-4);
}

.execution-summary__eyebrow {
  margin: 0;
  color: var(--color-text-muted);
  font-size: var(--fs-body-sm);
  font-weight: var(--fw-semibold);
}

.execution-summary__title {
  margin: 0;
  font-size: var(--fs-h1);
  font-weight: var(--fw-semibold);
  line-height: var(--lh-tight);
}

.execution-summary__loading {
  display: grid;
  min-height: var(--tap-field);
  place-items: center;
  padding: var(--sp-8);
}

.execution-summary__spinner {
  width: var(--tap-min);
  height: var(--tap-min);
}

.execution-summary__section {
  padding: var(--sp-4);
  border: var(--border-1);
  border-radius: var(--radius-md);
  background: var(--color-surface);
}

.execution-summary__section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--sp-3);
}

.execution-summary__section-header h2 {
  margin: 0;
  font-size: var(--fs-h3);
}

.execution-summary__section-header a {
  color: var(--color-brand);
  font-weight: var(--fw-semibold);
  text-decoration: none;
}

.execution-summary__item {
  padding-top: var(--sp-3);
  border-top: var(--border-1);
}

.execution-summary__item span,
.execution-summary__item small,
.execution-summary__empty {
  color: var(--color-text-muted);
  font-size: var(--fs-body-sm);
}

.execution-summary__item p,
.execution-summary__item ul,
.execution-summary__empty {
  margin: 0;
}

.execution-summary__actions {
  position: sticky;
  bottom: 0;
  display: grid;
  padding: var(--sp-4) 0 0;
  background: var(--color-canvas);
}

.execution-summary__actions :deep(.p-button),
.execution-summary__dialog-actions :deep(.p-button) {
  min-height: var(--tap-field);
}

.execution-summary__dialog {
  position: fixed;
  inset: 0;
  z-index: 20;
  display: grid;
  place-items: center;
  padding: var(--sp-4);
  background: rgba(7, 34, 61, 0.32);
}

.execution-summary__dialog-card {
  width: min(100%, 420px);
  display: grid;
  gap: var(--sp-4);
  padding: var(--sp-4);
  border-radius: var(--radius-md);
  background: var(--color-surface);
  box-shadow: var(--elev-overlay);
}

.execution-summary__dialog-card h2,
.execution-summary__dialog-card p {
  margin: 0;
}

.execution-summary__dialog-actions {
  display: grid;
  gap: var(--sp-2);
}

@media (min-width: 720px) {
  .execution-summary {
    padding: var(--sp-6);
  }

  .execution-summary__dialog-actions {
    grid-template-columns: repeat(2, minmax(0, max-content));
    justify-content: end;
  }
}
</style>
