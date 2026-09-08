<script setup lang="ts">
import Button from 'primevue/button';
import MultiSelect from 'primevue/multiselect';
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import BackLink from '@/components/common/BackLink.vue';
import FieldError from '@/components/common/FieldError.vue';
import MaterialLineRow from '@/components/common/MaterialLineRow.vue';
import MonoText from '@/components/common/MonoText.vue';
import NotFoundState from '@/components/common/NotFoundState.vue';
import VersionConflictDialog from '@/components/common/VersionConflictDialog.vue';
import { post } from '@/lib/api/client';
import { ApiResponseError } from '@/lib/api/errors';
import type { Invoice, JobOrder, JobState, JobStatusHistoryEntry, Variation, VariationStatus } from '@/lib/api/types';
import { formatMoney } from '@/lib/money';
import { jobOrderStateMeta } from '@/composables/useJobOrderStateMeta';
import { useAuthStore } from '@/stores/auth';
import { useChecklistCategoriesStore } from '@/stores/checklistCategories';
import { useJobOrdersStore, type JobOrderCategoriesInput, type JobOrderPatchInput } from '@/stores/jobOrders';

type HeaderField = 'scopeSummary' | 'port' | 'plannedStartDate' | 'deadline' | 'externalQuoteRef' | 'externalRfqRef';
type ConflictMode = 'header' | 'categories' | 'transition';
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
const router = useRouter();
const auth = useAuthStore();
const checklistCategoriesStore = useChecklistCategoriesStore();
const jobOrdersStore = useJobOrdersStore();
const jobOrderId = computed(() => String(route.params.id));

const jobOrder = ref<JobOrder | null>(null);
const isLoading = ref(true);
const isSaving = ref(false);
const isNotFound = ref(false);
const formError = ref<string | null>(null);
const fieldErrors = reactive<Partial<Record<HeaderField, string>>>({});
const isEditing = ref(false);
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
  plannedStartDate: '',
  deadline: '',
  externalQuoteRef: '',
  externalRfqRef: '',
});
const categoryForm = reactive({
  serviceCategories: [] as string[],
});
const categoryError = ref<string | null>(null);
const categorySuccess = ref<string | null>(null);
const lifecycleError = ref<string | null>(null);
const reportError = ref<string | null>(null);
const reportUrl = ref<string | null>(null);
const isReportLoading = ref(false);
const invoicePdfError = ref<string | null>(null);
const invoicePdfUrl = ref<string | null>(null);
const isInvoicePdfLoading = ref(false);
const categoryOptions = computed(() => checklistCategoriesStore.options);

