<script setup lang="ts">
import Button from 'primevue/button';
import InputText from 'primevue/inputtext';
import Message from 'primevue/message';
import ProgressSpinner from 'primevue/progressspinner';
import Textarea from 'primevue/textarea';
import { computed, onMounted, ref, watch } from 'vue';
import { RouterLink, useRoute, useRouter } from 'vue-router';
import MobileBackLink from '@/components/MobileBackLink.vue';
import { currentSessionSnapshot } from '@/composables/useAuth';
import { jobOrderStateMeta } from '@/composables/useJobOrderStateMeta';
import { recordJobOpened } from '@/composables/useTodayActivity';
import {
  loadCachedJobOrder,
  loadLiveJobOrder,
  addJobOrderWorker,
  loadJobOrderWorkers,
  suggestJobOrderWorkers,
  transitionJobOrder,
  type JobOrderWorker,
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
const workers = ref<JobOrderWorker[]>([]);
const showWorkerDialog = ref(false);
const workerDialogMode = ref<'start' | 'add'>('add');
const workerName = ref('');
const workerFieldError = ref<string | null>(null);
const workerSuggestions = ref<string[]>([]);
const isSavingWorker = ref(false);
let workerSuggestTimer: ReturnType<typeof setTimeout> | null = null;

const currentUserId = computed(() => currentSessionSnapshot()?.userId ?? null);
const isExecutionOwner = computed(() => Boolean(jobOrder.value?.executionOwnerId && jobOrder.value.executionOwnerId === currentUserId.value));
const showOwnerWarning = computed(() => Boolean(jobOrder.value?.executionOwnerId && !isExecutionOwner.value));
const canStart = computed(() => jobOrder.value?.state === 'SCHEDULED' && jobOrder.value.canStart !== false && jobOrder.value.readOnly !== true);
const canPause = computed(() => jobOrder.value?.state === 'IN_PROGRESS' && jobOrder.value.readOnly !== true && isExecutionOwner.value);
const canComplete = computed(() => jobOrder.value?.state === 'IN_PROGRESS' && jobOrder.value.readOnly !== true && isExecutionOwner.value);
const canAddWorker = computed(() => jobOrder.value?.state === 'IN_PROGRESS' && jobOrder.value.readOnly !== true && isExecutionOwner.value);
const canResume = computed(() => jobOrder.value?.state === 'ON_HOLD' && jobOrder.value.canResume !== false && jobOrder.value.readOnly !== true);
const canTransitionToInProgress = computed(() => canStart.value || canResume.value);
const inProgressTransitionLabel = computed(() => (jobOrder.value?.state === 'SCHEDULED' ? 'Start job' : 'Resume'));
const showExecutionTabs = computed(() => jobOrder.value?.state === 'IN_PROGRESS' && jobOrder.value.readOnly !== true);
const categoryText = computed(() => {
  const categories = jobOrder.value?.serviceCategories ?? [];
  return categories.length > 0 ? categories.join(', ') : 'No category on record';
});
const scopeSummary = computed(() => jobOrder.value?.scopeSummary?.trim() || 'No description on record');
const deadlineText = computed(() => formatDate(jobOrder.value?.deadline));
const stateMeta = computed(() => jobOrder.value ? jobOrderStateMeta(jobOrder.value.state) : null);

function formatDate(value?: string | null): string {
  if (!value) return 'No deadline on record';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(value));
}

function isEmptyField(value: string): boolean {
  return value.startsWith('No ') && value.endsWith(' on record');
}

