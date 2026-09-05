<script setup lang="ts">
import Button from 'primevue/button';
import Message from 'primevue/message';
import ProgressSpinner from 'primevue/progressspinner';
import Textarea from 'primevue/textarea';
import { computed, onMounted, ref } from 'vue';
import { RouterLink, useRoute, useRouter } from 'vue-router';
import MobileBackLink from '@/components/MobileBackLink.vue';
import { currentSessionSnapshot } from '@/composables/useAuth';
import {
  loadCachedJobOrder,
  loadLiveJobOrder,
  selfAssignJobOrder,
  transitionJobOrder,
  type JobState,
  type MobileJobOrder,
} from '@/composables/useJobOrders';

const route = useRoute();
const router = useRouter();

const jobOrderId = computed(() => {
  const id = route.params.id;
  return Array.isArray(id) ? id[0] : id;
});

const jobOrder = ref<MobileJobOrder | null>(null);
const jobNumber = ref('Job pending');
const vesselName = ref('No vessel on record');
const clientName = ref('No client on record');
const isLoading = ref(false);
const isSaving = ref(false);
const errorMessage = ref<string | null>(null);
const successMessage = ref<string | null>(null);
const pauseReason = ref('');
const pauseFieldError = ref<string | null>(null);
const showPauseDialog = ref(false);
const resumeReason = ref('');
const resumeFieldError = ref<string | null>(null);
const showResumeDialog = ref(false);

const currentUserId = computed(() => currentSessionSnapshot()?.userId ?? null);
const isExecutionOwner = computed(() => Boolean(jobOrder.value?.executionOwnerId && jobOrder.value.executionOwnerId === currentUserId.value));
const canStart = computed(() => jobOrder.value?.canStart === true && jobOrder.value.readOnly !== true);
const canPause = computed(() => jobOrder.value?.state === 'IN_PROGRESS' && jobOrder.value.readOnly !== true && isExecutionOwner.value);
const canComplete = computed(() => jobOrder.value?.state === 'IN_PROGRESS' && jobOrder.value.readOnly !== true && isExecutionOwner.value);
const canResume = computed(() => jobOrder.value?.canResume === true && jobOrder.value.readOnly !== true);
const showExecutionTabs = computed(() => jobOrder.value?.state === 'IN_PROGRESS' && jobOrder.value.readOnly !== true);
const categoryText = computed(() => {
  const categories = jobOrder.value?.serviceCategories ?? [];
  return categories.length > 0 ? categories.join(', ') : 'No category on record';
});
const scopeSummary = computed(() => jobOrder.value?.scopeSummary?.trim() || 'No description on record');

function applyJobOrder(nextJobOrder: MobileJobOrder): void {
  jobOrder.value = nextJobOrder;
  jobNumber.value = nextJobOrder.joNumber ?? nextJobOrder.id;
  vesselName.value = nextJobOrder.vessel?.name ?? nextJobOrder.vesselName ?? 'No vessel on record';
  clientName.value = nextJobOrder.client?.name ?? nextJobOrder.clientName ?? 'No client on record';
}

async function loadJob(): Promise<void> {
  const id = jobOrderId.value;
  if (!id) return;

  isLoading.value = true;
  errorMessage.value = null;
  successMessage.value = null;

  try {
    const cached = await loadCachedJobOrder(id);
    if (cached) applyJobOrder(cached);

    if (typeof navigator === 'undefined' || navigator.onLine) {
      applyJobOrder(await loadLiveJobOrder(id));
    } else if (!cached) {
      throw new Error('Job order is not available offline.');
    }
    if (jobOrder.value?.readOnly) await router.replace(`/jobs/${id}/completion-report`);
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : 'Unable to load job order.';
  } finally {
    isLoading.value = false;
  }
}

async function runTransition(to: JobState): Promise<void> {
  if (!jobOrder.value) return;

  isSaving.value = true;
  errorMessage.value = null;
  successMessage.value = null;

  try {
    const updated = await transitionJobOrder(jobOrder.value, to);
    applyJobOrder(updated);
    successMessage.value = to === 'IN_PROGRESS' ? 'Job started.' : 'Job submitted for review.';
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : 'Unable to update job status.';
  } finally {
    isSaving.value = false;
  }
}

