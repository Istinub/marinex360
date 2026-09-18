<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { get } from '@/lib/api/client';
import { ApiResponseError } from '@/lib/api/errors';
import { formatMoney } from '@/lib/money';
import { jobOrderStateMeta } from '@/composables/useJobOrderStateMeta';
import type { JobState } from '@/lib/api/types';

const tkmrLogoUrl = new URL('../../../../../assets/branding/TKMR.png', import.meta.url).href;

interface PublicJobProgress {
  joNumber: string;
  vesselName: string;
  clientName: string;
  state: JobState;
  deadline: string | null;
  lastUpdatedAt: string | null;
  timeline: Array<{ fromState: string; toState: string; at: string }>;
  invoiceStatus: string;
  quotedAmountMinor: number;
  approvedVariationsTotalMinor: number;
  projectedTotalMinor: number;
  currency: string;
}

interface Milestone {
  key: 'scheduled' | 'in-progress' | 'completed' | 'invoiced';
  label: string;
  icon: string;
}

const milestones: Milestone[] = [
  { key: 'scheduled', label: 'Scheduled', icon: 'pi pi-check' },
  { key: 'in-progress', label: 'In progress', icon: 'pi pi-wrench' },
  { key: 'completed', label: 'Completed', icon: 'pi pi-check' },
  { key: 'invoiced', label: 'Invoiced', icon: 'pi pi-check' },
];

const milestoneIndexByState: Record<JobState, number> = {
  DRAFT: 0,
  SCHEDULED: 0,
  IN_PROGRESS: 1,
  ON_HOLD: 1,
  PENDING_REVIEW: 1,
  COMPLETED: 2,
  INVOICED: 3,
  CLOSED: 3,
  CANCELLED: -1,
};

const route = useRoute();
const token = computed(() => String(route.params.token));

const progress = ref<PublicJobProgress | null>(null);
const isLoading = ref(true);
const notFound = ref(false);
const rateLimited = ref(false);
const showDetailedHistory = ref(false);

const currentMilestoneIndex = computed(() => (progress.value ? milestoneIndexByState[progress.value.state] : 0));
const currentStateMeta = computed(() => (progress.value ? jobOrderStateMeta(progress.value.state) : null));
const isCancelled = computed(() => progress.value?.state === 'CANCELLED');
const invoiceStatusClass = computed(() => {
  const status = progress.value?.invoiceStatus.toLowerCase() ?? '';
  if (status === 'paid') return 'job-progress-invoice--paid';
  if (status === 'overdue') return 'job-progress-invoice--overdue';
  if (status === 'sent' || status === 'partially paid') return 'job-progress-invoice--sent';
  return 'job-progress-invoice--pending';
});
const expectedCompletionLabel = computed(() => (progress.value?.deadline ? formatDate(progress.value.deadline) : null));
const lastUpdatedLabel = computed(() => (progress.value?.lastUpdatedAt ? formatDateTime(progress.value.lastUpdatedAt) : null));

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('en-SG', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(new Date(value));
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat('en-SG', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(value));
}

function moneyLabel(amountMinor: number, currency: string): string {
  return formatMoney({ amountMinor, currency });
}

function milestoneState(index: number): 'done' | 'current' | 'future' {
  if (isCancelled.value) return 'future';
  if (index < currentMilestoneIndex.value) return 'done';
  if (index === currentMilestoneIndex.value) return 'current';
  return 'future';
}

function milestoneStyle(index: number): Record<string, string> {
  if (milestoneState(index) !== 'current' || !currentStateMeta.value) return {};
  return {
    '--milestone-current-text': currentStateMeta.value.textColor,
    '--milestone-current-bg': currentStateMeta.value.backgroundColor,
  };
}

function milestoneAriaLabel(milestone: Milestone, index: number): string {
  const state = milestoneState(index);
  const stateLabel = state === 'done' ? 'completed' : state === 'current' ? 'current step' : 'upcoming';
  return `${milestone.label} — ${stateLabel}`;
}

onMounted(async () => {
  try {
    progress.value = await get<PublicJobProgress>(`/public/job-progress/${token.value}`, { skipAuth: true });
  } catch (error) {
    if (error instanceof ApiResponseError && error.status === 429) {
      rateLimited.value = true;
    } else {
      notFound.value = true;
    }
  } finally {
    isLoading.value = false;
  }
});
</script>

