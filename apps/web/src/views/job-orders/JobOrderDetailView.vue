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
import { get, post } from '@/lib/api/client';
import { ApiResponseError } from '@/lib/api/errors';
import type { BrandingSettings, Invoice, JobOrder, JobOrderEditHistoryEntry, JobOrderMaterialLine, JobOrderObservation, JobState, JobStatusHistoryEntry, Variation, VariationStatus } from '@/lib/api/types';
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

interface JobDocument {
  id: string;
  ownerType: 'JOB';
  ownerId: string;
  filename: string;
  mimeType: string;
  s3Key: string;
  uploadedById?: string | null;
  createdAt?: string | null;
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
const isReportRegenerating = ref(false);
const invoicePdfError = ref<string | null>(null);
const invoicePdfUrl = ref<string | null>(null);
const isInvoicePdfLoading = ref(false);
const completionError = ref<string | null>(null);
const savingCompletionId = ref<string | null>(null);
const jobDocuments = ref<JobDocument[]>([]);
const showJobDocuments = ref(false);
const isLoadingJobDocuments = ref(false);
const jobDocumentsError = ref<string | null>(null);
const hasLoadedJobDocuments = ref(false);
const brandingSettings = ref<BrandingSettings | null>(null);
const brandingError = ref<string | null>(null);
const brandingSuccess = ref<string | null>(null);
const isSavingLogoOverride = ref(false);
const clientLinkUrl = ref<string | null>(null);
const clientLinkMessage = ref<string | null>(null);
const clientLinkError = ref<string | null>(null);
const isClientLinkLoading = ref(false);
const categoryOptions = computed(() => checklistCategoriesStore.options);
const apiBase = import.meta.env.VITE_API_BASE as string;

const officeRoles = ['OPS_SUPERVISOR', 'SYSTEM_ADMIN', 'DIRECTOR'];
const schedulerRoles = ['SYSTEM_ADMIN', 'DIRECTOR'];
const financeRoles = ['FINANCE', 'SYSTEM_ADMIN', 'DIRECTOR'];
const cancelRoles = ['OPS_SUPERVISOR', 'SYSTEM_ADMIN', 'DIRECTOR'];
const variationCreateRoles = ['SYSTEM_ADMIN', 'OPS_SUPERVISOR', 'DIRECTOR'];
const terminalVariationStates: JobState[] = ['CLOSED', 'CANCELLED'];
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
const isAdmin = computed(() => roles.value.includes('SYSTEM_ADMIN'));
const canManageJobLogo = computed(() => roles.value.some((role) => ['SYSTEM_ADMIN', 'DIRECTOR'].includes(role)));
const canApproveVariation = computed(() => roles.value.some((role) => variationApproveRoles.includes(role)));
const canRejectVariation = computed(() => roles.value.some((role) => variationRejectRoles.includes(role)));
const canManageLifecycle = computed(() => roles.value.some((role) => lifecycleRoles.includes(role)));
const isHeaderEditable = computed(() => jobOrder.value?.state === 'DRAFT' || jobOrder.value?.state === 'SCHEDULED');
const canEditJobOrderForm = computed(() => isHeaderEditable.value && roles.value.some((role) => officeRoles.includes(role)));
const canShareJobOrder = computed(() => roles.value.some((role) => officeRoles.includes(role)));
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
const submittedHistory = computed(() => firstHistoryTo('PENDING_REVIEW'));
const completedHistory = computed(() => firstHistoryTo('COMPLETED'));
const cancelledHistory = computed(() => lastHistoryTo('CANCELLED'));
const pausedHistory = computed(() => lastHistoryTo('ON_HOLD'));
const latestInvoice = computed(() => jobOrder.value?.invoices?.[0] ?? null);
const earnedAmount = computed(() => {
  const invoice = latestInvoice.value;
  if (!invoice) return null;
  const paidMinor = (invoice.payments ?? []).reduce((total, payment) => total + payment.amountMinor, 0);
  return { amountMinor: paidMinor || invoice.totalAmountMinor, currency: invoice.totalCurrency };
});
const jobClientName = computed(() => jobOrder.value?.client?.name ?? 'Unnamed client');
const jobVesselName = computed(() => jobOrder.value?.vessel?.name ?? 'Unnamed vessel');
const jobVesselImo = computed(() => displayImo(jobOrder.value?.vessel?.imoNumber));
const categoryLabels = computed(() =>
  (jobOrder.value?.serviceCategories ?? []).map((category) =>
    categoryOptions.value.find((option) => option.value === category)?.label ?? category,
  ),
);
const availableLogoFilenames = computed(() => brandingSettings.value?.availableLogoFilenames ?? []);
// Photo.jobOrderId is a direct FK (prisma/schema.prisma) — there is no Photo.observationId, so
// every photo captured on this job (whether or not a technician also referenced it from an
// Observation on mobile) is already in this flat list. No per-observation aggregation needed.
const completionPhotos = computed(() => jobOrder.value?.photos ?? []);
const recentHistory = computed(() => [
  ...sortedHistory.value.map((entry) => ({ id: `status-${entry.id}`, type: 'status' as const, at: entry.at, entry })),
  ...(jobOrder.value?.editHistory ?? []).map((entry) => ({ id: `edit-${entry.id}`, type: 'edit' as const, at: entry.createdAt, entry })),
].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime()));
const canCreateVariation = computed(() => {
  const state = jobOrder.value?.state;
  return Boolean(
    state
    && !terminalVariationStates.includes(state)
    && roles.value.some((role) => variationCreateRoles.includes(role)),
  );
});
const variationCreateHelper = computed(() =>
  roles.value.some((role) => ['SYSTEM_ADMIN', 'DIRECTOR'].includes(role))
    ? 'Director/Admin variations are approved immediately. Ops variations remain proposed.'
    : 'New variations are submitted as PROPOSED.',
);
const canGenerateCompletionOutput = computed(() => jobOrder.value?.state === 'COMPLETED');
const canViewClosedOutput = computed(() => jobOrder.value?.state === 'CLOSED');
const canUseCompletionReport = computed(() => jobOrder.value ? ['COMPLETED', 'INVOICED', 'CLOSED'].includes(jobOrder.value.state) : false);
const canRegenerateReport = computed(() =>
  canUseCompletionReport.value
  && Boolean(jobOrder.value?.reportObjectKey)
  && roles.value.some((role) => ['SYSTEM_ADMIN', 'DIRECTOR'].includes(role)),
);
const canUseInvoicePdf = computed(() => Boolean(latestInvoice.value) && Boolean(jobOrder.value && ['COMPLETED', 'INVOICED', 'CLOSED'].includes(jobOrder.value.state)));
const canOpenInvoiceDraft = computed(() => latestInvoice.value?.status === 'DRAFT');
const showRenewAction = computed(() => jobOrder.value?.state === 'CANCELLED');
const showCompletionDetails = computed(() => jobOrder.value ? ['PENDING_REVIEW', 'COMPLETED', 'INVOICED', 'CLOSED'].includes(jobOrder.value.state) : false);
const canEditCompletionDetails = computed(() =>
  jobOrder.value?.state === 'PENDING_REVIEW'
  && roles.value.some((role) => ['SYSTEM_ADMIN', 'DIRECTOR'].includes(role)),
);

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

