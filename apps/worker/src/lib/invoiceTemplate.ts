// D-037/§6.1: invoice HTML template for Puppeteer rendering. Pure function (Invoice + lines in,
// HTML string out) so it's unit-testable without launching a browser. Imports the SAME token
// CSS the web app uses (marinex360-design-tokens.css) so branding is identical everywhere.
import { BANK_DETAILS } from './invoicePdfConfig.js';

export interface InvoiceForPdf {
  invoiceNumber: string;
  issuedAt: Date | null;
  status: string;
  billToName: string;
  billToAddress: string | null;
  gstAmountMinor: number | null;
  gstCurrency: string | null;
  totalAmountMinor: number;
  totalCurrency: string;
  lines: {
    kind: string;
    description: string;
    quantity: unknown;
    unit: string | null;
    unitPriceAmountMinor: number;
    lineTotalAmountMinor: number;
    lineTotalCurrency: string;
  }[];
}

const money = (amountMinor: number, currency: string) => `${currency} ${(amountMinor / 100).toFixed(2)}`;
const sgtDate = (d: Date | null) =>
  d
    ? new Date(d).toLocaleDateString('en-SG', {
        timeZone: 'Asia/Singapore',
        year: 'numeric',
        month: 'short',
        day: '2-digit',
      })
    : '';

export function renderInvoiceHtml(inv: InvoiceForPdf): string {
  const rows = inv.lines.map((l) => `
    <tr>
      <td>${l.description}</td>
      <td class="mono right">${String(l.quantity)}${l.unit ? ' ' + l.unit : ''}</td>
      <td class="mono right">${money(l.unitPriceAmountMinor, l.lineTotalCurrency)}</td>
      <td class="mono right">${money(l.lineTotalAmountMinor, l.lineTotalCurrency)}</td>
    </tr>`).join('');

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8" />
<style>
  @page { size: A4; margin: 20mm; }
  body { font-family: 'IBM Plex Sans', sans-serif; color: #1A1A1A; }
  .mono { font-family: 'IBM Plex Mono', monospace; }
  .right { text-align: right; }
  header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 24px; }
  .invoiceNumber { font-family: 'IBM Plex Mono', monospace; font-size: 14px; }
  table { width: 100%; border-collapse: collapse; margin-top: 16px; }
  th, td { padding: 8px; border-bottom: 1px solid #E0E0E0; }
  th { text-align: left; font-size: 11px; text-transform: uppercase; color: #666; }
  .totals { margin-top: 16px; width: 100%; }
  .totals td { border: none; padding: 4px 8px; }
  .grand-total { font-weight: bold; font-size: 16px; }
  footer { margin-top: 40px; font-size: 11px; color: #666; }
</style></head>
<body>
  <header>
    <div><strong>TKMR Marine &amp; Offshore Engineering Pte. Ltd.</strong></div>
    <div class="right">
      <div class="invoiceNumber">${inv.invoiceNumber}</div>
      <div>Issued: ${sgtDate(inv.issuedAt)}</div>
      <div>Status: ${inv.status}</div>
    </div>
  </header>
  <section>
    <strong>Bill To</strong><br/>
    ${inv.billToName}<br/>
    ${inv.billToAddress ?? ''}
  </section>
  <table>
    <thead><tr><th>Description</th><th class="right">Qty</th><th class="right">Unit Price</th><th class="right">Amount</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <table class="totals">
    ${inv.gstAmountMinor != null ? `<tr><td class="right" colspan="3">GST</td><td class="mono right">${money(inv.gstAmountMinor, inv.gstCurrency ?? inv.totalCurrency)}</td></tr>` : ''}
    <tr class="grand-total"><td class="right" colspan="3">Total</td><td class="mono right">${money(inv.totalAmountMinor, inv.totalCurrency)}</td></tr>
  </table>
  <footer>${BANK_DETAILS}</footer>
</body></html>`;
}
