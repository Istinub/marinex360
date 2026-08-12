import { describe, it, expect } from 'vitest';
import { buildDraftInvoice } from '../src/domain/invoice.js';

const h = (n: number) => new Date(`2026-07-01T0${n}:00:00.000Z`);

describe('buildDraftInvoice (FR-40)', () => {
  it('sums labour hours per distinct snapshotted rate, materials pass through, only APPROVED variations included', () => {
    const draft = buildDraftInvoice({
      branch: 'SG',
      workLogs: [
        { startedAt: h(0), endedAt: h(4), labourRateAmountMinor: 9000, labourRateCurrency: 'SGD' },
        { startedAt: h(4), endedAt: h(8), labourRateAmountMinor: 9000, labourRateCurrency: 'SGD' },
        { startedAt: h(0), endedAt: h(2), labourRateAmountMinor: 12000, labourRateCurrency: 'SGD' },
      ],
      materialLines: [
        { description: 'Gasket kit', quantity: 2, unit: 'pcs', unitCostAmountMinor: 5000, unitCostCurrency: 'SGD' },
      ],
      variations: [
        { reason: 'Approved extra scope', status: 'APPROVED', amountMinor: 30000, amountCurrency: 'SGD' },
        { reason: 'Still pending', status: 'PROPOSED', amountMinor: 99999, amountCurrency: 'SGD' },
        { reason: 'Was rejected', status: 'REJECTED', amountMinor: 88888, amountCurrency: 'SGD' },
      ],
    });

    expect(draft.currency).toBe('SGD');
    const labourLines = draft.lines.filter((line) => line.kind === 'LABOUR');
    expect(labourLines).toHaveLength(2);
    const rate9000 = labourLines.find((line) => line.unitPriceAmountMinor === 9000)!;
    expect(rate9000.quantity).toBe(8);
    expect(rate9000.lineTotalAmountMinor).toBe(8 * 9000);

    const materialLines = draft.lines.filter((line) => line.kind === 'MATERIAL');
    expect(materialLines).toHaveLength(1);
    expect(materialLines[0].lineTotalAmountMinor).toBe(2 * 5000);

    const variationLines = draft.lines.filter((line) => line.kind === 'VARIATION');
    expect(variationLines).toHaveLength(1);
    expect(variationLines[0].lineTotalAmountMinor).toBe(30000);

    const expectedTotal = 8 * 9000 + 2 * 12000 + 2 * 5000 + 30000;
    expect(draft.totalAmountMinor).toBe(expectedTotal);
  });

  it('GST is computed from config, not a hardcoded literal (D-033)', () => {
    const draft = buildDraftInvoice({
      branch: 'SG',
      workLogs: [],
      materialLines: [{ description: 'x', quantity: 1, unit: 'pcs', unitCostAmountMinor: 100000, unitCostCurrency: 'SGD' }],
      variations: [],
    });
    expect(draft.totalAmountMinor).toBe(100000);
    expect(draft.gstAmountMinor).toBe(Math.round(100000 * (Number(process.env.GST_RATE_PERCENT ?? '9') / 100)));
    expect(draft.gstCurrency).toBe('SGD');
  });

  it('WorkLogs never clocked out (no endedAt) are skipped — no hours to bill', () => {
    const draft = buildDraftInvoice({
      branch: 'SG',
      workLogs: [{ startedAt: h(0), endedAt: null, labourRateAmountMinor: 9000, labourRateCurrency: 'SGD' }],
      materialLines: [],
      variations: [],
    });
    expect(draft.lines).toHaveLength(0);
    expect(draft.totalAmountMinor).toBe(0);
  });

  it('missing snapshotted rate falls back to D-004 default (SGD 90/hr)', () => {
    const draft = buildDraftInvoice({
      branch: 'SG',
      workLogs: [{ startedAt: h(0), endedAt: h(1), labourRateAmountMinor: null, labourRateCurrency: null }],
      materialLines: [],
      variations: [],
    });
    expect(draft.lines[0].unitPriceAmountMinor).toBe(9000);
    expect(draft.lines[0].unitPriceCurrency).toBe('SGD');
  });

  it('D-031: unsupported branch is rejected explicitly, not silently guessed', () => {
    expect(() => buildDraftInvoice({ branch: 'MY', workLogs: [], materialLines: [], variations: [] }))
      .toThrowError(/not yet supported for auto-invoicing/);
  });

  it('D-031: a line in the wrong currency is rejected, never silently mixed or converted', () => {
    expect(() => buildDraftInvoice({
      branch: 'SG',
      workLogs: [],
      materialLines: [{ description: 'x', quantity: 1, unit: 'pcs', unitCostAmountMinor: 1000, unitCostCurrency: 'MYR' }],
      variations: [],
    })).toThrowError(/does not match invoice currency/);
  });

  it('an empty completed job (no labour/material/approved variations) produces a zero-total DRAFT, not an error', () => {
    const draft = buildDraftInvoice({ branch: 'SG', workLogs: [], materialLines: [], variations: [] });
    expect(draft.lines).toHaveLength(0);
    expect(draft.totalAmountMinor).toBe(0);
    expect(draft.gstAmountMinor).toBe(0);
  });
});