const officeRoles = ['OPS_SUPERVISOR', 'SYSTEM_ADMIN', 'DIRECTOR'];
const schedulerRoles = ['SYSTEM_ADMIN', 'DIRECTOR'];
const financeRoles = ['FINANCE', 'SYSTEM_ADMIN', 'DIRECTOR'];
const cancelRoles = ['OPS_SUPERVISOR', 'SYSTEM_ADMIN', 'DIRECTOR'];
const variationCreateRoles = ['SYSTEM_ADMIN', 'OPS_SUPERVISOR'];
const variationApproveRoles = ['DIRECTOR', 'SYSTEM_ADMIN'];
const variationRejectRoles = ['DIRECTOR', 'SYSTEM_ADMIN'];
const lifecycleRoles = ['DIRECTOR', 'SYSTEM_ADMIN'];
const josmRules: JosmRule[] = [
  { from: 'DRAFT', to: 'SCHEDULED', gate: { type: 'roles', roles: schedulerRoles }, requiresReason: false, kind: 'forward' },
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
const canManageLifecycle = computed(() => roles.value.some((role) => lifecycleRoles.includes(role)));
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
const stateMeta = computed(() => jobOrder.value ? jobOrderStateMeta(jobOrder.value.state) : null);
const sortedHistory = computed(() => [...(jobOrder.value?.statusHistory ?? [])].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime()));
const scheduledHistory = computed(() => firstHistoryTo('SCHEDULED'));
const startedHistory = computed(() => firstHistoryTo('IN_PROGRESS'));
const submittedHistory = computed(() => firstHistoryTo('PENDING_REVIEW'));
const completedHistory = computed(() => firstHistoryTo('COMPLETED'));
const cancelledHistory = computed(() => lastHistoryTo('CANCELLED'));
const pausedHistory = computed(() => lastHistoryTo('ON_HOLD'));
const lastWorkerBeforePause = computed(() => {
  const pauseAt = pausedHistory.value ? new Date(pausedHistory.value.at).getTime() : Number.POSITIVE_INFINITY;
  return [...sortedHistory.value]
    .reverse()
    .find((entry) => entry.toState === 'IN_PROGRESS' && new Date(entry.at).getTime() <= pauseAt) ?? null;
});
const latestInvoice = computed(() => jobOrder.value?.invoices?.[0] ?? null);
const earnedAmount = computed(() => {
  const invoice = latestInvoice.value;
  if (!invoice) return null;
  const paidMinor = (invoice.payments ?? []).reduce((total, payment) => total + payment.amountMinor, 0);
  return { amountMinor: paidMinor || invoice.totalAmountMinor, currency: invoice.totalCurrency };
});
const jobClientName = computed(() => jobOrder.value?.client?.name ?? jobOrder.value?.clientId ?? '—');
const jobVesselName = computed(() => jobOrder.value?.vessel?.name ?? jobOrder.value?.vesselId ?? '—');
const categoryLabels = computed(() =>
  (jobOrder.value?.serviceCategories ?? []).map((category) =>
    categoryOptions.value.find((option) => option.value === category)?.label ?? category,
  ),
);
const recentHistory = computed(() => [...sortedHistory.value].reverse());
const canGenerateCompletionOutput = computed(() => jobOrder.value?.state === 'COMPLETED');
const canViewClosedOutput = computed(() => jobOrder.value?.state === 'CLOSED');
const canUseCompletionReport = computed(() => jobOrder.value ? ['COMPLETED', 'INVOICED', 'CLOSED'].includes(jobOrder.value.state) : false);
const canUseInvoicePdf = computed(() => Boolean(latestInvoice.value) && Boolean(jobOrder.value && ['COMPLETED', 'INVOICED', 'CLOSED'].includes(jobOrder.value.state)));
const canOpenInvoiceDraft = computed(() => latestInvoice.value?.status === 'DRAFT');
const showRenewAction = computed(() => jobOrder.value?.state === 'CANCELLED');

function firstHistoryTo(state: JobState): JobStatusHistoryEntry | null {
  return sortedHistory.value.find((entry) => entry.toState === state) ?? null;
}

function lastHistoryTo(state: JobState): JobStatusHistoryEntry | null {
  return [...sortedHistory.value].reverse().find((entry) => entry.toState === state) ?? null;
}

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

function formatDate(value?: string | null): string {
  if (!value) return '—';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(value));
}