async function startJob(): Promise<void> {
  if (!jobOrder.value) return;

  isSaving.value = true;
  errorMessage.value = null;
  successMessage.value = null;

  try {
    let startable = jobOrder.value;
    if (startable.isAvailable) {
      startable = await selfAssignJobOrder(startable);
      applyJobOrder(startable);
    }
    const updated = await transitionJobOrder(startable, 'IN_PROGRESS');
    applyJobOrder(updated);
    successMessage.value = 'Job started.';
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : 'Unable to start job.';
  } finally {
    isSaving.value = false;
  }
}

async function pauseJob(): Promise<void> {
  if (!jobOrder.value) return;
  pauseFieldError.value = null;
  if (!pauseReason.value.trim()) {
    pauseFieldError.value = 'Reason is required.';
    return;
  }

  isSaving.value = true;
  errorMessage.value = null;
  successMessage.value = null;

  try {
    const updated = await transitionJobOrder(jobOrder.value, 'ON_HOLD', pauseReason.value);
    applyJobOrder(updated);
    pauseReason.value = '';
    showPauseDialog.value = false;
    successMessage.value = 'Job paused.';
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : 'Unable to pause job.';
  } finally {
    isSaving.value = false;
  }
}

async function resumeJob(): Promise<void> {
  if (!jobOrder.value) return;
  resumeFieldError.value = null;
  if (!resumeReason.value.trim()) {
    resumeFieldError.value = 'Reason is required.';
    return;
  }

  isSaving.value = true;
  errorMessage.value = null;
  successMessage.value = null;

  try {
    const updated = await transitionJobOrder(jobOrder.value, 'IN_PROGRESS', resumeReason.value);
    applyJobOrder(updated);
    resumeReason.value = '';
    showResumeDialog.value = false;
    successMessage.value = 'Job resumed.';
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : 'Unable to resume job.';
  } finally {
    isSaving.value = false;
  }
}

const checklistPath = computed(() => `/jobs/${jobOrderId.value}/checklist`);
const materialsPath = computed(() => `/jobs/${jobOrderId.value}/materials`);
const documentsPath = computed(() => `/jobs/${jobOrderId.value}/documents`);
const signaturePath = computed(() => `/jobs/${jobOrderId.value}/sign`);
const observationsPath = computed(() => `/jobs/${jobOrderId.value}/observations`);
const completionPreviewPath = computed(() => `/jobs/${jobOrderId.value}/completion-preview`);

onMounted(() => {
  void loadJob();
});
</script>

