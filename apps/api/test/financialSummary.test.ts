import { describe, it, expect } from 'vitest';
import { buildFinancialSummary } from '../src/domain/financialSummary.js';

const h = (n: number) => new Date(`2026-07-01T0${n}:00:00.000Z`);

describe('buildFinancialSummary (FR-43)', () => {
  it('computes baseline vs actual vs revenue on the happy path', () => {
    const summary = buildFinancialSummary({
      branch: 'SG',
      baselineAmountMinor: 100000,
      baselineCurrency: 'SGD',
      workLogs: [{ startedAt: h(0), endedAt: h(2), labourRateAmountMinor: 9000, labourRateCurrency: 'SGD' }],
      materialLines: [{ description: 'Gasket', quantity: 2, unit: 'pcs', unitCostAmountMinor: 5000, unitCostCurrency: 'SGD' }],
      variations: [
        { reason: 'Approved scope', status: 'APPROVED', amountMinor: 30000, amountCurrency: 'SGD' },
        { reason: 'Rejected scope', status: 'REJECTED', amountMinor: 99999, amountCurrency: 'SGD' },
      ],
      invoice: { totalAmountMinor: 58000, totalCurrency: 'SGD' },
    });

    expect(summary).toEqual({
      baselineAmountMinor: 100000,
      baselineCurrency: 'SGD',
      actualAmountMinor: 58000,
      actualCurrency: 'SGD',
      revenueAmountMinor: 58000,
      revenueCurrency: 'SGD',
      varianceAmountMinor: -42000,
    });
  });

  it('reports positive variance when actual is over budget and negative when under budget', () => {
    const over = buildFinancialSummary({
      branch: 'SG',
      baselineAmountMinor: 10000,
      baselineCurrency: 'SGD',
      workLogs: [{ startedAt: h(0), endedAt: h(2), labourRateAmountMinor: 9000, labourRateCurrency: 'SGD' }],
      materialLines: [],
      variations: [],
      invoice: null,
    });
    const under = buildFinancialSummary({
      branch: 'SG',
      baselineAmountMinor: 20000,
      baselineCurrency: 'SGD',
      workLogs: [{ startedAt: h(0), endedAt: h(1), labourRateAmountMinor: 9000, labourRateCurrency: 'SGD' }],
      materialLines: [],
      variations: [],
      invoice: null,
    });

    expect(over.varianceAmountMinor).toBe(8000);
    expect(under.varianceAmountMinor).toBe(-11000);
  });

  it('returns null revenue when no invoice exists yet', () => {
    const summary = buildFinancialSummary({
      branch: 'SG',
      baselineAmountMinor: 10000,
      baselineCurrency: 'SGD',
      workLogs: [],
      materialLines: [],
      variations: [],
      invoice: null,
    });

    expect(summary.revenueAmountMinor).toBeNull();
    expect(summary.revenueCurrency).toBeNull();
  });

  it('rejects currency mismatches instead of silently coercing', () => {
    expect(() => buildFinancialSummary({
      branch: 'SG',
      baselineAmountMinor: 10000,
      baselineCurrency: 'MYR',
      workLogs: [],
      materialLines: [],
      variations: [],
      invoice: null,
    })).toThrowError(/does not match actual currency/);

    expect(() => buildFinancialSummary({
      branch: 'SG',
      baselineAmountMinor: 10000,
      baselineCurrency: 'SGD',
      workLogs: [],
      materialLines: [],
      variations: [],
      invoice: { totalAmountMinor: 10000, totalCurrency: 'USD' },
    })).toThrowError(/does not match baseline currency/);
  });
});