function applyJobOrder(nextJobOrder: MobileJobOrder): void {
  jobOrder.value = nextJobOrder;
  jobNumber.value = nextJobOrder.joNumber ?? nextJobOrder.id;
  vesselName.value = nextJobOrder.vessel?.name ?? nextJobOrder.vesselName ?? 'No vessel on record';
  clientName.value = nextJobOrder.client?.name ?? nextJobOrder.clientName ?? 'No client on record';
  if (Array.isArray(nextJobOrder.workers)) workers.value = nextJobOrder.workers;
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
      workers.value = await loadJobOrderWorkers(id);
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
    const updated = await transitionJobOrder(jobOrder.value, 'IN_PROGRESS');
    applyJobOrder(updated);
    successMessage.value = 'Job started.';
    workerDialogMode.value = 'start';
    showWorkerDialog.value = true;
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

function beginInProgressTransition(): void {
  if (jobOrder.value?.state === 'SCHEDULED') {
    void startJob();
    return;
  }
  if (jobOrder.value?.state === 'ON_HOLD') showResumeDialog.value = true;
}

function openWorkerDialog(mode: 'start' | 'add' = 'add'): void {
  workerDialogMode.value = mode;
  workerName.value = '';
  workerFieldError.value = null;
  workerSuggestions.value = [];
  showWorkerDialog.value = true;
}

function closeWorkerDialog(): void {
  showWorkerDialog.value = false;
  workerName.value = '';
  workerFieldError.value = null;
  workerSuggestions.value = [];
}

async function saveWorker(addAnother = false): Promise<void> {
  if (!jobOrder.value) return;
  const cleanName = workerName.value.trim();
  workerFieldError.value = null;
  if (!cleanName) {
    workerFieldError.value = 'Name is required.';
    return;
  }

  isSavingWorker.value = true;
  errorMessage.value = null;
  try {
    const created = await addJobOrderWorker(jobOrder.value.id, cleanName);
    workers.value = [created, ...workers.value.filter((worker) => worker.id !== created.id)];
    workerName.value = '';
    workerSuggestions.value = [];
    successMessage.value = 'Worker added.';
    if (!addAnother) closeWorkerDialog();
  } catch (error) {
    workerFieldError.value = error instanceof Error ? error.message : 'Unable to add worker.';
  } finally {
    isSavingWorker.value = false;
  }
}

function continueWorkerDialog(): void {
  if (!workerName.value.trim()) {
    closeWorkerDialog();
    return;
  }
  void saveWorker(false);
}

watch(workerName, (value) => {
  if (workerSuggestTimer) clearTimeout(workerSuggestTimer);
  const cleanValue = value.trim();
  if (cleanValue.length < 2) {
    workerSuggestions.value = [];
    return;
  }
  workerSuggestTimer = setTimeout(() => {
    suggestJobOrderWorkers(cleanValue)
      .then((names) => {
        workerSuggestions.value = names;
      })
      .catch(() => {
        workerSuggestions.value = [];
      });
  }, 250);
});

const checklistPath = computed(() => `/jobs/${jobOrderId.value}/checklist`);
const materialsPath = computed(() => `/jobs/${jobOrderId.value}/materials`);
const documentsPath = computed(() => `/jobs/${jobOrderId.value}/documents`);
const signaturePath = computed(() => `/jobs/${jobOrderId.value}/sign`);
const observationsPath = computed(() => `/jobs/${jobOrderId.value}/observations`);

onMounted(() => {
  if (jobOrderId.value) void recordJobOpened(jobOrderId.value);
  void loadJob();
});
</script>

<template>
  <main class="job-detail" aria-labelledby="job-detail-title">
    <header class="job-detail__header">
      <MobileBackLink to="/jobs" label="Jobs" />
      <div class="job-detail__identity">
        <p class="job-detail__eyebrow">Job execution</p>
        <h1 id="job-detail-title" class="job-detail__title" :class="{ 'job-detail__empty-value': isEmptyField(vesselName) }">{{ vesselName }}</h1>
        <p class="job-detail__context">
          <span>{{ jobNumber }}</span>
          <span aria-hidden="true"> · </span>
          <span :class="{ 'job-detail__empty-value': isEmptyField(clientName) }">{{ clientName }}</span>
        </p>
      </div>
    </header>

    <div v-if="isLoading" class="job-detail__loading" aria-live="polite">
      <ProgressSpinner class="job-detail__spinner" stroke-width="4" />
    </div>

    <Message v-if="errorMessage" class="job-detail__message" severity="error" :closable="false">
      {{ errorMessage }}
    </Message>

    <!-- TODO(ux): consider toast pattern. -->
    <Message
      v-if="successMessage && stateMeta"
      class="job-detail__message job-detail__state-message"
      :class="stateMeta.className"
      severity="secondary"
      :closable="false"
    >
      {{ successMessage }}
    </Message>

    <section v-if="jobOrder" class="job-detail__status" aria-label="Job status">
      <div>
        <span v-if="stateMeta" class="job-detail__state" :class="stateMeta.className">{{ stateMeta.label }}</span>
        <p v-if="showOwnerWarning" class="job-detail__owner">
          Assigned to another technician
        </p>
      </div>

      <div class="job-detail__actions">
        <Button
          v-if="canTransitionToInProgress"
          :label="inProgressTransitionLabel"
          icon="pi pi-play"
          :loading="isSaving"
          @click="beginInProgressTransition"
        />
      </div>
    </section>

    <section v-if="jobOrder" class="job-detail__card" aria-label="Job details">
      <dl class="job-detail__facts">
        <div>
          <dt>Client</dt>
          <dd :class="{ 'job-detail__empty-value': isEmptyField(clientName) }">{{ clientName }}</dd>
        </div>
        <div>
          <dt>Vessel</dt>
          <dd :class="{ 'job-detail__empty-value': isEmptyField(vesselName) }">{{ vesselName }}</dd>
        </div>
        <div>
          <dt>Category</dt>
          <dd :class="{ 'job-detail__empty-value': isEmptyField(categoryText) }">{{ categoryText }}</dd>
        </div>
        <div>
          <dt>Deadline</dt>
          <dd :class="{ 'job-detail__empty-value': isEmptyField(deadlineText) }">{{ deadlineText }}</dd>
        </div>
        <div>
          <dt>Description</dt>
          <dd :class="{ 'job-detail__empty-value': isEmptyField(scopeSummary) }">{{ scopeSummary }}</dd>
        </div>
        <!-- TODO(ux): Director-controlled per-field visibility is future scope; this pass only restores missing technician-safe detail fields. -->
      </dl>

      <RouterLink v-if="!jobOrder.readOnly" class="job-detail__documents-link" :to="documentsPath">
        <i class="pi pi-file" aria-hidden="true" />
        Documents
      </RouterLink>
    </section>

    <section v-if="jobOrder && ['IN_PROGRESS', 'ON_HOLD', 'PENDING_REVIEW', 'COMPLETED', 'INVOICED', 'CLOSED'].includes(jobOrder.state)" class="job-detail__card" aria-label="Workers on this job">
      <div class="job-detail__section-head">
        <div>
          <h2>Who's on this job?</h2>
          <p>Field-worker roster for this job.</p>
        </div>
        <Button v-if="canAddWorker" label="Add worker" icon="pi pi-user-plus" severity="secondary" outlined @click="openWorkerDialog('add')" />
      </div>
      <div v-if="workers.length" class="job-detail__worker-list">
        <span v-for="worker in workers" :key="worker.id" class="job-detail__worker-chip">{{ worker.name }}</span>
      </div>
      <p v-else class="job-detail__empty-note">No workers added yet.</p>
    </section>

    <section v-if="showExecutionTabs" class="job-detail__execution" aria-label="Execution actions">
      <div class="job-detail__work-grid" aria-label="Job data entry">
        <RouterLink class="job-detail__work-action" :to="checklistPath">
          <i class="pi pi-check-square" aria-hidden="true" />
          <span>Checklist</span>
        </RouterLink>
        <RouterLink class="job-detail__work-action" :to="observationsPath">
          <i class="pi pi-align-left" aria-hidden="true" />
          <span>Observation</span>
        </RouterLink>
        <RouterLink class="job-detail__work-action" :to="materialsPath">
          <i class="pi pi-box" aria-hidden="true" />
          <span>Materials</span>
        </RouterLink>
      </div>

      <div class="job-detail__finish-panel" aria-label="Finish job">
        <button
          v-if="canComplete"
          class="job-detail__finish-action job-detail__finish-action--primary"
          type="button"
          :disabled="isSaving"
          @click="router.push(signaturePath)"
        >
          <i class="pi pi-pencil" aria-hidden="true" />
          <span>Proceed to sign</span>
        </button>
        <button
          v-if="canPause"
          class="job-detail__pause-action"
          type="button"
          :disabled="isSaving"
          @click="showPauseDialog = true"
        >
          <i class="pi pi-pause" aria-hidden="true" />
          <span>Pause</span>
        </button>
      </div>
    </section>

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
          <Button :label="inProgressTransitionLabel" :loading="isSaving" @click="resumeJob" />
        </div>
      </section>
    </div>

    <div v-if="showWorkerDialog" class="job-detail__dialog" role="presentation">
      <section class="job-detail__dialog-card" role="dialog" aria-modal="true" aria-labelledby="worker-title">
        <h2 id="worker-title">{{ workerDialogMode === 'start' ? "Who's on this job?" : 'Add worker' }}</h2>
        <p v-if="workerDialogMode === 'start'" class="job-detail__dialog-copy">
          Add the field-worker names for this job now, or skip and add them later.
        </p>
        <label class="job-detail__field" for="worker-name">
          <span>Name</span>
          <InputText id="worker-name" v-model="workerName" class="job-detail__input" autocomplete="off" />
          <small v-if="workerFieldError" class="job-detail__error">{{ workerFieldError }}</small>
        </label>
        <div v-if="workerSuggestions.length" class="job-detail__suggestions" role="listbox" aria-label="Worker suggestions">
          <button
            v-for="suggestion in workerSuggestions"
            :key="suggestion"
            class="job-detail__suggestion"
            type="button"
            @click="workerName = suggestion"
          >
            {{ suggestion }}
          </button>
        </div>
        <div v-if="workers.length" class="job-detail__worker-list">
          <span v-for="worker in workers" :key="worker.id" class="job-detail__worker-chip">{{ worker.name }}</span>
        </div>
        <div class="job-detail__dialog-actions">
          <Button :label="workerDialogMode === 'start' ? 'Skip' : 'Done'" severity="secondary" @click="closeWorkerDialog" />
          <Button label="Add another" severity="secondary" outlined :loading="isSavingWorker" @click="saveWorker(true)" />
          <Button label="Continue" :loading="isSavingWorker" @click="continueWorkerDialog" />
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

.job-detail__state-message {
  border-color: transparent;
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
  padding: 3px 10px;
  border-radius: var(--radius-pill);
  font-size: 12px;
  font-weight: 500;
  line-height: var(--lh-tight);
}

.job-detail__owner {
  margin: var(--sp-2) 0 0;
  color: var(--jo-onhold-fg);
  font-size: var(--fs-body-sm);
  font-weight: var(--fw-semibold);
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

.job-detail__section-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--sp-3);
}

