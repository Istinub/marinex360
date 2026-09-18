import type { BrandingLogo } from './branding.js';
import { letterheadStyles, renderPdfLetterhead } from './pdfLetterhead.js';

export interface QuotationForPdf {
  quotationNumber: string;
  category: string;
  quotationDate: Date;
  location: string | null;
  currency: string;
  validityDays: number;
  workDurationText: string | null;
  exclusionsText: string;
  client: { name: string } | null;
  vessel: { name: string } | null;
  manualClientName: string | null;
  manualVesselName: string | null;
  lines: {
    itemCode: string | null;
    description: string;
    unit: string | null;
    quantity: unknown | null;
    unitPrice: unknown | null;
    amount: unknown | null;
    remarks: string | null;
  }[];
}

const escapeHtml = (value: unknown) =>
  String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

const sgtDate = (d: Date) =>
  new Date(d).toLocaleDateString('en-SG', {
    timeZone: 'Asia/Singapore',
    year: 'numeric',
    month: 'short',
    day: '2-digit',
  });

function decimalText(value: unknown | null, fractionDigits = 2): string {
  if (value == null) return '';
  const n = Number(value);
  if (!Number.isFinite(n)) return '';
  return n.toFixed(fractionDigits);
}

export function renderQuotationHtml(quotation: QuotationForPdf, brandingLogo?: BrandingLogo): string {
  const clientName = quotation.client?.name ?? quotation.manualClientName ?? '';
  const vesselName = quotation.vessel?.name ?? quotation.manualVesselName ?? '';
  const total = quotation.lines.reduce((sum, line) => {
    const n = line.amount == null ? NaN : Number(line.amount);
    return Number.isFinite(n) ? sum + n : sum;
  }, 0);
  const rows = quotation.lines.map((line, index) => `
    <tr>
      <td class="center">${index + 1}</td>
      <td>${line.itemCode ? `<strong>${escapeHtml(line.itemCode)}</strong><br/>` : ''}${escapeHtml(line.description)}</td>
      <td>${escapeHtml(line.unit ?? '')}</td>
      <td class="right mono">${decimalText(line.quantity, 3)}</td>
      <td class="right mono">${decimalText(line.unitPrice, 2)}</td>
      <td class="right mono">${decimalText(line.amount, 2)}</td>
      <td>${escapeHtml(line.remarks ?? '')}</td>
    </tr>`).join('');

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <style>
    @page { size: A4; margin: 20mm; }
    body { font-family: 'IBM Plex Sans', Arial, sans-serif; color: #11202E; font-size: 11px; }
    ${letterheadStyles}
    .mono { font-family: 'IBM Plex Mono', monospace; }
    .right { text-align: right; }
    .center { text-align: center; }
    .quotation-meta { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 24px; margin-bottom: 18px; }
    .quotation-meta div { display: grid; grid-template-columns: 145px 1fr; gap: 8px; }
    .quotation-meta dt { color: #5C7081; font-weight: 600; }
    .quotation-meta dd { margin: 0; }
    table { width: 100%; border-collapse: collapse; }
    th, td { border: 1px solid #C2CCD4; padding: 6px; vertical-align: top; }
    th { background: #F4F7FA; color: #0B2A4A; font-size: 9px; text-transform: uppercase; }
    .total-row td { font-weight: 700; background: #F4F7FA; }
    .notes { margin-top: 18px; line-height: 1.55; }
    .signoff { margin-top: 32px; display: grid; grid-template-columns: 1fr 1fr; gap: 48px; }
    .signoff__line { border-top: 1px solid #5C7081; padding-top: 6px; color: #5C7081; }
  </style>
</head>
<body>
  ${renderPdfLetterhead({
    brandingLogo,
    documentTitle: 'Quotation',
    documentMeta: [quotation.quotationNumber, `Date: ${sgtDate(quotation.quotationDate)}`],
  })}
  <dl class="quotation-meta">
    <div><dt>Ship / Company Name</dt><dd>${escapeHtml(vesselName || clientName)}</dd></div>
    <div><dt>Quotation No.</dt><dd class="mono">${escapeHtml(quotation.quotationNumber)}</dd></div>
    <div><dt>Machinery / Equipment</dt><dd>${escapeHtml(quotation.category)}</dd></div>
    <div><dt>Quotation Date</dt><dd>${sgtDate(quotation.quotationDate)}</dd></div>
    <div><dt>Company</dt><dd>${escapeHtml(clientName)}</dd></div>
    <div><dt>Location</dt><dd>${escapeHtml(quotation.location ?? '')}</dd></div>
  </dl>
  <table>
    <thead>
      <tr>
        <th>SL.NO</th><th>Description</th><th>Unit</th><th class="right">Qty</th><th class="right">Unit Price</th><th class="right">Amount</th><th>Remarks</th>
      </tr>
    </thead>
    <tbody>
      ${rows}
      <tr class="total-row"><td colspan="5" class="right">TOTAL (${escapeHtml(quotation.currency)})</td><td class="right mono">${total.toFixed(2)}</td><td></td></tr>
    </tbody>
  </table>
  <section class="notes">
    <p><strong>Validity:</strong> ${quotation.validityDays} days from quotation date.</p>
    <p><strong>Work duration:</strong> ${escapeHtml(quotation.workDurationText ?? '')}</p>
    <p><strong>Exclusions:</strong> ${escapeHtml(quotation.exclusionsText)}</p>
  </section>
  <section class="signoff">
    <div class="signoff__line">Prepared by TKMR Marine &amp; Offshore Engineering Pte Ltd</div>
    <div class="signoff__line">Customer acknowledgement</div>
  </section>
</body>
</html>`;
}