function formatDateTime(value?: string | null): string {
  if (!value) return '—';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

function formatRelativeTime(value?: string | null): string {
  if (!value) return '—';
  const diffMs = new Date(value).getTime() - Date.now();
  const abs = Math.abs(diffMs);
  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  if (abs < 60_000) return formatter.format(Math.round(diffMs / 1000), 'second');
  if (abs < 3_600_000) return formatter.format(Math.round(diffMs / 60_000), 'minute');
  if (abs < 86_400_000) return formatter.format(Math.round(diffMs / 3_600_000), 'hour');
  return formatter.format(Math.round(diffMs / 86_400_000), 'day');
}

function moneyLabel(amountMinor: number, currency?: string | null): string {
  return formatMoney({ amountMinor, currency: currency || jobOrder.value?.quotedCurrency || 'SGD' });
}

function invoiceMoneyLabel(invoice: Invoice | null): string {
  if (!invoice) return '—';
  return moneyLabel(invoice.totalAmountMinor, invoice.totalCurrency);
}

function earnedMoneyLabel(): string {
  return earnedAmount.value ? moneyLabel(earnedAmount.value.amountMinor, earnedAmount.value.currency) : '—';
}

function dateInputValue(value?: string | null): string {
  if (!value) return '';
  return new Date(value).toISOString().slice(0, 10);
}

function assignedTechnicianNames(jobOrder: JobOrder): string {
  return jobOrder.assignedTechnicianIds.length
    ? jobOrder.assignedTechnicianIds.join(', ')
    : '—';
}

function executionOwnerName(jobOrder: JobOrder): string {
  return jobOrder.executionOwnerId ?? '—';
}

function historyActor(entry?: JobStatusHistoryEntry | null): string {
  return entry?.actor?.name ?? entry?.actor?.email ?? entry?.actorId ?? '—';
}

function historyDevice(entry?: JobStatusHistoryEntry | null): string {
  return entry?.device?.name ?? entry?.deviceId ?? '—';
}

function historyDeviceSuffix(entry?: JobStatusHistoryEntry | null): string {
  const device = historyDevice(entry);
  return device === '—' ? '' : ` (${device})`;
}

function startEditing(): void {
  if (jobOrder.value) applyJobOrder(jobOrder.value, true);
  isEditing.value = true;
}

function cancelEditing(): void {
  if (jobOrder.value) applyJobOrder(jobOrder.value, true);
  isEditing.value = false;
}

function variationStatusLabel(status: VariationStatus): string {
  if (status === 'APPROVED') return 'Approved';
  if (status === 'REJECTED') return 'Rejected';
  return 'Proposed';
}

function variationStatusClass(status: VariationStatus): string {
  if (status === 'APPROVED') return 'mx-status-synced';
  if (status === 'REJECTED') return 'mx-status-error';
  return 'mx-status-pending';
}

function applyJobOrder(nextJobOrder: JobOrder, overwriteForm: boolean): void {
  jobOrder.value = nextJobOrder;
  if (!overwriteForm) return;
  categoryForm.serviceCategories = [...nextJobOrder.serviceCategories];
  form.scopeSummary = nextJobOrder.scopeSummary;
  form.port = nextJobOrder.port ?? '';
  form.plannedStartDate = dateInputValue(nextJobOrder.plannedStartDate);
  form.deadline = dateInputValue(nextJobOrder.deadline);
  form.externalQuoteRef = nextJobOrder.externalQuoteRef ?? '';
  form.externalRfqRef = nextJobOrder.externalRfqRef ?? '';
}

function headerPayload(): JobOrderPatchInput {
  if (!jobOrder.value) throw new Error('Job order is not loaded.');
  return {
    version: jobOrder.value.version,
    scopeSummary: form.scopeSummary.trim(),
    port: form.port.trim() || null,
    plannedStartDate: form.plannedStartDate ? new Date(form.plannedStartDate).toISOString() : null,
    deadline: form.deadline ? new Date(form.deadline).toISOString() : null,
    externalQuoteRef: form.externalQuoteRef.trim() || null,
    externalRfqRef: form.externalRfqRef.trim() || null,
  };
}

function categoryPayload(): JobOrderCategoriesInput {
  if (!jobOrder.value) throw new Error('Job order is not loaded.');
  return {
    version: jobOrder.value.version,
    serviceCategories: [...categoryForm.serviceCategories],
  };
}

function clearFieldErrors(): void {
  for (const key of Object.keys(fieldErrors) as HeaderField[]) delete fieldErrors[key];
}

async function saveCategories(): Promise<void> {
  if (!jobOrder.value) return;
  categoryError.value = null;
  categorySuccess.value = null;
  isSaving.value = true;

  try {
    const updated = await jobOrdersStore.updateJobOrderCategories(jobOrderId.value, categoryPayload());
    applyJobOrder(updated, true);
    categorySuccess.value = 'Categories saved.';
    showConflict.value = false;
  } catch (error) {
    if (error instanceof ApiResponseError) {
      if (error.code === 'VERSION_CONFLICT') {
        conflictMode.value = 'categories';
        await loadJobOrder(false);
        showConflict.value = true;
        return;
      }
      if (error.code === 'NOT_FOUND') {
        isNotFound.value = true;
        return;
      }
      categoryError.value = error.message;
      return;
    }
    categoryError.value = 'Unable to save categories.';
  } finally {
    isSaving.value = false;
  }
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
  reportUrl.value = null;
  reportError.value = null;
  invoicePdfUrl.value = null;
  invoicePdfError.value = null;
  if (['COMPLETED', 'INVOICED', 'CLOSED'].includes(loaded.state) && loaded.reportObjectKey) {
    void refreshReportUrl();
  }
  const invoice = loaded.invoices?.[0] ?? null;
  if (invoice?.pdfObjectKey) {
    void refreshInvoicePdfUrl();
  }
}

async function refreshReportUrl(): Promise<void> {
  if (!jobOrder.value) return;
  reportError.value = null;
  isReportLoading.value = true;
  try {
    const report = await jobOrdersStore.loadJobOrderReport(jobOrder.value.id);
    reportUrl.value = report.status === 'READY' ? report.url : null;
  } catch (error) {
    reportError.value = error instanceof ApiResponseError ? error.message : 'Unable to load completion report.';
  } finally {
    isReportLoading.value = false;
  }
}

async function openReport(): Promise<void> {
  if (!reportUrl.value) await refreshReportUrl();
  if (reportUrl.value) window.open(reportUrl.value, '_blank', 'noopener');
}

async function downloadReport(): Promise<void> {
  if (!reportUrl.value) await refreshReportUrl();
  if (reportUrl.value) triggerDownload(reportUrl.value, `${jobOrder.value?.joNumber ?? 'job-order'}-report.pdf`);
}

async function refreshInvoicePdfUrl(): Promise<void> {
  const invoice = latestInvoice.value;
  if (!invoice) return;
  invoicePdfError.value = null;
  isInvoicePdfLoading.value = true;
  try {
    const pdf = await jobOrdersStore.loadInvoicePdf(invoice.id);
    invoicePdfUrl.value = pdf.status === 'READY' ? pdf.url : null;
  } catch (error) {
    invoicePdfError.value = error instanceof ApiResponseError ? error.message : 'Unable to load invoice PDF.';
  } finally {
    isInvoicePdfLoading.value = false;
  }
}

async function openInvoicePdf(): Promise<void> {
  if (!invoicePdfUrl.value) await refreshInvoicePdfUrl();
  if (invoicePdfUrl.value) window.open(invoicePdfUrl.value, '_blank', 'noopener');
}

async function downloadInvoicePdf(): Promise<void> {
  if (!invoicePdfUrl.value) await refreshInvoicePdfUrl();
  if (invoicePdfUrl.value) triggerDownload(invoicePdfUrl.value, `${latestInvoice.value?.invoiceNumber ?? 'invoice'}.pdf`);
}

function triggerDownload(url: string, filename: string): void {
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = 'noopener';
  anchor.target = '_blank';
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
}

function openInvoiceDraft(): void {
  if (latestInvoice.value) void router.push(`/invoices/${latestInvoice.value.id}`);
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

async function moveToTrash(): Promise<void> {
  if (!jobOrder.value) return;
  lifecycleError.value = null;
  isSaving.value = true;
  try {
    const updated = await jobOrdersStore.deleteJobOrder(jobOrder.value.id);
    jobOrder.value = updated;
    await router.replace('/job-orders/trash');
  } catch (error) {
    lifecycleError.value = error instanceof ApiResponseError ? error.message : 'Unable to move job order to trash.';
  } finally {
    isSaving.value = false;
  }
}

async function moveToArchive(): Promise<void> {
  if (!jobOrder.value) return;
  lifecycleError.value = null;
  isSaving.value = true;
  try {
    const updated = await jobOrdersStore.archiveJobOrder(jobOrder.value.id);
    jobOrder.value = updated;
    await router.replace('/job-orders/archive');
  } catch (error) {
    lifecycleError.value = error instanceof ApiResponseError ? error.message : 'Unable to archive job order.';
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
  else if (conflictMode.value === 'categories') void saveCategories();
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
    await checklistCategoriesStore.load();
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
    await Promise.all([checklistCategoriesStore.load(), loadJobOrder()]);
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
      <header class="crm-page__header jo-detail-hero">
        <div>
          <BackLink to="/job-orders" label="Job orders" />
          <p class="record-form__version">Job order</p>
          <h1 id="job-order-title" class="crm-page__title jo-detail-hero__title">
            <MonoText :value="jobOrder.joNumber" />
          </h1>
          <p class="jo-detail-hero__subtitle">
            {{ jobVesselName }} · {{ jobClientName }}
            <span class="jo-version-badge">
              <!-- OD-05 optimistic-lock version, kept visible for debugging. -->
              v{{ jobOrder.version }}
            </span>
          </p>
        </div>

        <div class="jo-detail-hero__actions">
          <span v-if="stateMeta" class="jo-chip" :class="stateMeta.className">
            {{ stateMeta.label }}
          </span>
          <Button label="Edit" icon="pi pi-pencil" severity="secondary" outlined @click="startEditing" />
        </div>
      </header>

      <div class="jo-detail-layout">
        <div class="jo-detail-layout__main">
          <section class="jo-detail-card" aria-labelledby="job-order-scope-title">
            <div class="jo-detail-card__header">
              <h2 id="job-order-scope-title" class="crm-section__title">Scope</h2>
              <span v-if="jobOrder.port" class="jo-port-pill">{{ jobOrder.port }}</span>
            </div>
            <div v-if="categoryLabels.length" class="jo-chip-list">
              <span v-for="category in categoryLabels" :key="category" class="jo-category-chip">
                {{ category }}
              </span>
            </div>
            <p class="jo-scope-copy">{{ jobOrder.scopeSummary }}</p>
            <dl class="detail-grid detail-grid--compact">
              <div>
                <dt>Requested date</dt>
                <dd>{{ formatDate(jobOrder.createdAt) }}</dd>
              </div>
              <div>
                <dt>Scheduled date</dt>
                <dd>{{ formatDateTime(scheduledHistory?.at ?? jobOrder.plannedStartDate) }}</dd>
              </div>
              <div>
                <dt>Deadline</dt>
                <dd>{{ formatDate(jobOrder.deadline) }}</dd>
              </div>
            </dl>
            <p v-if="jobOrder.state === 'ON_HOLD' || jobOrder.state === 'CANCELLED'" class="jo-reason">
              <strong>{{ jobOrder.state === 'ON_HOLD' ? 'Pause reason' : 'Cancellation reason' }}:</strong>
              {{ (jobOrder.state === 'ON_HOLD' ? pausedHistory?.reason : cancelledHistory?.reason) ?? '—' }}
            </p>
          </section>

          <section class="jo-detail-card" aria-labelledby="job-order-variations-title">
            <div class="jo-detail-card__header">
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
                  <span class="jo-chip" :class="variationStatusClass(variation.status)">
                    {{ variationStatusLabel(variation.status) }}
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

          <section class="jo-detail-card" aria-labelledby="job-order-documents-title">
            <div class="jo-detail-card__header">
              <h2 id="job-order-documents-title" class="crm-section__title">Documents</h2>
            </div>
            <div class="jo-document-chip-list">
              <span class="jo-document-chip">
                <i class="ti ti-file-text" aria-hidden="true" />
                Job documents
              </span>
              <span v-if="jobOrder.reportObjectKey" class="jo-document-chip">
                <i class="ti ti-file-report" aria-hidden="true" />
                Completion report
              </span>
              <span v-if="latestInvoice?.pdfObjectKey" class="jo-document-chip">
                <i class="ti ti-receipt" aria-hidden="true" />
                Invoice PDF
              </span>
            </div>
          </section>

          <section
            v-if="canGenerateCompletionOutput || canViewClosedOutput || showRenewAction || canUseCompletionReport"
            class="jo-detail-card"
            aria-labelledby="job-order-output-title"
          >
            <div class="jo-detail-card__header">
              <h2 id="job-order-output-title" class="crm-section__title">Output</h2>
            </div>
            <div class="record-form__actions record-form__actions--left">
              <Button
                v-if="canUseCompletionReport"
                :label="reportUrl || jobOrder.reportObjectKey ? 'Preview report' : 'Generating...'"
                icon="pi pi-file-pdf"
                severity="secondary"
                :loading="isReportLoading"
                :disabled="!jobOrder.reportObjectKey"
                @click="openReport"
              />
              <Button
                v-if="canUseCompletionReport && jobOrder.reportObjectKey"
                label="Download report"
                icon="pi pi-download"
                severity="secondary"
                :loading="isReportLoading"
                @click="downloadReport"
              />
              <Button v-if="canOpenInvoiceDraft" label="Create Invoice" icon="pi pi-receipt" severity="secondary" @click="openInvoiceDraft" />
              <Button v-else-if="canGenerateCompletionOutput && latestInvoice" label="Go to invoice" icon="pi pi-receipt" severity="secondary" @click="openInvoiceDraft" />
              <Button v-if="canViewClosedOutput" label="View invoice" icon="pi pi-receipt" severity="secondary" @click="openInvoiceDraft" />
              <Button
                v-if="canUseInvoicePdf"
                :label="invoicePdfUrl || latestInvoice?.pdfObjectKey ? 'Preview invoice PDF' : 'Invoice PDF generating...'"
                icon="pi pi-file-pdf"
                severity="secondary"
                :loading="isInvoicePdfLoading"
                :disabled="!latestInvoice?.pdfObjectKey"
                @click="openInvoicePdf"
              />
              <Button
                v-if="canUseInvoicePdf && latestInvoice?.pdfObjectKey"
                label="Download invoice PDF"
                icon="pi pi-download"
                severity="secondary"
                :loading="isInvoicePdfLoading"
                @click="downloadInvoicePdf"
              />
              <Button v-if="showRenewAction" label="Renew" icon="pi pi-refresh" severity="secondary" @click="router.push('/job-orders/new')" />
            </div>
            <p v-if="reportError" class="auth-message auth-message--error" role="alert">
              {{ reportError }}
            </p>
            <p v-if="invoicePdfError" class="auth-message auth-message--error" role="alert">
              {{ invoicePdfError }}
            </p>
          </section>

          <section class="jo-detail-card" aria-labelledby="job-order-history-title">
            <div class="jo-detail-card__header">
              <h2 id="job-order-history-title" class="crm-section__title">History</h2>
            </div>
            <ol v-if="recentHistory.length" class="jo-history-list">
              <li v-for="entry in recentHistory" :key="entry.id" class="jo-history-item">
                <span class="jo-history-item__dot" aria-hidden="true" />
                <div>
                  <p>
                    Moved to
                    <span class="jo-history-item__state" :class="jobOrderStateMeta(entry.toState).className">
                      {{ jobOrderStateMeta(entry.toState).label }}
                    </span>
                  </p>
                  <p class="jo-history-item__meta">
                    {{ historyActor(entry) }}{{ historyDeviceSuffix(entry) }} · {{ formatRelativeTime(entry.at) }}
                    <span :title="formatDateTime(entry.at)">· {{ formatDateTime(entry.at) }}</span>
                  </p>
                  <p v-if="entry.reason" class="jo-history-item__reason">
                    {{ entry.reason }}
                  </p>
                </div>
              </li>
            </ol>
            <p v-else class="crm-empty">No history yet.</p>
          </section>

          <section class="jo-detail-card" aria-labelledby="job-order-actions-title">
            <div class="jo-detail-card__header">
              <h2 id="job-order-actions-title" class="crm-section__title">Actions</h2>
            </div>
            <div class="record-form__actions record-form__actions--left">
              <Button v-if="canCreateVariation" label="Add Variation" icon="pi pi-plus" @click="openVariationForm" />
              <Button
                v-for="action in transitionActions"
                :key="`${action.to}-${action.kind}`"
                :label="action.label"
                :severity="action.to === 'CANCELLED' ? 'danger' : undefined"
                @click="openTransition(action)"
              />
              <Button
                v-if="canManageLifecycle"
                label="Archive"
                icon="pi pi-box"
                severity="secondary"
                outlined
                :loading="isSaving"
                @click="moveToArchive"
              />
              <Button
                v-if="canManageLifecycle"
                label="Move to trash"
                icon="pi pi-trash"
                severity="danger"
                outlined
                :loading="isSaving"
                @click="moveToTrash"
              />
            </div>
            <p v-if="lifecycleError" class="auth-message auth-message--error" role="alert">
              {{ lifecycleError }}
            </p>
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
        </div>

        <aside class="jo-detail-layout__aside">
          <section class="jo-detail-card" aria-labelledby="job-order-client-title">
            <h2 id="job-order-client-title" class="crm-section__title">Client</h2>
            <p class="jo-card-primary">{{ jobClientName }}</p>
            <p class="record-form__version"><MonoText :value="jobOrder.clientId" /></p>
          </section>

          <section class="jo-detail-card" aria-labelledby="job-order-vessel-title">
            <h2 id="job-order-vessel-title" class="crm-section__title">Vessel</h2>
            <p class="jo-card-primary">{{ jobVesselName }}</p>
            <p v-if="jobOrder.vessel?.imoNumber" class="record-form__version">
              IMO <MonoText :value="jobOrder.vessel.imoNumber" />
            </p>
          </section>

          <section class="jo-detail-card" aria-labelledby="job-order-commercial-title">
            <h2 id="job-order-commercial-title" class="crm-section__title">Commercial</h2>
            <dl class="detail-grid detail-grid--single">
              <div>
                <dt>Quoted amount</dt>
                <dd><span class="mx-money">{{ formatMoney({ amountMinor: jobOrder.quotedAmountMinor, currency: jobOrder.quotedCurrency }) }}</span></dd>
              </div>
              <div>
                <dt>Approved variations</dt>
                <dd><span class="mx-money">{{ moneyLabel(approvedVariationAmountMinor, jobOrder.quotedCurrency) }}</span></dd>
              </div>
              <div>
                <dt>Proposed variations</dt>
                <dd><span class="mx-money">{{ moneyLabel(proposedVariationAmountMinor, jobOrder.quotedCurrency) }}</span></dd>
              </div>
              <div>
                <dt>Projected total</dt>
                <dd><span class="mx-money">{{ moneyLabel(projectedTotalAmountMinor, jobOrder.quotedCurrency) }}</span></dd>
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
              <div v-if="jobOrder.state === 'CLOSED'">
                <dt>Amount earned</dt>
                <dd><span class="mx-money">{{ earnedMoneyLabel() }}</span></dd>
              </div>
              <div v-if="latestInvoice">
                <dt>Invoice</dt>
                <dd><MonoText :value="latestInvoice.invoiceNumber" /> · <span class="mx-money">{{ invoiceMoneyLabel(latestInvoice) }}</span></dd>
              </div>
            </dl>
          </section>

          <section class="jo-detail-card" aria-labelledby="job-order-assignment-title">
            <h2 id="job-order-assignment-title" class="crm-section__title">Assignment</h2>
            <dl class="detail-grid detail-grid--single">
              <div>
                <dt>Assigned technicians</dt>
                <dd>{{ assignedTechnicianNames(jobOrder) }}</dd>
              </div>
              <div>
                <dt>Execution owner</dt>
                <dd>{{ executionOwnerName(jobOrder) }}</dd>
              </div>
              <div v-if="jobOrder.state === 'IN_PROGRESS'">
                <dt>Device</dt>
                <dd>{{ historyDevice(startedHistory) }}</dd>
              </div>
              <div v-if="jobOrder.state === 'ON_HOLD'">
                <dt>Person working</dt>
                <dd>{{ historyActor(lastWorkerBeforePause) }}</dd>
              </div>
              <div v-if="jobOrder.state === 'ON_HOLD'">
                <dt>Device</dt>
                <dd>{{ historyDevice(lastWorkerBeforePause) }}</dd>
              </div>
              <div v-if="['PENDING_REVIEW', 'COMPLETED'].includes(jobOrder.state)">
                <dt>Submitted by</dt>
                <dd>{{ historyActor(submittedHistory) }}</dd>
              </div>
              <div v-if="['PENDING_REVIEW', 'COMPLETED'].includes(jobOrder.state)">
                <dt>Completion device</dt>
                <dd>{{ historyDevice(submittedHistory) }}</dd>
              </div>
            </dl>
          </section>

          <section class="jo-worklog-placeholder" aria-labelledby="job-order-worklog-title">
            <i class="ti ti-users" aria-hidden="true" />
            <div>
              <h2 id="job-order-worklog-title" class="crm-section__title">Technicians worked</h2>
              <p>Technician work-log breakdown is coming soon.</p>
            </div>
          </section>
        </aside>
      </div>

      <section v-if="isEditing" class="crm-section" aria-labelledby="job-order-header-title">
        <div class="crm-page__header">
          <h2 id="job-order-header-title" class="crm-section__title">Header</h2>
          <p v-if="!isHeaderEditable" class="record-form__version">
            Header locked from IN_PROGRESS onward. Add Variation for scope changes.
          </p>
          <Button label="Done" severity="secondary" outlined @click="cancelEditing" />
        </div>

        <form class="record-form" @submit.prevent="saveCategories">
          <p v-if="categoryError" class="auth-message auth-message--error" role="alert">
            {{ categoryError }}
          </p>
          <p v-if="categorySuccess" class="crm-empty" role="status">
            {{ categorySuccess }}
          </p>

          <label class="auth-field" for="jo-service-categories">
            <span>Service categories</span>
            <MultiSelect
              id="jo-service-categories"
              v-model="categoryForm.serviceCategories"
              class="record-form__select"
              :options="categoryOptions"
              option-label="label"
              option-value="value"
              display="chip"
              placeholder="Select categories"
            />
          </label>

          <div class="record-form__actions">
            <Button type="submit" label="Save categories" icon="pi pi-tags" :loading="isSaving" />
          </div>
        </form>

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

          <label class="auth-field" for="jo-planned-start">
            <span>Planned start</span>
            <input id="jo-planned-start" v-model="form.plannedStartDate" class="auth-input" type="date" />
          </label>

          <label class="auth-field" for="jo-deadline">
            <span>Deadline</span>
            <input id="jo-deadline" v-model="form.deadline" class="auth-input" type="date" />
            <FieldError :message="fieldErrors.deadline" />
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
            <dt>Planned start</dt>
            <dd>{{ formatDate(jobOrder.plannedStartDate) }}</dd>
          </div>
          <div>
            <dt>Deadline</dt>
            <dd>{{ formatDate(jobOrder.deadline) }}</dd>
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

    </template>

    <div v-if="showTransitionDialog && pendingTransition" class="version-dialog" role="presentation">
      <section class="version-dialog__panel" role="dialog" aria-modal="true" aria-labelledby="transition-title">
        <div class="version-dialog__header">
          <p class="version-dialog__eyebrow">State transition</p>
          <h2 id="transition-title" class="version-dialog__title">{{ pendingTransition.label }}</h2>
          <p class="version-dialog__copy">
            Send <MonoText :value="jobOrder?.joNumber" /> to <span class="jo-chip" :class="jobOrderStateMeta(pendingTransition.to).className">{{ jobOrderStateMeta(pendingTransition.to).label }}</span>
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

<style scoped>
.jo-detail-hero {
  align-items: flex-start;
  gap: 24px;
}

.jo-detail-hero__title {
  margin-top: 6px;
}

.jo-detail-hero__subtitle {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin: 8px 0 0;
  color: #5C7081;
  font-size: 13px;
}

.jo-detail-hero__actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
}

.jo-version-badge,
.jo-port-pill,
.jo-category-chip,
.jo-document-chip {
  display: inline-flex;
  align-items: center;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 500;
}

.jo-version-badge {
  padding: 2px 8px;
  background: #ECEFF2;
  color: #5C7081;
  font-family: 'IBM Plex Mono', ui-monospace, monospace;
}

.jo-detail-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(280px, 360px);
  gap: 16px;
  align-items: start;
}

.jo-detail-layout__main,
.jo-detail-layout__aside {
  display: grid;
  gap: 16px;
}

.jo-detail-card {
  padding: 18px;
  border: 0.5px solid #D3DCE3;
  border-radius: 8px;
  background: #FFFFFF;
}

.jo-detail-card__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}

.jo-port-pill {
  padding: 3px 10px;
  background: #E2EFFC;
  color: #0F4C92;
}

.jo-chip-list,
.jo-document-chip-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.jo-category-chip {
  padding: 3px 10px;
  background: #F4F7FA;
  color: #34495C;
}

.jo-scope-copy {
  margin: 14px 0;
  color: #11202E;
  line-height: 1.55;
}

.jo-reason {
  margin: 14px 0 0;
  padding: 10px 12px;
  border-radius: 8px;
  background: #FBF1C9;
  color: #7A5A00;
  font-size: 13px;
}

.detail-grid--compact {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.detail-grid--single {
  grid-template-columns: 1fr;
}

.jo-document-chip {
  gap: 6px;
  padding: 5px 10px;
  background: #F4F7FA;
  color: #34495C;
}

.jo-history-list {
  display: grid;
  gap: 14px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.jo-history-item {
  display: grid;
  grid-template-columns: 12px 1fr;
  gap: 10px;
}

.jo-history-item__dot {
  width: 8px;
  height: 8px;
  margin-top: 6px;
  border-radius: 999px;
  background: #0B2A4A;
}

.jo-history-item p {
  margin: 0;
}

.jo-history-item__state {
  display: inline-flex;
  align-items: center;
  margin-left: 2px;
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 500;
}

.jo-history-item__meta,
.jo-history-item__reason {
  margin-top: 4px;
  color: #5C7081;
  font-size: 12px;
}

.jo-card-primary {
  margin: 8px 0 4px;
  color: #11202E;
  font-size: 16px;
  font-weight: 600;
}

.jo-worklog-placeholder {
  display: flex;
  gap: 10px;
  padding: 12px;
  border: 0.5px dashed #C2CCD4;
  border-radius: 8px;
  background: #F4F7FA;
}

.jo-worklog-placeholder i {
  color: #8B98A3;
  font-size: 18px;
}

.jo-worklog-placeholder p {
  margin: 6px 0 0;
  color: #8B98A3;
  font-style: italic;
}

@media (max-width: 960px) {
  .jo-detail-layout {
    grid-template-columns: 1fr;
  }

  .detail-grid--compact {
    grid-template-columns: 1fr;
  }

  .jo-detail-hero__actions {
    justify-content: flex-start;
  }
}
</style>