.job-detail__section-head h2,
.job-detail__section-head p,
.job-detail__dialog-copy,
.job-detail__empty-note {
  margin: 0;
}

.job-detail__section-head h2 {
  font-size: var(--fs-body-lg);
  font-weight: var(--fw-semibold);
}

.job-detail__section-head p,
.job-detail__dialog-copy,
.job-detail__empty-note {
  color: var(--color-text-muted);
  font-size: var(--fs-body-sm);
  line-height: var(--lh-base);
}

.job-detail__worker-list {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sp-2);
  margin-top: var(--sp-3);
}

.job-detail__worker-chip {
  display: inline-flex;
  align-items: center;
  min-height: 30px;
  padding: 4px 10px;
  border: var(--border-1);
  border-radius: var(--radius-pill);
  background: var(--color-canvas);
  color: var(--color-text);
  font-size: var(--fs-body-sm);
  font-weight: var(--fw-semibold);
}

.job-detail__documents-link,
.job-detail__work-action,
.job-detail__finish-action,
.job-detail__pause-action {
  text-decoration: none;
}

.job-detail__documents-link {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--sp-2);
  min-height: var(--tap-field);
  margin-top: var(--sp-4);
  padding: var(--sp-3) var(--sp-4);
  border: var(--border-1);
  border-radius: var(--radius-md);
  color: var(--color-brand);
  font-size: var(--fs-body);
  font-weight: var(--fw-semibold);
}

