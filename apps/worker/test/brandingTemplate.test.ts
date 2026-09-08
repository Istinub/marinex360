import { describe, expect, it } from 'vitest';
import { loadBrandingLogo } from '../src/lib/branding.js';
import { renderInvoiceHtml, type InvoiceForPdf } from '../src/lib/invoiceTemplate.js';
import { renderJobOrderReportHtml } from '../src/lib/jobOrderReportTemplate.js';

const logo = { filename: 'TKMR.png', dataUri: 'data:image/png;base64,VEVTVA==' };

describe('branding logo templates', () => {
  it('invoice template embeds the selected branding logo', () => {
    const invoice: InvoiceForPdf = {
      invoiceNumber: 'INV-1',
      issuedAt: new Date('2026-09-08T00:00:00Z'),
      status: 'DRAFT',
      billToName: 'Pacific Lines',
      billToAddress: null,
      gstAmountMinor: 0,
      gstCurrency: 'SGD',
      totalAmountMinor: 0,
      totalCurrency: 'SGD',
      lines: [],
    };
    const html = renderInvoiceHtml(invoice, logo);
    expect(html).toContain('alt="TKMR.png"');
    expect(html).toContain(logo.dataUri);
  });

  it('job report template embeds the selected branding logo', () => {
    const html = renderJobOrderReportHtml({
      joNumber: 'SG-2026-0001',
      branch: 'SG',
      scopeSummary: 'Inspection',
      serviceCategories: ['inspection'],
      quotedAmountMinor: 0,
      quotedCurrency: 'SGD',
      state: 'COMPLETED',
      client: { name: 'Pacific Lines' },
      vessel: { name: 'MV Pacific Dawn', imoNumber: '9251986' },
      statusHistory: [],
      checklistItems: [],
      observations: [],
      photos: [],
      materials: [],
      variations: [],
      signature: null,
    }, logo);
    expect(html).toContain('alt="TKMR.png"');
    expect(html).toContain(logo.dataUri);
  });

  it('loads the logo filename from BrandingSettings for the next render', async () => {
    const prisma = {
      brandingSettings: {
        findUnique: async () => ({ id: 'singleton', logoFilename: 'TKMR.png' }),
      },
    };
    const activeLogo = await loadBrandingLogo(prisma as any);
    expect(activeLogo.filename).toBe('TKMR.png');
    expect(activeLogo.dataUri).toMatch(/^data:image\/png;base64,/);
  });
});