<template>
  <main class="job-detail" aria-labelledby="job-detail-title">
    <header class="job-detail__header">
      <MobileBackLink to="/jobs" label="Assigned jobs" />
      <div class="job-detail__identity">
        <p class="job-detail__eyebrow">Job execution</p>
        <h1 id="job-detail-title" class="job-detail__title">{{ jobNumber }}</h1>
        <p class="job-detail__context">
          <span>{{ vesselName }}</span>
          <span aria-hidden="true">·</span>
          <span>{{ clientName }}</span>
        </p>
      </div>
    </header>

    <div v-if="isLoading" class="job-detail__loading" aria-live="polite">
      <ProgressSpinner class="job-detail__spinner" stroke-width="4" />
    </div>

    <Message v-if="errorMessage" class="job-detail__message" severity="error" :closable="false">
      {{ errorMessage }}
    </Message>

    <Message v-if="successMessage" class="job-detail__message" severity="success" :closable="false">
      {{ successMessage }}
    </Message>

    <section v-if="jobOrder" class="job-detail__status" aria-label="Job status">
      <div>
        <span class="job-detail__state">{{ jobOrder.state }}</span>
        <p class="job-detail__owner">
          Execution owner {{ isExecutionOwner ? 'matches this device session' : 'is assigned by the office' }}
        </p>
      </div>

      <div class="job-detail__actions">
        <Button
          v-if="canStart"
          label="Start job"
          icon="pi pi-play"
          :loading="isSaving"
          @click="startJob"
        />
        <Button
          v-if="canPause"
          label="Pause"
          icon="pi pi-pause"
          severity="secondary"
          :loading="isSaving"
          @click="showPauseDialog = true"
        />
        <Button
          v-if="canComplete"
          label="Complete"
          icon="pi pi-send"
          :loading="isSaving"
          @click="router.push(completionPreviewPath)"
        />
        <Button
          v-if="canResume"
          label="Resume"
          icon="pi pi-play"
          :loading="isSaving"
          @click="showResumeDialog = true"
        />
      </div>
    </section>

    <section v-if="jobOrder" class="job-detail__card" aria-label="Job details">
      <dl class="job-detail__facts">
        <div>
          <dt>Client</dt>
          <dd>{{ clientName }}</dd>
        </div>
        <div>
          <dt>Vessel</dt>
          <dd>{{ vesselName }}</dd>
        </div>
        <div>
          <dt>Category</dt>
          <dd>{{ categoryText }}</dd>
        </div>
        <div>
          <dt>Description</dt>
          <dd>{{ scopeSummary }}</dd>
        </div>
      </dl>
    </section>

    <nav v-if="showExecutionTabs" class="job-detail__tabs" aria-label="Job detail sections">
      <RouterLink class="job-detail__tab job-detail__tab--primary" :to="observationsPath">
        <i class="pi pi-align-left" aria-hidden="true" />
        Observation
      </RouterLink>
      <RouterLink class="job-detail__tab" :to="checklistPath">
        <i class="pi pi-check-square" aria-hidden="true" />
        Checklist
      </RouterLink>
      <RouterLink class="job-detail__tab" :to="materialsPath">
        <i class="pi pi-box" aria-hidden="true" />
        Materials
      </RouterLink>
      <RouterLink class="job-detail__tab" :to="documentsPath">
        <i class="pi pi-file" aria-hidden="true" />
        Documents
      </RouterLink>
      <RouterLink class="job-detail__tab" :to="signaturePath">
        <i class="pi pi-pencil" aria-hidden="true" />
        Sign
      </RouterLink>
    </nav>

    <div v-if="showPauseDialog" class="job-detail__dialog" role="presentation">
      <section class="job-detail__dialog-card" role="dialog" aria-modal="true" aria-labelledby="pause-title">
        <h2 id="pause-title">Pause job</h2>
        <label class="job-detail__field" for="pause-reason">
          <span>Reason</span>
          <Textarea id="pause-reason" v-model="pauseReason" rows="4" class="job-detail__input" auto-resize required />
          <small v-if="pauseFieldError" class="job-detail__error">{{ pauseFieldError }}</small>
        </label>
        <div class="job-detail__dialog-actions">
          <Button label="Cancel" severity="secondary" @click="showPauseDialog = false" />
          <Button label="Pause" :loading="isSaving" @click="pauseJob" />
        </div>
      </section>
    </div>

    <div v-if="showResumeDialog" class="job-detail__dialog" role="presentation">
      <section class="job-detail__dialog-card" role="dialog" aria-modal="true" aria-labelledby="resume-title">
        <h2 id="resume-title">Resume job</h2>
        <label class="job-detail__field" for="resume-reason">
          <span>Reason</span>
          <Textarea id="resume-reason" v-model="resumeReason" rows="4" class="job-detail__input" auto-resize required />
          <small v-if="resumeFieldError" class="job-detail__error">{{ resumeFieldError }}</small>
        </label>
        <div class="job-detail__dialog-actions">
          <Button label="Cancel" severity="secondary" @click="showResumeDialog = false" />
          <Button label="Resume" :loading="isSaving" @click="resumeJob" />
        </div>
      </section>
    </div>
  </main>
</template>

<style scoped>
.job-detail {
  min-height: 100%;
  padding: var(--sp-4) 0;
  background: var(--color-canvas);
  color: var(--color-text);
  font-family: var(--font-ui);
}

.job-detail__header {
  padding: 0 var(--sp-4) var(--sp-4);
  border-bottom: var(--border-1);
}

.job-detail__loading {
  display: grid;
  min-height: var(--tap-field);
  place-items: center;
  padding: var(--sp-6) var(--sp-4);
}

.job-detail__spinner {
  width: var(--tap-min);
  height: var(--tap-min);
}

.job-detail__message {
  margin: var(--sp-4);
}

.job-detail__status {
  display: grid;
  gap: var(--sp-3);
  padding: var(--sp-4);
  border-bottom: var(--border-1);
  background: var(--color-surface);
}