.job-detail__documents-link:focus-visible,
.job-detail__work-action:focus-visible,
.job-detail__finish-action:focus-visible,
.job-detail__pause-action:focus-visible {
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
  color: #11202E;
  font-size: 19px;
  font-weight: 600;
  line-height: var(--lh-tight);
}

.job-detail__context {
  margin: 0;
  color: #5C7081;
  font-family: 'IBM Plex Mono', ui-monospace, monospace;
  font-size: 12px;
  line-height: var(--lh-base);
}

.job-detail__empty-value {
  color: #5C7081;
  font-style: italic;
}

.job-detail__execution {
  display: grid;
  gap: var(--sp-4);
  padding: var(--sp-4);
}

.job-detail__work-grid {
  display: grid;
  gap: var(--sp-3);
}

.job-detail__work-action,
.job-detail__finish-action,
.job-detail__pause-action {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--sp-3);
  border: var(--border-1);
  border-radius: var(--radius-md);
  font-weight: var(--fw-semibold);
}

.job-detail__work-action {
  min-height: 112px;
  padding: var(--sp-5);
  background: var(--color-surface);
  color: var(--color-text);
  font-size: var(--fs-h3);
}

.job-detail__work-action .pi {
  color: var(--color-field-action);
  font-size: var(--fs-h2);
}

