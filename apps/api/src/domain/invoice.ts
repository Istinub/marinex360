// Pure invoice draft-generation logic (FR-40, CC-2, D-011/CC-9, D-003/D-021). Kept DB-free and
// unit-testable, mirroring domain/{josm,checklist,sync}.ts. The DB-touching wiring lives in
// routes/jobOrders.ts's transition handler, on PENDING_REVIEW -> COMPLETED only.
import { AppError } from '../lib/errors.js';
import { GST_RATE_PERCENT, BRANCH_CURRENCY } from '../lib/invoiceConfig.js';
import { DEFAULT_LABOUR_RATE } from '../lib/money.js';

export interface DraftInvoiceLine {
  kind: 'LABOUR' | 'MATERIAL' | 'VARIATION';
  description: string;
  quantity: number;
  unit: string | null;
  unitPriceAmountMinor: number;
  unitPriceCurrency: string;
  lineTotalAmountMinor: number;
  lineTotalCurrency: string;
}

export interface DraftInvoice {
  currency: string;
  lines: DraftInvoiceLine[];
  totalAmountMinor: number;
  gstAmountMinor: number;
  gstCurrency: string;
}

export interface WorkLogInput { startedAt: Date; endedAt: Date | null; labourRateAmountMinor: number | null; labourRateCurrency: string | null; }
export interface MaterialLineInput { description: string; quantity: number; unit: string | null; unitCostAmountMinor: number; unitCostCurrency: string; }
export interface VariationInput { reason: string; status: string; amountMinor: number; amountCurrency: string; }

export interface BuildDraftInvoiceInput {
  branch: string;
  workLogs: WorkLogInput[];
  materialLines: MaterialLineInput[];
  variations: VariationInput[];
}

export interface ActualCostLines {
  currency: string;
  lines: DraftInvoiceLine[];
  totalAmountMinor: number;
}

function fail(msg: string): never {
  throw new AppError('VALIDATION_ERROR', `invoice generation: ${msg}`);
}

export function buildDraftInvoice(input: BuildDraftInvoiceInput): DraftInvoice {
  const actual = computeActualCostLines(input);
  const gstAmountMinor = Math.round(actual.totalAmountMinor * (GST_RATE_PERCENT / 100));

  return {
    currency: actual.currency,
    lines: actual.lines,
    totalAmountMinor: actual.totalAmountMinor,
    gstAmountMinor,
    gstCurrency: actual.currency,
  };
}

export function computeActualCostLines(input: BuildDraftInvoiceInput): ActualCostLines {
  const currency = BRANCH_CURRENCY[input.branch];
  if (!currency) fail(`branch "${input.branch}" not yet supported for auto-invoicing (D-031: SG-only for MVP)`);

  const lines: DraftInvoiceLine[] = [];

  const groups = new Map<string, { amountMinor: number; currency: string; hours: number }>();
  for (const wl of input.workLogs) {
    if (!wl.endedAt) continue;
    const amountMinor = wl.labourRateAmountMinor ?? DEFAULT_LABOUR_RATE.amountMinor;
    const rateCurrency = wl.labourRateCurrency ?? DEFAULT_LABOUR_RATE.currency;
    const hours = (wl.endedAt.getTime() - wl.startedAt.getTime()) / 3_600_000;
    if (hours <= 0) continue;
    const key = `${amountMinor}:${rateCurrency}`;
    const group = groups.get(key) ?? { amountMinor, currency: rateCurrency, hours: 0 };
    group.hours += hours;
    groups.set(key, group);
  }

  for (const group of groups.values()) {
    if (group.currency !== currency) fail(`labour rate currency "${group.currency}" does not match invoice currency "${currency}" (no conversion, D-031)`);
    const roundedHours = Math.round(group.hours * 1000) / 1000;
    lines.push({
      kind: 'LABOUR',
      description: `Labour (${roundedHours}h @ ${(group.amountMinor / 100).toFixed(2)}/hr)`,
      quantity: roundedHours,
      unit: 'hr',
      unitPriceAmountMinor: group.amountMinor,
      unitPriceCurrency: group.currency,
      lineTotalAmountMinor: Math.round(roundedHours * group.amountMinor),
      lineTotalCurrency: group.currency,
    });
  }

  for (const material of input.materialLines) {
    if (material.unitCostCurrency !== currency) fail(`material line currency "${material.unitCostCurrency}" does not match invoice currency "${currency}" (no conversion, D-031)`);
    lines.push({
      kind: 'MATERIAL',
      description: material.description,
      quantity: material.quantity,
      unit: material.unit,
      unitPriceAmountMinor: material.unitCostAmountMinor,
      unitPriceCurrency: material.unitCostCurrency,
      lineTotalAmountMinor: Math.round(material.quantity * material.unitCostAmountMinor),
      lineTotalCurrency: material.unitCostCurrency,
    });
  }

  for (const variation of input.variations) {
    if (variation.status !== 'APPROVED') continue;
    if (variation.amountCurrency !== currency) fail(`variation currency "${variation.amountCurrency}" does not match invoice currency "${currency}" (no conversion, D-031)`);
    lines.push({
      kind: 'VARIATION',
      description: variation.reason,
      quantity: 1,
      unit: null,
      unitPriceAmountMinor: variation.amountMinor,
      unitPriceCurrency: variation.amountCurrency,
      lineTotalAmountMinor: variation.amountMinor,
      lineTotalCurrency: variation.amountCurrency,
    });
  }

  const totalAmountMinor = lines.reduce((sum, line) => sum + line.lineTotalAmountMinor, 0);

  return { currency, lines, totalAmountMinor };
}
