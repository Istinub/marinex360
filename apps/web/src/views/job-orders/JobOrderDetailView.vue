<script setup lang="ts">
import Button from 'primevue/button';
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import FieldError from '@/components/common/FieldError.vue';
import MaterialLineRow from '@/components/common/MaterialLineRow.vue';
import MonoText from '@/components/common/MonoText.vue';
import NotFoundState from '@/components/common/NotFoundState.vue';
import VersionConflictDialog from '@/components/common/VersionConflictDialog.vue';
import { post } from '@/lib/api/client';
import { ApiResponseError } from '@/lib/api/errors';
import type { JobOrder, JobState, Variation } from '@/lib/api/types';
import { formatMoney } from '@/lib/money';
import { useAuthStore } from '@/stores/auth';
import { useJobOrdersStore, type JobOrderPatchInput } from '@/stores/jobOrders';

type HeaderField = 'scopeSummary' | 'port' | 'serviceCategories' | 'plannedStartDate' | 'externalQuoteRef' | 'externalRfqRef';
type ConflictMode = 'header' | 'transition';
type TransitionKind = 'forward' | 'side' | 'resume' | 'reject';
type VariationDecision = 'approve' | 'reject';
type RoleGate = { type: 'roles'; roles: string[] };
type ExecOwnerGate = { type: 'execOwner' };
type TransitionGate = RoleGate | ExecOwnerGate;

interface TransitionAction {
  label: string;
  to: JobState;
  kind: TransitionKind;
  requiresReason: boolean;
  gate: TransitionGate;
}

interface JosmRule {
  from: JobState;
  to: JobState;
  kind: TransitionKind;
  requiresReason: boolean;
  gate: TransitionGate;
}

interface MaterialLineDraft {
  id: string;
  description: string;
  quantity: string;
  unit: string;
  unitCost: {
    amountMinor: string;
    currency: string;
  };
}

const route = useRoute();
const auth = useAuthStore();
const jobOrdersStore = useJobOrdersStore();
const jobOrderId = computed(() => String(route.params.id));

const jobOrder = ref<JobOrder | null>(null);
const isLoading = ref(true);
const isSaving = ref(false);
const isNotFound = ref(false);
const formError = ref<string | null>(null);
const fieldErrors = reactive<Partial<Record<HeaderField, string>>>({});
const showConflict = ref(false);
const conflictMode = ref<ConflictMode>('header');
const pendingTransition = ref<TransitionAction | null>(null);
const showTransitionDialog = ref(false);
const transitionReason = ref('');
const transitionError = ref<string | null>(null);
const showVariationForm = ref(false);
const variationReason = ref('');
const variationCurrency = ref('SGD');
const variationError = ref<string | null>(null);
const variationReasonError = ref<string | null>(null);
const variationLineError = ref<string | null>(null);
const variationLines = ref<MaterialLineDraft[]>([]);
const variations = ref<Variation[]>([]);
const pendingVariation = ref<Variation | null>(null);
const pendingVariationDecision = ref<VariationDecision | null>(null);
const form = reactive<Record<HeaderField, string>>({
  scopeSummary: '',
  port: '',
  serviceCategories: '',
  plannedStartDate: '',
  externalQuoteRef: '',
  externalRfqRef: '',
});