<template>
  <main class="job-progress-page" aria-labelledby="job-progress-title">
    <section v-if="isLoading" class="job-progress-card job-progress-card--message">
      <p class="job-progress-copy">Loading...</p>
    </section>

    <section v-else-if="rateLimited" class="job-progress-card job-progress-card--message">
      <div class="job-progress-header-band">
        <img class="job-progress-logo" :src="tkmrLogoUrl" alt="TKMR" />
        <div>
          <p class="job-progress-brand">TKMR Marine &amp; Offshore Engineering</p>
          <p class="job-progress-label">Job status</p>
        </div>
      </div>
      <div class="job-progress-message">
        <h1 id="job-progress-title">Too many requests</h1>
        <p>Please wait a few minutes and try again.</p>
      </div>
    </section>

    <section v-else-if="notFound || !progress" class="job-progress-card job-progress-card--message">
      <div class="job-progress-header-band">
        <img class="job-progress-logo" :src="tkmrLogoUrl" alt="TKMR" />
        <div>
          <p class="job-progress-brand">TKMR Marine &amp; Offshore Engineering</p>
          <p class="job-progress-label">Job status</p>
        </div>
      </div>
      <div class="job-progress-message">
        <h1 id="job-progress-title">Link not found or expired</h1>
        <p>This client progress link is no longer valid. Please contact TKMR for an updated link.</p>
      </div>
    </section>

    <article v-else class="job-progress-card">
      <header class="job-progress-header-band">
        <img class="job-progress-logo" :src="tkmrLogoUrl" alt="TKMR" />
        <div>
          <p class="job-progress-brand">TKMR Marine &amp; Offshore Engineering</p>
          <p class="job-progress-label">Job status</p>
        </div>
      </header>

      <div class="job-progress-body">
        <p class="job-progress-trust">
          TKMR Marine &amp; Offshore Engineering Pte Ltd · UEN 202231288E
        </p>

        <section class="job-progress-hero">
          <div>
            <h1 id="job-progress-title">{{ progress.vesselName }}</h1>
            <p class="job-progress-reference">
              Ref: <span>{{ progress.joNumber }}</span> &middot; {{ progress.clientName }}
            </p>
          </div>
          <span v-if="currentStateMeta" class="jo-chip" :class="currentStateMeta.className">{{ currentStateMeta.label }}</span>
        </section>

        <section v-if="isCancelled" class="job-progress-cancelled" aria-label="Cancelled job status">
          <i class="pi pi-exclamation-triangle" aria-hidden="true" />
          <div>
            <h2>Job cancelled</h2>
            <p>Please contact your TKMR representative for details.</p>
          </div>
        </section>

        <section v-else class="job-progress-stepper" aria-label="Job progress milestones">
          <ol>
            <li
              v-for="(milestone, index) in milestones"
              :key="milestone.key"
              :class="`job-progress-step job-progress-step--${milestoneState(index)}`"
              :style="milestoneStyle(index)"
            >
              <span class="job-progress-step__line" aria-hidden="true" />
              <span class="job-progress-step__circle" role="img" :aria-label="milestoneAriaLabel(milestone, index)">
                <i v-if="milestoneState(index) !== 'future'" :class="milestone.icon" aria-hidden="true" />
              </span>
              <span class="job-progress-step__label">{{ milestone.label }}</span>
            </li>
          </ol>
        </section>

        <div v-if="expectedCompletionLabel || lastUpdatedLabel" class="job-progress-meta">
          <p v-if="expectedCompletionLabel">Expected completion: {{ expectedCompletionLabel }}</p>
          <p v-if="lastUpdatedLabel">Last updated: {{ lastUpdatedLabel }}</p>
        </div>

        <section class="job-progress-history">
          <button type="button" class="job-progress-history__toggle" @click="showDetailedHistory = !showDetailedHistory">
            {{ showDetailedHistory ? 'Hide detailed history' : 'View detailed history' }}
            <i :class="showDetailedHistory ? 'pi pi-chevron-up' : 'pi pi-chevron-down'" aria-hidden="true" />
          </button>
          <ul v-if="showDetailedHistory && progress.timeline.length" class="job-progress-history__list">
            <li v-for="(entry, index) in progress.timeline" :key="`${entry.toState}-${entry.at}-${index}`">
              <span class="jo-chip" :class="jobOrderStateMeta(entry.toState as JobState).className">
                {{ jobOrderStateMeta(entry.toState as JobState).label }}
              </span>
              <span>{{ formatDateTime(entry.at) }}</span>
            </li>
          </ul>
          <p v-else-if="showDetailedHistory" class="job-progress-copy">No status updates yet.</p>
        </section>

        <section class="job-progress-summary" aria-labelledby="job-progress-summary-title">
          <h2 id="job-progress-summary-title">Summary</h2>
          <dl>
            <div>
              <dt>Quoted amount</dt>
              <dd>{{ moneyLabel(progress.quotedAmountMinor, progress.currency) }}</dd>
            </div>
            <div>
              <dt>Additional approved work</dt>
              <dd>{{ moneyLabel(progress.approvedVariationsTotalMinor, progress.currency) }}</dd>
            </div>
            <div class="job-progress-summary__total">
              <dt>Estimated total</dt>
              <dd>{{ moneyLabel(progress.projectedTotalMinor, progress.currency) }}</dd>
            </div>
            <div class="job-progress-summary__invoice">
              <dt>Invoice status</dt>
              <dd><span class="job-progress-invoice" :class="invoiceStatusClass">{{ progress.invoiceStatus }}</span></dd>
            </div>
          </dl>
        </section>
      </div>

      <footer class="job-progress-footer">
        <p>Questions about this job? Contact your TKMR representative.</p>
        <p class="job-progress-footer__links">
          <a href="tel:+6597264770">+65 9726 4770</a>
          <span aria-hidden="true">·</span>
          <a href="mailto:mgr@tkmrmarine.com.sg">mgr@tkmrmarine.com.sg</a>
        </p>
      </footer>
    </article>
  </main>