.job-detail__state {
  display: inline-flex;
  align-items: center;
  min-height: var(--tap-min);
  padding: var(--sp-2) var(--sp-3);
  border-radius: var(--radius-pill);
  background: var(--color-field-action);
  color: var(--color-surface);
  font-size: var(--fs-caption);
  font-weight: var(--fw-semibold);
  line-height: var(--lh-tight);
}

.job-detail__owner {
  margin: var(--sp-2) 0 0;
  color: var(--color-text-muted);
  font-size: var(--fs-body-sm);
  line-height: var(--lh-base);
}

.job-detail__actions {
  display: grid;
  gap: var(--tap-gap);
}

.job-detail__actions :deep(.p-button) {
  min-height: var(--tap-field);
}

.job-detail__card {
  padding: var(--sp-4);
  border-bottom: var(--border-1);
  background: var(--color-surface);
}

.job-detail__facts {
  display: grid;
  gap: var(--sp-3);
  margin: 0;
}

.job-detail__facts div {
  display: grid;
  gap: var(--sp-1);
}

.job-detail__facts dt {
  color: var(--color-text-muted);
  font-size: var(--fs-body-sm);
  font-weight: var(--fw-semibold);
}

.job-detail__facts dd {
  margin: 0;
  font-size: var(--fs-body);
  line-height: var(--lh-base);
}

.job-detail__tab:focus-visible {
  outline: 2px solid var(--color-field-action);
  outline-offset: 2px;
}

.job-detail__identity {
  display: grid;
  gap: var(--sp-1);
}

.job-detail__eyebrow {
  margin: 0 0 var(--sp-1);
  color: var(--color-text-muted);
  font-size: var(--fs-body-sm);
  font-weight: var(--fw-semibold);
}

.job-detail__title {
  margin: 0;
  font-size: var(--fs-h1);
  font-weight: var(--fw-semibold);
  line-height: var(--lh-tight);
}

.job-detail__context {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sp-2);
  margin: 0;
  color: var(--color-text-muted);
  font-size: var(--fs-body);
}

.job-detail__tabs {
  display: flex;
  overflow-x: auto;
  padding: 0 var(--sp-2);
  border-bottom: var(--border-1);
  background: var(--color-surface);
  scrollbar-width: none;
}

.job-detail__tabs::-webkit-scrollbar {
  display: none;
}

.job-detail__tab {
  min-height: var(--tap-min);
  flex: 1 0 auto;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--sp-2);
  padding: var(--sp-3) var(--sp-4);
  border-bottom: 3px solid transparent;
  color: var(--color-text-muted);
  font-size: var(--fs-body);
  font-weight: var(--fw-semibold);
  text-decoration: none;
  white-space: nowrap;
}

.job-detail__tab.router-link-active {
  border-bottom-color: var(--color-field-action);
  color: var(--color-text);
}

.job-detail__tab--primary {
  color: var(--color-brand);
}

.job-detail__tab .pi {
  font-size: var(--fs-body-lg);
}

.job-detail__dialog {
  position: fixed;
  inset: 0;
  z-index: 20;
  display: grid;
  place-items: center;
  padding: var(--sp-4);
  background: rgba(7, 34, 61, 0.32);
}

.job-detail__dialog-card,
.job-detail__field {
  display: grid;
  gap: var(--sp-3);
}

.job-detail__dialog-card {
  width: min(100%, 420px);
  padding: var(--sp-4);
  border-radius: var(--radius-md);
  background: var(--color-surface);
  box-shadow: var(--elev-overlay);
}

.job-detail__dialog-card h2 {
  margin: 0;
  font-size: var(--fs-h3);
}

.job-detail__field span {
  font-weight: var(--fw-semibold);
}

.job-detail__input {
  width: 100%;
  font-family: var(--font-ui);
  font-size: var(--fs-body);
}

.job-detail__error {
  color: var(--status-error-fg);
  font-size: var(--fs-body-sm);
}

.job-detail__dialog-actions {
  display: grid;
  gap: var(--sp-2);
}

.job-detail__dialog-actions :deep(.p-button) {
  min-height: var(--tap-field);
}

@media (min-width: 720px) {
  .job-detail__status {
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
  }

  .job-detail__actions {
    grid-auto-flow: column;
    justify-content: end;
  }

  .job-detail__dialog-actions {
    grid-template-columns: repeat(2, minmax(0, max-content));
    justify-content: end;
  }
}
</style>