const officeRoles = ['OPS_SUPERVISOR', 'SYSTEM_ADMIN', 'DIRECTOR'];
const financeRoles = ['FINANCE', 'SYSTEM_ADMIN'];
const cancelRoles = ['OPS_SUPERVISOR', 'SYSTEM_ADMIN', 'DIRECTOR'];
const variationCreateRoles = ['SYSTEM_ADMIN', 'OPS_SUPERVISOR'];
const variationApproveRoles = ['DIRECTOR', 'SYSTEM_ADMIN'];
const variationRejectRoles = ['DIRECTOR', 'SYSTEM_ADMIN'];
const josmRules: JosmRule[] = [
  { from: 'DRAFT', to: 'SCHEDULED', gate: { type: 'roles', roles: officeRoles }, requiresReason: false, kind: 'forward' },
  { from: 'SCHEDULED', to: 'IN_PROGRESS', gate: { type: 'execOwner' }, requiresReason: false, kind: 'forward' },
  { from: 'IN_PROGRESS', to: 'PENDING_REVIEW', gate: { type: 'execOwner' }, requiresReason: false, kind: 'forward' },
  { from: 'PENDING_REVIEW', to: 'COMPLETED', gate: { type: 'roles', roles: officeRoles }, requiresReason: false, kind: 'forward' },
  { from: 'COMPLETED', to: 'INVOICED', gate: { type: 'roles', roles: financeRoles }, requiresReason: false, kind: 'forward' },
  { from: 'INVOICED', to: 'CLOSED', gate: { type: 'roles', roles: financeRoles }, requiresReason: false, kind: 'forward' },
  { from: 'PENDING_REVIEW', to: 'IN_PROGRESS', gate: { type: 'roles', roles: officeRoles }, requiresReason: true, kind: 'reject' },
  { from: 'SCHEDULED', to: 'ON_HOLD', gate: { type: 'roles', roles: officeRoles }, requiresReason: true, kind: 'side' },
  { from: 'IN_PROGRESS', to: 'ON_HOLD', gate: { type: 'roles', roles: officeRoles }, requiresReason: true, kind: 'side' },
  { from: 'DRAFT', to: 'CANCELLED', gate: { type: 'roles', roles: cancelRoles }, requiresReason: true, kind: 'side' },
  { from: 'SCHEDULED', to: 'CANCELLED', gate: { type: 'roles', roles: cancelRoles }, requiresReason: true, kind: 'side' },
  { from: 'IN_PROGRESS', to: 'CANCELLED', gate: { type: 'roles', roles: cancelRoles }, requiresReason: true, kind: 'side' },
  { from: 'PENDING_REVIEW', to: 'CANCELLED', gate: { type: 'roles', roles: cancelRoles }, requiresReason: true, kind: 'side' },
  { from: 'ON_HOLD', to: 'IN_PROGRESS', gate: { type: 'roles', roles: officeRoles }, requiresReason: true, kind: 'resume' },
  { from: 'ON_HOLD', to: 'SCHEDULED', gate: { type: 'roles', roles: officeRoles }, requiresReason: true, kind: 'resume' },
];

const roles = computed(() => auth.identity?.roles ?? []);
const canCreateVariation = computed(() => roles.value.some((role) => variationCreateRoles.includes(role)));
const canApproveVariation = computed(() => roles.value.some((role) => variationApproveRoles.includes(role)));
const canRejectVariation = computed(() => roles.value.some((role) => variationRejectRoles.includes(role)));
const isHeaderEditable = computed(() => jobOrder.value?.state === 'DRAFT' || jobOrder.value?.state === 'SCHEDULED');
const approvedVariationAmountMinor = computed(() =>
  variations.value
    .filter((variation) => variation.status === 'APPROVED')
    .reduce((total, variation) => total + variation.amountMinor, 0),
);
const proposedVariationAmountMinor = computed(() =>
  variations.value
    .filter((variation) => variation.status === 'PROPOSED')
    .reduce((total, variation) => total + variation.amountMinor, 0),
);
const projectedTotalAmountMinor = computed(() => (jobOrder.value?.quotedAmountMinor ?? 0) + approvedVariationAmountMinor.value);
const variationDraftAmountMinor = computed(() =>
  variationLines.value.reduce((total, line) => {
    const quantity = Number(line.quantity);
    const unitCost = Number(line.unitCost.amountMinor);
    if (!Number.isFinite(quantity) || !Number.isInteger(unitCost)) return total;
    return total + Math.round(quantity * unitCost);
  }, 0),
);

function isRoleGatedRule(rule: JosmRule): rule is JosmRule & { gate: RoleGate } {
  return rule.gate.type === 'roles';
}