.job-detail__finish-panel {
  display: grid;
  gap: var(--sp-3);
  padding: var(--sp-4);
  border-top: var(--border-2);
  background: var(--color-surface);
}

.job-detail__finish-action,
.job-detail__pause-action {
  width: 100%;
  min-height: var(--tap-field);
  padding: var(--sp-3) var(--sp-4);
  font-size: var(--fs-body-lg);
}

.job-detail__finish-action {
  color: var(--color-brand);
}

.job-detail__finish-action--primary {
  border-color: var(--color-field-action);
  background: var(--color-field-action);
  color: var(--color-surface);
  cursor: pointer;
}

.job-detail__pause-action {
  border-color: var(--color-border);
  background: transparent;
  color: var(--color-text-muted);
  cursor: pointer;
  font-size: var(--fs-body);
}

.job-detail__finish-action--primary:disabled,
.job-detail__pause-action:disabled {
  cursor: wait;
  opacity: 0.72;
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

.job-detail__suggestions {
  display: grid;
  overflow: hidden;
  border: var(--border-1);
  border-radius: var(--radius-md);
  background: var(--color-surface);
}

.job-detail__suggestion {
  min-height: var(--tap-min);
  padding: var(--sp-2) var(--sp-3);
  border: 0;
  border-bottom: var(--border-1);
  background: transparent;
  color: var(--color-text);
  font: inherit;
  text-align: left;
}

.job-detail__suggestion:last-child {
  border-bottom: 0;
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

  .job-detail__work-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  .job-detail__work-action {
    min-height: 148px;
    flex-direction: column;
  }

  .job-detail__work-action .pi {
    font-size: var(--fs-display);
  }

  .job-detail__finish-panel {
    grid-template-columns: repeat(2, minmax(0, 1fr)) minmax(9rem, max-content);
    align-items: center;
  }

  .job-detail__dialog-actions {
    grid-template-columns: repeat(2, minmax(0, max-content));
    justify-content: end;
  }
}
</style>
