// FR-43: baseline vs actual vs revenue, per job. "Actual cost" formula ratified in
// ACCEPTANCE_CRITERIA_v0.2_fidelity_lock.md — identical to invoice generation's line sum
// (WorkLog snapshotted rate + materials + approved variations). Reuses that computation
// rather than duplicating it.
import { AppError } from '../lib/errors.js';
import { computeActualCostLines, type BuildDraftInvoiceInput } from './invoice.js';

export interface FinancialSummary {
  baselineAmountMinor: number;
  baselineCurrency: string;
  actualAmountMinor: number;
  actualCurrency: string;
  revenueAmountMinor: number | null;
  revenueCurrency: string | null;
  varianceAmountMinor: number;
}

export interface FinancialSummaryInput extends BuildDraftInvoiceInput {
  baselineAmountMinor: number;
  baselineCurrency: string;
  invoice: { totalAmountMinor: number; totalCurrency: string } | null;
}

function fail(msg: string): never {
  throw new AppError('VALIDATION_ERROR', `financial summary: ${msg}`);
}

export function buildFinancialSummary(input: FinancialSummaryInput): FinancialSummary {
  const actual = computeActualCostLines(input);
  if (input.baselineCurrency !== actual.currency) {
    fail(`baseline currency "${input.baselineCurrency}" does not match actual currency "${actual.currency}" (no conversion, D-031)`);
  }
  if (input.invoice && input.invoice.totalCurrency !== input.baselineCurrency) {
    fail(`revenue currency "${input.invoice.totalCurrency}" does not match baseline currency "${input.baselineCurrency}" (no conversion, D-031)`);
  }

  return {
    baselineAmountMinor: input.baselineAmountMinor,
    baselineCurrency: input.baselineCurrency,
    actualAmountMinor: actual.totalAmountMinor,
    actualCurrency: actual.currency,
    revenueAmountMinor: input.invoice?.totalAmountMinor ?? null,
    revenueCurrency: input.invoice?.totalCurrency ?? null,
    varianceAmountMinor: actual.totalAmountMinor - input.baselineAmountMinor,
  };
}