const transitionActions = computed<TransitionAction[]>(() => {
  if (!jobOrder.value) return [];
  const seen = new Set<string>();
  return josmRules
    .filter((rule) => rule.from === jobOrder.value?.state)
    .filter(isRoleGatedRule)
    .filter((rule) => roles.value.some((role) => rule.gate.roles.includes(role)))
    .filter((rule) => {
      const key = rule.kind === 'resume' ? 'resume' : `${rule.to}-${rule.kind}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((rule) => ({
      ...rule,
      label: transitionLabel(rule),
    }));
});

const execOwnerTransitions = computed(() =>
  jobOrder.value
    ? josmRules.filter((rule) => rule.from === jobOrder.value?.state && rule.gate.type === 'execOwner')
    : [],
);

function transitionLabel(rule: JosmRule): string {
  if (rule.kind === 'resume') return 'Resume';
  if (rule.to === 'SCHEDULED') return 'Schedule';
  if (rule.to === 'COMPLETED') return 'Complete review';
  if (rule.kind === 'reject') return 'Send back';
  if (rule.to === 'INVOICED') return 'Mark invoiced';
  if (rule.to === 'CLOSED') return 'Close';
  if (rule.to === 'ON_HOLD') return 'Put on hold';
  if (rule.to === 'CANCELLED') return 'Cancel';
  return rule.to;
}

function stateClass(state: JobState): string {
  const tokenName: Record<JobState, string> = {
    DRAFT: 'draft',
    SCHEDULED: 'scheduled',
    IN_PROGRESS: 'inprogress',
    PENDING_REVIEW: 'review',
    COMPLETED: 'completed',
    INVOICED: 'invoiced',
    CLOSED: 'closed',
    ON_HOLD: 'onhold',
    CANCELLED: 'cancelled',
  };
  return `mx-jo-${tokenName[state]}`;
}

function formatDate(value?: string | null): string {
  if (!value) return '—';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(value));
}

function moneyLabel(amountMinor: number, currency?: string | null): string {
  return formatMoney({ amountMinor, currency: currency || jobOrder.value?.quotedCurrency || 'SGD' });
}

function dateInputValue(value?: string | null): string {
  if (!value) return '';
  return new Date(value).toISOString().slice(0, 10);
}

function applyJobOrder(nextJobOrder: JobOrder, overwriteForm: boolean): void {
  jobOrder.value = nextJobOrder;
  if (!overwriteForm) return;
  form.scopeSummary = nextJobOrder.scopeSummary;
  form.port = nextJobOrder.port ?? '';
  form.serviceCategories = nextJobOrder.serviceCategories.join(', ');
  form.plannedStartDate = dateInputValue(nextJobOrder.plannedStartDate);
  form.externalQuoteRef = nextJobOrder.externalQuoteRef ?? '';
  form.externalRfqRef = nextJobOrder.externalRfqRef ?? '';
}

function headerPayload(): JobOrderPatchInput {
  if (!jobOrder.value) throw new Error('Job order is not loaded.');
  return {
    version: jobOrder.value.version,
    scopeSummary: form.scopeSummary.trim(),
    port: form.port.trim() || null,
    serviceCategories: form.serviceCategories.split(',').map((value) => value.trim()).filter(Boolean),
    plannedStartDate: form.plannedStartDate ? new Date(form.plannedStartDate).toISOString() : null,
    externalQuoteRef: form.externalQuoteRef.trim() || null,
    externalRfqRef: form.externalRfqRef.trim() || null,
  };
}

function clearFieldErrors(): void {
  for (const key of Object.keys(fieldErrors) as HeaderField[]) delete fieldErrors[key];
}

function applyValidation(error: ApiResponseError): boolean {
  if (error.code !== 'VALIDATION_ERROR') return false;
  if (error.message.includes('scopeSummary')) fieldErrors.scopeSummary = error.message;
  else formError.value = error.message;
  return true;
}

async function loadJobOrder(overwriteForm = true): Promise<void> {
  const loaded = await jobOrdersStore.loadJobOrder(jobOrderId.value);
  applyJobOrder(loaded, overwriteForm);
  variations.value = loaded.variations ?? [];
}

async function saveHeader(isConflictConfirm = false): Promise<void> {
  if (!jobOrder.value) return;
  clearFieldErrors();
  formError.value = null;
  isSaving.value = true;

  try {
    const updated = await jobOrdersStore.updateJobOrder(jobOrderId.value, headerPayload());
    applyJobOrder(updated, true);
    showConflict.value = false;
  } catch (error) {
    if (error instanceof ApiResponseError) {
      if (error.code === 'VERSION_CONFLICT' && !isConflictConfirm) {
        conflictMode.value = 'header';
        await loadJobOrder(false);
        showConflict.value = true;
        return;
      }
      if (error.code === 'NOT_FOUND') {
        isNotFound.value = true;
        return;
      }
      if (applyValidation(error)) return;
      formError.value = error.message;
      return;
    }
    formError.value = 'Unable to save job order.';
  } finally {
    isSaving.value = false;
  }
}

function openTransition(action: TransitionAction): void {
  pendingTransition.value = action;
  transitionReason.value = '';
  transitionError.value = null;
  showTransitionDialog.value = true;
}

async function runTransition(isConflictConfirm = false): Promise<void> {
  if (!jobOrder.value || !pendingTransition.value) return;
  transitionError.value = null;
  if (pendingTransition.value.requiresReason && !transitionReason.value.trim()) {
    transitionError.value = 'Reason is required.';
    return;
  }

  isSaving.value = true;
  try {
    const updated = await jobOrdersStore.transitionJobOrder(jobOrderId.value, {
      to: pendingTransition.value.to,
      reason: transitionReason.value.trim() || undefined,
      version: jobOrder.value.version,
    });
    applyJobOrder(updated, true);
    showConflict.value = false;
    showTransitionDialog.value = false;
  } catch (error) {
    if (error instanceof ApiResponseError) {
      if (error.code === 'VERSION_CONFLICT' && !isConflictConfirm) {
        conflictMode.value = 'transition';
        await loadJobOrder(false);
        showConflict.value = true;
        return;
      }
      if (error.code === 'NOT_FOUND') {
        isNotFound.value = true;
        return;
      }
      transitionError.value = error.message;
      return;
    }
    transitionError.value = 'Unable to transition job order.';
  } finally {
    isSaving.value = false;
  }
}

function confirmConflict(): void {
  if (pendingVariation.value && pendingVariationDecision.value) {
    void decideVariation(pendingVariation.value, pendingVariationDecision.value, true);
    return;
  }
  if (conflictMode.value === 'transition') void runTransition(true);
  else void saveHeader(true);
}

function newMaterialLine(): MaterialLineDraft {
  return {
    id: crypto.randomUUID(),
    description: '',
    quantity: '1',
    unit: 'EA',
    unitCost: {
      amountMinor: '',
      currency: variationCurrency.value,
    },
  };
}

function openVariationForm(): void {
  variationReason.value = '';
  variationCurrency.value = jobOrder.value?.quotedCurrency ?? 'SGD';
  variationError.value = null;
  variationReasonError.value = null;
  variationLineError.value = null;
  variationLines.value = [newMaterialLine()];
  showVariationForm.value = true;
}

function addVariationLine(): void {
  variationLines.value.push(newMaterialLine());
}

function removeVariationLine(id: string): void {
  variationLines.value = variationLines.value.filter((line) => line.id !== id);
}

function validateVariationDraft(): boolean {
  variationReasonError.value = null;
  variationLineError.value = null;
  if (!variationReason.value.trim()) variationReasonError.value = 'Reason is required.';
  if (variationLines.value.length === 0) variationLineError.value = 'At least one line is required.';
  if (variationDraftAmountMinor.value <= 0) variationLineError.value = 'Variation amount must be greater than zero.';
  return !variationReasonError.value && !variationLineError.value;
}

async function createVariation(): Promise<void> {
  variationError.value = null;
  if (!jobOrder.value || !validateVariationDraft()) return;

  isSaving.value = true;
  try {
    const created = await post<Variation, { reason: string; amountMinor: number; amountCurrency: string }>(
      `/job-orders/${jobOrder.value.id}/variations`,
      {
        reason: variationReason.value.trim(),
        amountMinor: variationDraftAmountMinor.value,
        amountCurrency: variationCurrency.value,
      },
    );
    variations.value = [created, ...variations.value.filter((variation) => variation.id !== created.id)];
    showVariationForm.value = false;
  } catch (error) {
    variationError.value = error instanceof ApiResponseError ? error.message : 'Unable to create variation.';
  } finally {
    isSaving.value = false;
  }
}

async function decideVariation(variation: Variation, decision: VariationDecision, isConflictConfirm = false): Promise<void> {
  pendingVariation.value = variation;
  pendingVariationDecision.value = decision;
  variationError.value = null;
  isSaving.value = true;

  try {
    const decided = await post<Variation, { version: number }>(`/variations/${variation.id}/${decision}`, {
      version: variation.version,
    });
    variations.value = variations.value.map((item) => (item.id === decided.id ? decided : item));
    pendingVariation.value = null;
    pendingVariationDecision.value = null;
    showConflict.value = false;
  } catch (error) {
    if (error instanceof ApiResponseError) {
      if (error.code === 'VERSION_CONFLICT' && !isConflictConfirm) {
        showConflict.value = true;
        return;
      }
      if (error.code === 'STATE_TRANSITION_INVALID') {
        variationError.value = 'This variation was already decided.';
        return;
      }
      variationError.value = error.message;
      return;
    }
    variationError.value = 'Unable to decide variation.';
  } finally {
    isSaving.value = false;
  }
}

onMounted(async () => {
  isLoading.value = true;
  try {
    await loadJobOrder();
  } catch (error) {
    if (error instanceof ApiResponseError && error.code === 'NOT_FOUND') {
      isNotFound.value = true;
      return;
    }
    formError.value = error instanceof ApiResponseError ? error.message : 'Unable to load job order.';
  } finally {
    isLoading.value = false;
  }
});

watch(jobOrderId, async () => {
  isLoading.value = true;
  isNotFound.value = false;
  formError.value = null;
  try {
    await loadJobOrder();
  } catch (error) {
    if (error instanceof ApiResponseError && error.code === 'NOT_FOUND') {
      isNotFound.value = true;
      return;
    }
    formError.value = error instanceof ApiResponseError ? error.message : 'Unable to load job order.';
  } finally {
    isLoading.value = false;
  }
});
</script>

<template>
  <NotFoundState v-if="isNotFound" />

  <main v-else class="office-route crm-page" aria-labelledby="job-order-title">
    <p v-if="isLoading" class="crm-empty">Loading job order...</p>
    <p v-else-if="formError" class="auth-message auth-message--error" role="alert">
      {{ formError }}
    </p>

    <template v-else-if="jobOrder">
      <header class="crm-page__header">
        <div>
          <p class="crm-page__eyebrow">Job order</p>
          <h1 id="job-order-title" class="crm-page__title">
            <MonoText :value="jobOrder.joNumber" />
          </h1>
          <p class="record-form__version">
            ID <MonoText :value="jobOrder.id" /> · Version <MonoText :value="jobOrder.version" />
          </p>
        </div>

        <span class="jo-chip" :class="stateClass(jobOrder.state)">
          {{ jobOrder.state }}
        </span>
      </header>

      <section class="crm-section" aria-labelledby="job-order-actions-title">
        <h2 id="job-order-actions-title" class="crm-section__title">Actions</h2>
        <div class="record-form__actions record-form__actions--left">
          <Button v-if="canCreateVariation" label="Add Variation" icon="pi pi-plus" @click="openVariationForm" />
          <Button
            v-for="action in transitionActions"
            :key="`${action.to}-${action.kind}`"
            :label="action.label"
            :severity="action.to === 'CANCELLED' ? 'danger' : undefined"
            @click="openTransition(action)"
          />
        </div>
        <p v-if="execOwnerTransitions.length" class="crm-empty">
          Execution-owner transition:
          <span
            v-for="rule in execOwnerTransitions"
            :key="`${rule.from}-${rule.to}`"
          >
            <MonoText :value="`${rule.from} -> ${rule.to}`" />
          </span>
        </p>
      </section>

      <section class="crm-section" aria-labelledby="job-order-variation-summary-title">
        <h2 id="job-order-variation-summary-title" class="crm-section__title">Commercial summary</h2>
        <dl class="detail-grid">
          <div>
            <dt>Baseline</dt>
            <dd><span class="mx-money">{{ moneyLabel(jobOrder.quotedAmountMinor, jobOrder.quotedCurrency) }}</span></dd>
          </div>
          <div>
            <dt>Approved variations</dt>
            <dd><span class="mx-money">{{ moneyLabel(approvedVariationAmountMinor, jobOrder.quotedCurrency) }}</span></dd>
          </div>
          <div>
            <dt>Projected total</dt>
            <dd><span class="mx-money">{{ moneyLabel(projectedTotalAmountMinor, jobOrder.quotedCurrency) }}</span></dd>
          </div>
          <div>
            <dt>Proposed variations</dt>
            <dd><span class="mx-money">{{ moneyLabel(proposedVariationAmountMinor, jobOrder.quotedCurrency) }}</span></dd>
          </div>
        </dl>
      </section>

      <section class="crm-section" aria-labelledby="job-order-variations-title">
        <div class="crm-page__header">
          <h2 id="job-order-variations-title" class="crm-section__title">Variations</h2>
          <p class="record-form__version">New variations are always PROPOSED.</p>
        </div>

        <p v-if="variationError" class="auth-message auth-message--error" role="alert">
          {{ variationError }}
        </p>

        <form v-if="showVariationForm" class="record-form record-form--wide" @submit.prevent="createVariation">
          <label class="auth-field" for="variation-reason">
            <span>Reason</span>
            <textarea id="variation-reason" v-model="variationReason" class="auth-input record-form__textarea" required />
            <FieldError :message="variationReasonError" />
          </label>

          <label class="auth-field" for="variation-currency">
            <span>Currency</span>
            <input id="variation-currency" v-model="variationCurrency" class="auth-input mono-input" required />
          </label>

          <div class="variation-lines">
            <MaterialLineRow
              v-for="line in variationLines"
              :key="line.id"
              :line="line"
              :can-remove="variationLines.length > 1"
              @remove="removeVariationLine"
            />
          </div>
          <FieldError :message="variationLineError" />

          <p class="record-form__version">
            Computed amount <span class="mx-money">{{ moneyLabel(variationDraftAmountMinor, variationCurrency) }}</span>
          </p>

          <div class="record-form__actions">
            <Button label="Add line" severity="secondary" type="button" @click="addVariationLine" />
            <Button label="Cancel" severity="secondary" type="button" @click="showVariationForm = false" />
            <Button label="Submit variation" icon="pi pi-save" type="submit" :loading="isSaving" />
          </div>
        </form>

        <div v-if="variations.length" class="variation-list">
          <article v-for="variation in variations" :key="variation.id" class="variation-item">
            <div class="variation-item__header">
              <div>
                <p class="record-form__version">Variation <MonoText :value="variation.id" /></p>
                <h3 class="variation-item__title">{{ variation.reason }}</h3>
              </div>
              <span class="jo-chip" :class="variation.status === 'APPROVED' ? 'mx-status-synced' : variation.status === 'REJECTED' ? 'mx-status-error' : 'mx-status-pending'">
                {{ variation.status }}
              </span>
            </div>

            <dl class="detail-grid">
              <div>
                <dt>Amount</dt>
                <dd><span class="mx-money">{{ moneyLabel(variation.amountMinor, variation.amountCurrency) }}</span></dd>
              </div>
              <div>
                <dt>Version</dt>
                <dd><MonoText :value="variation.version" /></dd>
              </div>
              <div>
                <dt>Approver</dt>
                <dd><MonoText :value="variation.approverId" /></dd>
              </div>
            </dl>

            <div v-if="variation.status === 'PROPOSED' && (canApproveVariation || canRejectVariation)" class="record-form__actions record-form__actions--left">
              <Button v-if="canApproveVariation" label="Approve" icon="pi pi-check" :loading="isSaving" @click="decideVariation(variation, 'approve')" />
              <Button v-if="canRejectVariation" label="Reject" icon="pi pi-times" severity="danger" :loading="isSaving" @click="decideVariation(variation, 'reject')" />
            </div>
          </article>
        </div>

        <p v-else class="crm-empty">
          No variations yet.
        </p>
      </section>

      <section class="crm-section" aria-labelledby="job-order-header-title">
        <div class="crm-page__header">
          <h2 id="job-order-header-title" class="crm-section__title">Header</h2>
          <p v-if="!isHeaderEditable" class="record-form__version">
            Header locked from IN_PROGRESS onward. Add Variation for scope changes.
          </p>
        </div>

        <form v-if="isHeaderEditable" class="record-form" @submit.prevent="saveHeader(false)">
          <label class="auth-field" for="jo-scope">
            <span>Scope summary</span>
            <textarea id="jo-scope" v-model="form.scopeSummary" class="auth-input record-form__textarea" required />
            <FieldError :message="fieldErrors.scopeSummary" />
          </label>

          <label class="auth-field" for="jo-port">
            <span>Port</span>
            <input id="jo-port" v-model="form.port" class="auth-input" />
          </label>

          <label class="auth-field" for="jo-service-categories">
            <span>Service categories</span>
            <input id="jo-service-categories" v-model="form.serviceCategories" class="auth-input" />
          </label>

          <label class="auth-field" for="jo-planned-start">
            <span>Planned start</span>
            <input id="jo-planned-start" v-model="form.plannedStartDate" class="auth-input" type="date" />
          </label>

          <label class="auth-field" for="jo-external-quote">
            <span>External quote ref</span>
            <input id="jo-external-quote" v-model="form.externalQuoteRef" class="auth-input mono-input" />
          </label>

          <label class="auth-field" for="jo-external-rfq">
            <span>External RFQ ref</span>
            <input id="jo-external-rfq" v-model="form.externalRfqRef" class="auth-input mono-input" />
          </label>

          <div class="record-form__actions">
            <Button type="submit" label="Save header" icon="pi pi-save" :loading="isSaving" />
          </div>
        </form>

        <dl v-else class="detail-grid">
          <div>
            <dt>Scope summary</dt>
            <dd>{{ jobOrder.scopeSummary }}</dd>
          </div>
          <div>
            <dt>Port</dt>
            <dd>{{ jobOrder.port ?? '—' }}</dd>
          </div>
          <div>
            <dt>Service categories</dt>
            <dd>{{ jobOrder.serviceCategories.length ? jobOrder.serviceCategories.join(', ') : '—' }}</dd>
          </div>
          <div>
            <dt>Planned start</dt>
            <dd>{{ formatDate(jobOrder.plannedStartDate) }}</dd>
          </div>
          <div>
            <dt>External quote ref</dt>
            <dd><MonoText :value="jobOrder.externalQuoteRef" /></dd>
          </div>
          <div>
            <dt>External RFQ ref</dt>
            <dd><MonoText :value="jobOrder.externalRfqRef" /></dd>
          </div>
        </dl>
      </section>

      <section class="crm-section" aria-labelledby="job-order-commercial-title">
        <h2 id="job-order-commercial-title" class="crm-section__title">Commercial</h2>
        <dl class="detail-grid">
          <div>
            <dt>Client</dt>
            <dd><MonoText :value="jobOrder.clientId" /></dd>
          </div>
          <div>
            <dt>Vessel</dt>
            <dd><MonoText :value="jobOrder.vesselId" /></dd>
          </div>
          <div>
            <dt>Quoted amount</dt>
            <dd><span class="mx-money">{{ formatMoney({ amountMinor: jobOrder.quotedAmountMinor, currency: jobOrder.quotedCurrency }) }}</span></dd>
          </div>
          <div>
            <dt>Labour rate</dt>
            <dd>
              <span v-if="jobOrder.labourRateAmountMinor != null && jobOrder.labourRateCurrency" class="mx-money">
                {{ formatMoney({ amountMinor: jobOrder.labourRateAmountMinor, currency: jobOrder.labourRateCurrency }) }}
              </span>
              <span v-else>—</span>
            </dd>
          </div>
          <div>
            <dt>Assigned technicians</dt>
            <dd>
              <MonoText :value="jobOrder.assignedTechnicianIds.length ? jobOrder.assignedTechnicianIds.join(', ') : null" />
            </dd>
          </div>
          <div>
            <dt>Execution owner</dt>
            <dd><MonoText :value="jobOrder.executionOwnerId" /></dd>
          </div>
        </dl>
      </section>

      <!-- No JobStatusHistory list endpoint is exposed in apps/api/src/routes/jobOrders.ts. -->
    </template>

    <div v-if="showTransitionDialog && pendingTransition" class="version-dialog" role="presentation">
      <section class="version-dialog__panel" role="dialog" aria-modal="true" aria-labelledby="transition-title">
        <div class="version-dialog__header">
          <p class="version-dialog__eyebrow">State transition</p>
          <h2 id="transition-title" class="version-dialog__title">{{ pendingTransition.label }}</h2>
          <p class="version-dialog__copy">
            Send <MonoText :value="jobOrder?.joNumber" /> to <span class="jo-chip" :class="stateClass(pendingTransition.to)">{{ pendingTransition.to }}</span>
          </p>
        </div>

        <label v-if="pendingTransition.requiresReason" class="auth-field" for="transition-reason">
          <span>Reason</span>
          <textarea id="transition-reason" v-model="transitionReason" class="auth-input record-form__textarea" required />
        </label>

        <p v-if="transitionError" class="auth-message auth-message--error" role="alert">
          {{ transitionError }}
        </p>

        <div class="version-dialog__actions">
          <Button label="Cancel" severity="secondary" @click="showTransitionDialog = false" />
          <Button label="Confirm" icon="pi pi-check" :loading="isSaving" @click="runTransition(false)" />
        </div>
      </section>
    </div>

    <VersionConflictDialog
      v-if="showConflict"
      :is-saving="isSaving"
      @cancel="showConflict = false"
      @confirm="confirmConflict"
    />
  </main>
</template>