function brandingAssetUrl(filename: string): string {
  return `${apiBase}/branding-settings/assets/${encodeURIComponent(filename)}`;
}

function materialLineTotal(line: JobOrderMaterialLine): number {
  return Math.round(Number(line.quantity) * line.unitCostAmountMinor);
}

function materialQuantityLabel(quantity: string | number): string {
  const numeric = Number(quantity);
  return Number.isFinite(numeric) ? numeric.toLocaleString(undefined, { maximumFractionDigits: 3 }) : String(quantity);
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

function displayImo(value?: string | null): string {
  if (!value || value.startsWith('MANUAL-')) return '';
  return value;
}

function historyActor(entry?: JobStatusHistoryEntry | null): string {
  return entry?.actor?.name ?? entry?.actor?.email ?? 'Unknown user';
}

function editHistoryActor(entry?: JobOrderEditHistoryEntry | null): string {
  return entry?.actor?.name ?? entry?.actor?.email ?? 'Unknown user';
}

function historyDevice(entry?: JobStatusHistoryEntry | null): string {
  return entry?.device?.name ?? (entry?.deviceId ? 'Unknown device' : '—');
}

function historyDeviceSuffix(entry?: JobStatusHistoryEntry | null): string {
  const device = historyDevice(entry);
  return device === '—' ? '' : ` (${device})`;
}

function variationApprover(variation: Variation): string {
  return variation.approver?.name ?? variation.approver?.email ?? (variation.approverId ? 'Unknown approver' : '—');
}

function editFieldLabel(field: string): string {
  const labels: Record<string, string> = {
    branch: 'Branch',
    clientId: 'Client',
    vesselId: 'Vessel',
    vendorId: 'Vendor',
    isSubcontracted: 'Subcontracted',
    serviceCategories: 'Service categories',
    port: 'Port',
    plannedStartDate: 'Planned start',
    deadline: 'Deadline',
    scopeSummary: 'Scope summary',
    externalQuoteRef: 'External quote ref',
    externalRfqRef: 'External RFQ ref',
    quotedAmountMinor: 'Quoted amount',
    quotedCurrency: 'Currency',
  };
  return labels[field] ?? field.replace(/([A-Z])/g, ' $1').replace(/^./, (char) => char.toUpperCase());
}

function editValueLabel(value: unknown): string {
  if (value == null || value === '') return '—';
  if (Array.isArray(value)) return value.length ? value.join(', ') : '—';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
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
  completionError.value = null;
  if (['COMPLETED', 'INVOICED', 'CLOSED'].includes(loaded.state) && loaded.reportObjectKey) {
    void refreshReportUrl();
  }
  const invoice = loaded.invoices?.[0] ?? null;
  if (invoice?.pdfObjectKey) {
    void refreshInvoicePdfUrl();
  }
}

async function loadBrandingSettings(): Promise<void> {
  brandingError.value = null;
  try {
    brandingSettings.value = await get<BrandingSettings>('/branding-settings');
  } catch (error) {
    brandingError.value = error instanceof ApiResponseError ? error.message : 'Unable to load logo choices.';
  }
}

async function saveLogoOverride(logoOverride: string | null): Promise<void> {
  if (!jobOrder.value || !canManageJobLogo.value) return;
  if ((jobOrder.value.logoOverride ?? null) === logoOverride) return;
  brandingError.value = null;
  brandingSuccess.value = null;
  isSavingLogoOverride.value = true;
  try {
    const updated = await jobOrdersStore.updateJobOrder(jobOrder.value.id, {
      version: jobOrder.value.version,
      logoOverride,
    });
    jobOrder.value = updated;
    brandingSuccess.value = 'Report logo saved.';
  } catch (error) {
    brandingError.value = error instanceof ApiResponseError ? error.message : 'Unable to save report logo.';
  } finally {
    isSavingLogoOverride.value = false;
  }
}

async function saveChecklistItem(itemId: string, checked: boolean): Promise<void> {
  if (!jobOrder.value) return;
  completionError.value = null;
  savingCompletionId.value = itemId;
  try {
    await jobOrdersStore.updateChecklistItem(jobOrder.value.id, itemId, checked);
    await loadJobOrder(false);
  } catch (error) {
    completionError.value = error instanceof ApiResponseError ? error.message : 'Unable to save checklist item.';
  } finally {
    savingCompletionId.value = null;
  }
}

async function saveObservation(observation: JobOrderObservation): Promise<void> {
  if (!jobOrder.value) return;
  completionError.value = null;
  savingCompletionId.value = observation.id;
  try {
    await jobOrdersStore.updateObservation(jobOrder.value.id, observation.id, observation.body);
    await loadJobOrder(false);
  } catch (error) {
    completionError.value = error instanceof ApiResponseError ? error.message : 'Unable to save observation.';
  } finally {
    savingCompletionId.value = null;
  }
}

async function saveMaterial(line: JobOrderMaterialLine): Promise<void> {
  if (!jobOrder.value) return;
  completionError.value = null;
  savingCompletionId.value = line.id;
  try {
    await jobOrdersStore.updateMaterial(jobOrder.value.id, line.id, {
      description: line.description,
      quantity: Number(line.quantity),
      unit: line.unit,
      unitCostAmountMinor: line.unitCostAmountMinor,
      unitCostCurrency: line.unitCostCurrency,
    });
    await loadJobOrder(false);
  } catch (error) {
    completionError.value = error instanceof ApiResponseError ? error.message : 'Unable to save material line.';
  } finally {
    savingCompletionId.value = null;
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

async function regenerateReport(): Promise<void> {
  if (!jobOrder.value) return;
  reportError.value = null;
  isReportRegenerating.value = true;
  try {
    await post<{ status: 'QUEUED' }, Record<string, never>>(`/job-orders/${jobOrder.value.id}/report/regenerate`, {});
    await loadJobOrder(false);
  } catch (error) {
    reportError.value = error instanceof ApiResponseError ? error.message : 'Unable to regenerate completion report.';
  } finally {
    isReportRegenerating.value = false;
  }
}

async function requestClientLink(): Promise<void> {
  if (!jobOrder.value) return;
  clientLinkError.value = null;
  clientLinkMessage.value = null;
  isClientLinkLoading.value = true;
  try {
    const result = await post<{ url: string }, Record<string, never>>(`/job-orders/${jobOrder.value.id}/share-link`, {});
    clientLinkUrl.value = result.url;
    await navigator.clipboard.writeText(result.url);
    clientLinkMessage.value = 'Client link copied to clipboard.';
  } catch (error) {
    clientLinkError.value = error instanceof ApiResponseError ? error.message : 'Unable to generate client link.';
  } finally {
    isClientLinkLoading.value = false;
  }
}

async function copyClientLink(): Promise<void> {
  if (clientLinkUrl.value) {
    clientLinkError.value = null;
    await navigator.clipboard.writeText(clientLinkUrl.value);
    clientLinkMessage.value = 'Client link copied to clipboard.';
    return;
  }
  await requestClientLink();
}

async function regenerateClientLink(): Promise<void> {
  const proceed = window.confirm('Regenerating the client link will immediately stop the old link from working. Continue?');
  if (!proceed) return;
  await requestClientLink();
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

async function loadJobDocuments(): Promise<void> {
  if (!jobOrder.value) return;
  isLoadingJobDocuments.value = true;
  jobDocumentsError.value = null;
  try {
    jobDocuments.value = await get<JobDocument[]>(`/documents?ownerType=JOB&ownerId=${encodeURIComponent(jobOrder.value.id)}`);
    hasLoadedJobDocuments.value = true;
  } catch (error) {
    jobDocumentsError.value = error instanceof ApiResponseError ? error.message : 'Unable to load job documents.';
  } finally {
    isLoadingJobDocuments.value = false;
  }
}

async function toggleJobDocuments(): Promise<void> {
  showJobDocuments.value = !showJobDocuments.value;
  if (showJobDocuments.value && !hasLoadedJobDocuments.value) await loadJobDocuments();
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
    unit: 'pcs',
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
    await Promise.all([checklistCategoriesStore.load(), loadBrandingSettings()]);
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
    await Promise.all([checklistCategoriesStore.load(), loadBrandingSettings(), loadJobOrder()]);
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
          <Button
            v-if="canShareJobOrder"
            :label="clientLinkUrl ? 'Copy client link' : 'Get client link'"
            icon="pi pi-link"
            severity="secondary"
            outlined
            :loading="isClientLinkLoading"
            @click="copyClientLink"
          />
          <Button
            v-if="canShareJobOrder && clientLinkUrl"
            label="Regenerate link"
            icon="pi pi-refresh"
            severity="secondary"
            text
            :loading="isClientLinkLoading"
            @click="regenerateClientLink"
          />
          <Button
            v-if="canEditJobOrderForm"
            label="Edit"
            icon="pi pi-pencil"
            severity="secondary"
            outlined
            @click="router.push(`/job-orders/${jobOrder.id}/edit`)"
          />
        </div>
      </header>

      <p v-if="clientLinkMessage" class="crm-empty" role="status">{{ clientLinkMessage }}</p>
      <p v-if="clientLinkError" class="auth-message auth-message--error" role="alert">{{ clientLinkError }}</p>

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
              <div>
                <h2 id="job-order-variations-title" class="crm-section__title">Variations</h2>
                <p class="record-form__version">{{ variationCreateHelper }}</p>
              </div>
              <Button v-if="canCreateVariation" label="Add Variation" icon="pi pi-plus" severity="secondary" @click="openVariationForm" />
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
                  :currency="variationCurrency"
                  :can-remove="variationLines.length > 1"
                  @remove="removeVariationLine"
                />
              </div>
              <FieldError :message="variationLineError" />

              <p class="record-form__version">
                Computed amount <span class="mx-money">{{ moneyLabel(variationDraftAmountMinor, variationCurrency) }}</span>
              </p>

              <div class="record-form__actions jo-variation-form__actions">
                <Button label="Add line" severity="secondary" type="button" @click="addVariationLine" />
                <Button label="Cancel" severity="secondary" type="button" @click="showVariationForm = false" />
                <Button label="Submit variation" icon="pi pi-save" type="submit" :loading="isSaving" />
              </div>
            </form>

            <div v-if="variations.length" class="variation-list">
              <article v-for="(variation, index) in variations" :key="variation.id" class="variation-item">
                <div class="variation-item__header">
                  <div>
                    <p class="record-form__version">
                      Variation #{{ variations.length - index }}
                      <template v-if="isAdmin">
                        · ID <MonoText :value="variation.id" />
                      </template>
                    </p>
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
                    <dd>{{ variationApprover(variation) }}</dd>
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

          <section
            class="jo-detail-card"
            aria-labelledby="job-order-output-title"
          >
            <div class="jo-detail-card__header">
              <h2 id="job-order-output-title" class="crm-section__title">Documents</h2>
            </div>
            <div class="jo-output-groups">
              <div class="jo-output-group">
                <h3>Job Documents</h3>
                <button
                  type="button"
                  class="jo-document-chip"
                  :aria-expanded="showJobDocuments"
                  @click="toggleJobDocuments"
                >
                  <i class="ti ti-file-text" aria-hidden="true" />
                  Job documents
                </button>

                <p v-if="jobDocumentsError" class="auth-message auth-message--error" role="alert">
                  {{ jobDocumentsError }}
                </p>
                <p v-else-if="isLoadingJobDocuments" class="crm-empty">Loading documents...</p>
                <ul v-else-if="showJobDocuments && jobDocuments.length" class="jo-document-list">
                  <li v-for="document in jobDocuments" :key="document.id">
                    <i class="ti ti-file-text" aria-hidden="true" />
                    <span>
                      <strong>{{ document.filename }}</strong>
                      <small>{{ document.mimeType }}<template v-if="document.createdAt"> · {{ formatDateTime(document.createdAt) }}</template></small>
                    </span>
                  </li>
                </ul>
                <p v-else-if="showJobDocuments" class="crm-empty">No documents.</p>
              </div>

              <div class="jo-output-group">
                <h3>Report</h3>
                <div v-if="canUseCompletionReport" class="record-form__actions record-form__actions--left">
                  <Button
                    :label="reportUrl || jobOrder.reportObjectKey ? 'Preview report' : 'Generating...'"
                    icon="pi pi-file-pdf"
                    severity="secondary"
                    :loading="isReportLoading"
                    :disabled="!jobOrder.reportObjectKey"
                    @click="openReport"
                  />
                  <Button
                    v-if="jobOrder.reportObjectKey"
                    label="Download report"
                    icon="pi pi-download"
                    severity="secondary"
                    :loading="isReportLoading"
                    @click="downloadReport"
                  />
                  <Button
                    v-if="canRegenerateReport"
                    label="Regenerate report"
                    icon="pi pi-refresh"
                    severity="secondary"
                    :loading="isReportRegenerating"
                    @click="regenerateReport"
                  />
                </div>
                <p v-else class="crm-empty">Completion report is not available yet.</p>
              </div>

              <div class="jo-output-group">
                <h3>Invoice</h3>
                <div v-if="canOpenInvoiceDraft || (canGenerateCompletionOutput && latestInvoice) || canViewClosedOutput || canUseInvoicePdf" class="record-form__actions record-form__actions--left">
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
                </div>
                <p v-else class="crm-empty">Invoice is not available yet.</p>
              </div>

              <div v-if="showRenewAction" class="jo-output-group">
                <h3>Renewal</h3>
                <div class="record-form__actions record-form__actions--left">
                  <Button label="Renew" icon="pi pi-refresh" severity="secondary" @click="router.push('/job-orders/new')" />
                </div>
              </div>
            </div>
            <p v-if="reportError" class="auth-message auth-message--error" role="alert">
              {{ reportError }}
            </p>
            <p v-if="invoicePdfError" class="auth-message auth-message--error" role="alert">
              {{ invoicePdfError }}
            </p>
          </section>

          <section v-if="showCompletionDetails" class="jo-detail-card" aria-labelledby="job-order-completion-title">
            <div class="jo-detail-card__header">
              <div>
                <h2 id="job-order-completion-title" class="crm-section__title">Completion details</h2>
                <p class="record-form__version">
                  {{ canEditCompletionDetails ? 'Director/Admin review edits are available before completion.' : 'Read-only execution capture.' }}
                </p>
              </div>
            </div>

            <p v-if="completionError" class="auth-message auth-message--error" role="alert">
              {{ completionError }}
            </p>

            <div class="completion-details">
              <section class="completion-details__panel" aria-labelledby="completion-checklist-title">
                <h3 id="completion-checklist-title">Checklist</h3>
                <p v-if="!jobOrder.checklistItems?.length" class="crm-empty">No checklist items captured.</p>
                <ul v-else class="completion-checklist">
                  <li v-for="item in jobOrder.checklistItems" :key="item.id" class="completion-checklist__item">
                    <label class="completion-checklist__label">
                      <input
                        v-model="item.checked"
                        type="checkbox"
                        :disabled="!canEditCompletionDetails || savingCompletionId === item.id"
                        @change="saveChecklistItem(item.id, item.checked)"
                      />
                      <span>{{ item.label }}</span>
                    </label>
                    <span class="record-form__version">{{ item.checked ? 'Checked' : 'Unticked' }}</span>
                  </li>
                </ul>
              </section>

              <section class="completion-details__panel" aria-labelledby="completion-observations-title">
                <h3 id="completion-observations-title">Observations</h3>
                <p v-if="!jobOrder.observations?.length" class="crm-empty">No observations captured.</p>
                <article v-for="observation in jobOrder.observations" :key="observation.id" class="completion-entry">
                  <textarea
                    v-if="canEditCompletionDetails"
                    v-model="observation.body"
                    class="auth-input record-form__textarea completion-entry__textarea"
                    :disabled="savingCompletionId === observation.id"
                  />
                  <p v-else>{{ observation.body }}</p>
                  <div class="completion-entry__meta">
                    <span>{{ formatDateTime(observation.createdAt) }}</span>
                    <Button
                      v-if="canEditCompletionDetails"
                      label="Save"
                      size="small"
                      severity="secondary"
                      :loading="savingCompletionId === observation.id"
                      @click="saveObservation(observation)"
                    />
                  </div>
                </article>
              </section>

              <section class="completion-details__panel" aria-labelledby="completion-photos-title">
                <h3 id="completion-photos-title">Photos</h3>
                <p v-if="!completionPhotos.length" class="crm-empty">No photos captured.</p>
                <div v-else class="completion-photo-grid">
                  <figure v-for="photo in completionPhotos" :key="photo.id" class="completion-photo">
                    <img v-if="photo.url" :src="photo.url" :alt="`${photo.phase} photo`" />
                    <div v-else class="completion-photo__placeholder">
                      <i class="ti ti-photo" aria-hidden="true" />
                    </div>
                    <figcaption>
                      {{ photo.phase }} · {{ formatDateTime(photo.takenAt) }}
                    </figcaption>
                  </figure>
                </div>
              </section>

              <section class="completion-details__panel" aria-labelledby="completion-materials-title">
                <h3 id="completion-materials-title">Materials</h3>
                <p v-if="!jobOrder.materials?.length" class="crm-empty">No materials captured.</p>
                <div v-else class="completion-material-list">
                  <article v-for="line in jobOrder.materials" :key="line.id" class="completion-material">
                    <template v-if="canEditCompletionDetails">
                      <label class="auth-field" :for="`completion-material-description-${line.id}`">
                        <span>Description</span>
                        <input :id="`completion-material-description-${line.id}`" v-model="line.description" class="auth-input" />
                      </label>
                      <label class="auth-field" :for="`completion-material-quantity-${line.id}`">
                        <span>Qty</span>
                        <input :id="`completion-material-quantity-${line.id}`" v-model.number="line.quantity" class="auth-input mono-input" type="number" min="0" step="0.001" />
                      </label>
                      <label class="auth-field" :for="`completion-material-unit-${line.id}`">
                        <span>Unit</span>
                        <input :id="`completion-material-unit-${line.id}`" v-model="line.unit" class="auth-input" />
                      </label>
                      <label class="auth-field" :for="`completion-material-cost-${line.id}`">
                        <span>Unit cost</span>
                        <input :id="`completion-material-cost-${line.id}`" v-model.number="line.unitCostAmountMinor" class="auth-input mono-input" type="number" min="0" step="1" />
                      </label>
                      <label class="auth-field" :for="`completion-material-currency-${line.id}`">
                        <span>Currency</span>
                        <input :id="`completion-material-currency-${line.id}`" v-model="line.unitCostCurrency" class="auth-input mono-input" />
                      </label>
                      <div class="completion-material__actions">
                        <span class="mx-money">{{ moneyLabel(materialLineTotal(line), line.unitCostCurrency) }}</span>
                        <Button
                          label="Save"
                          size="small"
                          severity="secondary"
                          :loading="savingCompletionId === line.id"
                          @click="saveMaterial(line)"
                        />
                      </div>
                    </template>
                    <template v-else>
                      <div>
                        <strong>{{ line.description }}</strong>
                        <p class="record-form__version">
                          {{ materialQuantityLabel(line.quantity) }} {{ line.unit }} ·
                          {{ moneyLabel(line.unitCostAmountMinor, line.unitCostCurrency) }} each
                        </p>
                      </div>
                      <span class="mx-money">{{ moneyLabel(materialLineTotal(line), line.unitCostCurrency) }}</span>
                    </template>
                  </article>
                </div>
              </section>

              <section class="completion-details__panel" aria-labelledby="completion-signature-title">
                <h3 id="completion-signature-title">Signature</h3>
                <p v-if="!jobOrder.signature" class="crm-empty">No signature captured.</p>
                <article v-else class="completion-signature">
                  <img v-if="jobOrder.signature.imageUrl" :src="jobOrder.signature.imageUrl" alt="Captured signature" />
                  <div v-else class="completion-photo__placeholder">
                    <i class="ti ti-signature" aria-hidden="true" />
                  </div>
                  <div>
                    <strong>{{ jobOrder.signature.signerName ?? 'Signer pending' }}</strong>
                    <p class="record-form__version">
                      {{ jobOrder.signature.signerRole ?? 'Role pending' }} · {{ formatDateTime(jobOrder.signature.signedAt) }}
                    </p>
                  </div>
                </article>
              </section>
            </div>
          </section>

          <section class="jo-detail-card" aria-labelledby="job-order-history-title">
            <div class="jo-detail-card__header">
              <h2 id="job-order-history-title" class="crm-section__title">History</h2>
            </div>
            <ol v-if="recentHistory.length" class="jo-history-list">
              <li v-for="event in recentHistory" :key="event.id" class="jo-history-item">
                <span class="jo-history-item__dot" aria-hidden="true" />
                <div v-if="event.type === 'status'">
                  <p>
                    Moved to
                    <span class="jo-history-item__state" :class="jobOrderStateMeta(event.entry.toState).className">
                      {{ jobOrderStateMeta(event.entry.toState).label }}
                    </span>
                  </p>
                  <p class="jo-history-item__meta">
                    {{ historyActor(event.entry) }}{{ historyDeviceSuffix(event.entry) }} · {{ formatRelativeTime(event.entry.at) }}
                    <span :title="formatDateTime(event.entry.at)">· {{ formatDateTime(event.entry.at) }}</span>
                  </p>
                  <p v-if="event.entry.reason" class="jo-history-item__reason">
                    {{ event.entry.reason }}
                  </p>
                </div>
                <div v-else>
                  <p>Edited job order</p>
                  <p class="jo-history-item__meta">
                    {{ editHistoryActor(event.entry) }} · {{ formatRelativeTime(event.entry.createdAt) }}
                    <span :title="formatDateTime(event.entry.createdAt)">· {{ formatDateTime(event.entry.createdAt) }}</span>
                  </p>
                  <ul class="jo-history-edit-list">
                    <li v-for="change in event.entry.changedFields" :key="`${event.entry.id}-${change.field}`">
                      <strong>{{ editFieldLabel(change.field) }}:</strong>
                      <span>{{ editValueLabel(change.oldValue) }}</span>
                      <span aria-hidden="true">→</span>
                      <span>{{ editValueLabel(change.newValue) }}</span>
                    </li>
                  </ul>
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
            <p v-if="isAdmin" class="record-form__version jo-technical-id">
              Client ID <MonoText :value="jobOrder.clientId" />
            </p>
          </section>

          <section class="jo-detail-card" aria-labelledby="job-order-vessel-title">
            <h2 id="job-order-vessel-title" class="crm-section__title">Vessel</h2>
            <p class="jo-card-primary">{{ jobVesselName }}</p>
            <p v-if="isAdmin" class="record-form__version jo-technical-id">
              Vessel ID <MonoText :value="jobOrder.vesselId" />
            </p>
            <p v-if="jobVesselImo" class="record-form__version">
              IMO <MonoText :value="jobVesselImo" />
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

          <section class="jo-detail-card" aria-labelledby="job-order-logo-title">
            <h2 id="job-order-logo-title" class="crm-section__title">Report logo</h2>
            <p class="record-form__version">
              {{ jobOrder.logoOverride ? `Override: ${jobOrder.logoOverride}` : 'Using global Branding setting' }}
            </p>
            <p v-if="brandingError" class="auth-message auth-message--error" role="alert">{{ brandingError }}</p>
            <p v-if="brandingSuccess" class="auth-message auth-message--success" role="status">{{ brandingSuccess }}</p>
            <div v-if="canManageJobLogo" class="jo-logo-picker">
              <button
                type="button"
                class="jo-logo-picker__card"
                :class="{ 'jo-logo-picker__card--active': !jobOrder.logoOverride }"
                :disabled="isSavingLogoOverride"
                @click="saveLogoOverride(null)"
              >
                <span class="jo-logo-picker__placeholder">Global default</span>
                <span class="branding-logo-card__name">Use default</span>
              </button>
              <button
                v-for="filename in availableLogoFilenames"
                :key="filename"
                type="button"
                class="jo-logo-picker__card"
                :class="{ 'jo-logo-picker__card--active': filename === jobOrder.logoOverride }"
                :disabled="isSavingLogoOverride"
                @click="saveLogoOverride(filename)"
              >
                <span class="branding-logo-card__image">
                  <img :src="brandingAssetUrl(filename)" :alt="filename" />
                </span>
                <span class="branding-logo-card__name">{{ filename }}</span>
              </button>
            </div>
          </section>

          <section class="jo-worker-roster" aria-labelledby="job-order-worker-title">
            <div class="jo-detail-card__header">
              <h2 id="job-order-worker-title" class="crm-section__title">Technicians worked</h2>
            </div>
            <p v-if="!jobOrder.workers?.length" class="crm-empty">No technicians logged.</p>
            <ul v-else class="jo-worker-roster__list">
              <li v-for="worker in jobOrder.workers" :key="worker.id">
                <span class="pi pi-user" aria-hidden="true" />
                <span>{{ worker.name }}</span>
              </li>
            </ul>
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
  min-width: 0;
}

.jo-detail-card {
  padding: 18px;
  border: 0.5px solid #D3DCE3;
  border-radius: 8px;
  background: #FFFFFF;
  min-width: 0;
}

.jo-detail-card__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}

.jo-variation-form__actions {
  margin-bottom: var(--sp-4);
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
  width: fit-content;
  gap: 6px;
  padding: 5px 10px;
  border: 0;
  border-radius: 999px;
  background: #F4F7FA;
  color: #34495C;
  cursor: pointer;
  font: inherit;
}

.jo-document-chip:hover {
  background: #EAF2FA;
}

.jo-output-groups {
  display: grid;
  gap: 12px;
}

.jo-output-group {
  display: grid;
  gap: 10px;
  padding: 12px;
  border: 0.5px solid #D3DCE3;
  border-radius: 8px;
  background: #FFFFFF;
}

.jo-output-group h3 {
  margin: 0;
  color: #34495C;
  font-size: 13px;
  font-weight: 600;
}

.jo-document-list {
  display: grid;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.jo-document-list li {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px;
  border-radius: 8px;
  background: #F4F7FA;
}

.jo-document-list i {
  color: #5C7081;
}

.jo-document-list span {
  min-width: 0;
  display: grid;
  gap: 2px;
}

.jo-document-list strong,
.jo-document-list small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.jo-document-list strong {
  color: #11202E;
  font-size: 13px;
}

.jo-document-list small {
  color: #5C7081;
  font-size: 12px;
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

.jo-history-edit-list {
  display: grid;
  gap: 4px;
  margin: 6px 0 0;
  padding: 0;
  list-style: none;
  color: #34495C;
  font-size: 12px;
}

.jo-history-edit-list li {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.jo-card-primary {
  margin: 8px 0 4px;
  color: #11202E;
  font-size: 16px;
  font-weight: 600;
}

.jo-technical-id {
  color: #5C7081;
  font-size: 12px;
}

.jo-logo-picker {
  display: grid;
  gap: var(--sp-2);
}

.jo-logo-picker__card {
  display: grid;
  gap: var(--sp-2);
  justify-items: start;
  padding: var(--sp-2);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
  color: var(--color-text);
  cursor: pointer;
  text-align: left;
}

.jo-logo-picker__card--active {
  border-color: var(--color-brand);
  box-shadow: inset 3px 0 0 var(--color-brand);
}

.jo-logo-picker__card:disabled {
  cursor: wait;
  opacity: 0.7;
}

.branding-logo-card__image,
.jo-logo-picker__placeholder {
  width: 100%;
  min-height: 54px;
  display: grid;
  place-items: center;
  border-radius: var(--radius-sm);
  background: #F4F7FA;
}

.branding-logo-card__image img {
  max-width: 100%;
  max-height: 48px;
  object-fit: contain;
}

.branding-logo-card__name {
  color: #5C7081;
  font-size: 12px;
  overflow-wrap: anywhere;
}

.jo-logo-picker__placeholder {
  color: #5C7081;
  font-size: 12px;
  font-style: italic;
}

.jo-worker-roster {
  display: grid;
  gap: 10px;
  padding: 12px;
  border: 0.5px solid #D3DCE3;
  border-radius: 8px;
  background: #FFFFFF;
}

.jo-worker-roster__list {
  display: grid;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.jo-worker-roster__list li {
  display: flex;
  align-items: center;
  gap: 8px;
  color: #11202E;
  font-size: 13px;
}

.jo-worker-roster__list .pi {
  color: #5C7081;
  font-size: 14px;
}

.completion-details {
  display: grid;
  gap: 14px;
}

.completion-details__panel {
  display: grid;
  gap: 10px;
  padding: 12px;
  border: 0.5px solid #D3DCE3;
  border-radius: 8px;
  background: #FFFFFF;
}

.completion-details__panel h3 {
  margin: 0;
  color: #11202E;
  font-size: 14px;
  font-weight: 600;
}

.completion-checklist,
.completion-material-list {
  display: grid;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.completion-checklist__item,
.completion-material,
.completion-entry,
.completion-signature {
  padding: 10px;
  border-radius: 8px;
  background: #F4F7FA;
}

.completion-checklist__item,
.completion-signature {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.completion-checklist__label {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: #11202E;
  font-size: 13px;
}

.completion-entry {
  display: grid;
  gap: 8px;
}

.completion-entry p {
  margin: 0;
  color: #11202E;
  line-height: 1.5;
}

.completion-entry__textarea {
  min-height: 92px;
}

.completion-entry__meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  color: #5C7081;
  font-size: 12px;
}

.completion-photo-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(128px, 1fr));
  gap: 10px;
}

.completion-photo {
  margin: 0;
  overflow: hidden;
  border: 0.5px solid #D3DCE3;
  border-radius: 8px;
  background: #FFFFFF;
}

.completion-photo img,
.completion-signature img,
.completion-photo__placeholder {
  width: 100%;
  height: 104px;
  display: block;
  object-fit: cover;
  background: #ECEFF2;
}

.completion-photo__placeholder {
  display: grid;
  place-items: center;
  color: #8B98A3;
  font-size: 24px;
}

.completion-photo figcaption {
  padding: 8px;
  color: #5C7081;
  font-size: 12px;
}

.completion-material {
  display: grid;
  grid-template-columns: minmax(160px, 2fr) minmax(72px, 0.6fr) minmax(80px, 0.7fr) minmax(110px, 1fr) minmax(88px, 0.8fr) minmax(120px, 1fr);
  gap: 8px;
  align-items: end;
}

.completion-material:not(:has(.auth-field)) {
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
}

.completion-material__actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.completion-signature {
  justify-content: flex-start;
}

.completion-signature img,
.completion-signature .completion-photo__placeholder {
  width: 220px;
  height: 92px;
  object-fit: contain;
  border: 0.5px solid #D3DCE3;
  border-radius: 6px;
  background: #FFFFFF;
}

@media (max-width: 960px) {
  .jo-detail-layout {
    grid-template-columns: 1fr;
  }

  .detail-grid--compact {
    grid-template-columns: 1fr;
  }

  .completion-material {
    grid-template-columns: 1fr;
  }

  .jo-detail-hero__actions {
    justify-content: flex-start;
  }
}
</style>