</template>

<style scoped>
.job-progress-page {
  min-height: 100vh;
  display: grid;
  place-items: center;
  padding: 32px 16px;
  background: #F4F7FA;
  color: #11202E;
}

.job-progress-card {
  width: min(100%, 760px);
  overflow: hidden;
  border-radius: 14px;
  background: #FFFFFF;
  box-shadow: 0 2px 16px rgba(7, 34, 61, 0.08);
}

.job-progress-card--message {
  display: grid;
}

.job-progress-header-band {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 20px 28px;
  background: #0B2A4A;
  color: #FFFFFF;
}

.job-progress-logo {
  width: 74px;
  height: 44px;
  object-fit: contain;
  padding: 4px;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.96);
}

.job-progress-brand,
.job-progress-label,
.job-progress-reference,
.job-progress-copy,
.job-progress-message p,
.job-progress-footer {
  margin: 0;
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

.job-progress-brand {
  font-weight: 700;
  line-height: 1.25;
}

.job-progress-label {
  margin-top: 3px;
  color: #9DBFDD;
  font-size: 13px;
  font-weight: 600;
}

.job-progress-body {
  display: grid;
  gap: 24px;
  padding: 28px;
}

.job-progress-trust {
  margin: 0;
  color: #5C7081;
  font-size: 12px;
  font-weight: 600;
}

.job-progress-message {
  display: grid;
  gap: 10px;
  padding: 32px 28px;
}

.job-progress-message h1,
.job-progress-hero h1 {
  margin: 0;
  color: #11202E;
}

.job-progress-message h1 {
  font-size: 24px;
}

.job-progress-message p,
.job-progress-copy {
  color: #5C7081;
}

.job-progress-hero {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.job-progress-hero h1 {
  font-size: 22px;
  font-weight: 700;
  line-height: 1.2;
}

.job-progress-reference {
  margin-top: 8px;
  color: #5C7081;
  font-family: 'IBM Plex Mono', ui-monospace, monospace;
  font-size: 12px;
}

.job-progress-reference span {
  color: #34495C;
}

.job-progress-stepper ol {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  margin: 0;
  padding: 0;
  list-style: none;
}

.job-progress-step {
  position: relative;
  display: grid;
  justify-items: center;
  gap: 8px;
  min-width: 0;
  color: #8B98A3;
  text-align: center;
}

.job-progress-step__line {
  position: absolute;
  top: 16px;
  left: -50%;
  width: 100%;
  height: 3px;
  background: #D3DCE3;
  z-index: 0;
}

.job-progress-step:first-child .job-progress-step__line {
  display: none;
}

.job-progress-step--done .job-progress-step__line,
.job-progress-step--current .job-progress-step__line {
  background: #0B2A4A;
}

.job-progress-step__circle {
  width: 34px;
  height: 34px;
  display: grid;
  place-items: center;
  border: 2px solid #D3DCE3;
  border-radius: 999px;
  background: #FFFFFF;
  color: #8B98A3;
  z-index: 1;
}

.job-progress-step--done .job-progress-step__circle {
  border-color: #0B2A4A;
  background: #0B2A4A;
  color: #FFFFFF;
}

.job-progress-step--current .job-progress-step__circle {
  border-color: var(--milestone-current-text, #0B2A4A);
  background: var(--milestone-current-bg, #EAF2FA);
  color: var(--milestone-current-text, #0B2A4A);
}

.job-progress-step__label {
  overflow-wrap: anywhere;
  color: inherit;
  font-size: 13px;
  font-weight: 600;
}

.job-progress-step--current .job-progress-step__label {
  color: var(--milestone-current-text, #0B2A4A);
  font-weight: 700;
}

.job-progress-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 16px;
  color: #5C7081;
  font-size: 12px;
}

.job-progress-meta p {
  margin: 0;
}

.job-progress-cancelled {
  display: flex;
  gap: 12px;
  padding: 14px;
  border: 0.5px solid #D3DCE3;
  border-radius: 10px;
  background: #F3E0E0;
  color: #7A2E2E;
}

.job-progress-cancelled h2,
.job-progress-summary h2,
.job-progress-cancelled p {
  margin: 0;
}

.job-progress-cancelled h2,
.job-progress-summary h2 {
  font-size: 15px;
}

.job-progress-cancelled p {
  margin-top: 3px;
  font-size: 13px;
}

.job-progress-history {
  display: grid;
  gap: 10px;
}

.job-progress-history__toggle {
  width: fit-content;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 0;
  border: 0;
  background: transparent;
  color: #0B2A4A;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
}

.job-progress-history__list {
  display: grid;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.job-progress-history__list li {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 0;
  border-bottom: 0.5px solid #D3DCE3;
  color: #5C7081;
  font-size: 13px;
}

.job-progress-summary {
  display: grid;
  gap: 14px;
}

.job-progress-summary dl {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  margin: 0;
}

.job-progress-summary dl > div {
  display: grid;
  gap: 4px;
  padding: 14px;
  border: 0.5px solid #D3DCE3;
  border-radius: 10px;
}

.job-progress-summary dt {
  color: #5C7081;
  font-size: 12px;
  font-weight: 600;
}

.job-progress-summary dd {
  margin: 0;
  color: #11202E;
  font-family: 'IBM Plex Mono', ui-monospace, monospace;
  font-size: 16px;
  font-weight: 700;
}

.job-progress-summary__total,
.job-progress-summary__invoice {
  grid-column: 1 / -1;
}

.job-progress-summary__total {
  background: #F4F7FA;
}

.job-progress-summary__total dd {
  font-size: 20px;
}

.job-progress-invoice {
  width: fit-content;
  display: inline-flex;
  align-items: center;
  padding: 3px 10px;
  border-radius: 999px;
  font-family: 'IBM Plex Sans', system-ui, sans-serif;
  font-size: 12px;
  font-weight: 700;
}

.job-progress-invoice--paid {
  background: #E3F3E8;
  color: #14692F;
}

.job-progress-invoice--overdue {
  background: #F3E0E0;
  color: #7A2E2E;
}

.job-progress-invoice--sent {
  background: #E2EFFC;
  color: #0F4C92;
}

.job-progress-invoice--pending {
  background: #ECEFF2;
  color: #44525E;
}

.job-progress-footer {
  display: grid;
  gap: 6px;
  padding: 16px 28px;
  background: #F4F7FA;
  color: #5C7081;
  text-align: center;
  font-size: 13px;
  font-weight: 600;
}

.job-progress-footer p {
  margin: 0;
}

.job-progress-footer__links {
  display: inline-flex;
  justify-content: center;
  flex-wrap: wrap;
  gap: 6px;
}

.job-progress-footer a {
  color: #0B2A4A;
  text-decoration: none;
}

.job-progress-footer a:hover {
  text-decoration: underline;
}

@media (max-width: 640px) {
  .job-progress-page {
    padding: 0;
    place-items: stretch;
  }

  .job-progress-card {
    min-height: 100vh;
    border-radius: 0;
  }

  .job-progress-header-band,
  .job-progress-body,
  .job-progress-footer {
    padding-left: 20px;
    padding-right: 20px;
  }

  .job-progress-header-band {
    padding-top: 16px;
    padding-bottom: 16px;
  }

  .job-progress-hero {
    display: grid;
  }

  .job-progress-stepper ol,
  .job-progress-summary dl {
    grid-template-columns: 1fr;
  }

  .job-progress-step {
    grid-template-columns: auto minmax(0, 1fr);
    justify-items: start;
    text-align: left;
    min-height: 48px;
  }

  .job-progress-step__line {
    top: -50%;
    left: 16px;
    width: 3px;
    height: 100%;
  }

  .job-progress-step:first-child .job-progress-step__line {
    display: none;
  }
}
</style>
