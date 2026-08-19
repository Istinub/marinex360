import { describe, it, expect } from 'vitest';
import { renderInvoiceHtml } from '../src/lib/invoiceTemplate.js';

describe('renderInvoiceHtml', () => {
  const sample = {
    invoiceNumber: 'SG-2026-0042',
    issuedAt: new Date('2026-08-01'),
    status: 'SENT',
    billToName: 'Test Client Pte Ltd',
    billToAddress: '1 Test St',
    gstAmountMinor: 900,
    gstCurrency: 'SGD',
    totalAmountMinor: 10900,
    totalCurrency: 'SGD',
    lines: [
      {
        kind: 'LABOUR',
        description: 'Labour',
        quantity: 2,
        unit: 'hr',
        unitPriceAmountMinor: 5000,
        lineTotalAmountMinor: 10000,
        lineTotalCurrency: 'SGD',
      },
    ],
  };

  it('includes the invoice number, bill-to name, and GST line', () => {
    const html = renderInvoiceHtml(sample);
    expect(html).toContain('SG-2026-0042');
    expect(html).toContain('Test Client Pte Ltd');
    expect(html).toContain('SGD 9.00');
  });
});
