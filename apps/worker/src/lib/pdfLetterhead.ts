import type { BrandingLogo } from './branding.js';

const escapeHtml = (value: unknown) =>
  String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

export const letterheadStyles = `
  .letterhead { display: flex; align-items: center; justify-content: space-between; gap: 18px; border-bottom: 2px solid #0B2A4A; margin-bottom: 22px; padding-bottom: 14px; }
  .letterhead__brand { display: flex; align-items: center; gap: 14px; min-width: 0; }
  .letterhead__logo { width: 128px; max-height: 56px; object-fit: contain; flex: 0 0 auto; }
  .letterhead__company { margin: 0 0 4px; color: #0B2A4A; font-size: 15px; font-weight: 700; letter-spacing: 0.01em; }
  .letterhead__contact { margin: 0; color: #5C7081; font-size: 10.5px; line-height: 1.4; }
  .letterhead__document { text-align: right; flex: 0 0 auto; }
  .letterhead__document-title { margin: 0 0 4px; color: #0B2A4A; font-size: 21px; font-weight: 700; }
  .letterhead__document-meta { margin: 0; color: #5C7081; font-size: 11px; line-height: 1.45; }
`;

export function renderPdfLetterhead(input: {
  brandingLogo?: BrandingLogo;
  documentTitle: string;
  documentMeta?: string[];
}): string {
  return `<header class="letterhead">
    <div class="letterhead__brand">
      ${input.brandingLogo ? `<img class="letterhead__logo" src="${input.brandingLogo.dataUri}" alt="${escapeHtml(input.brandingLogo.filename)}" />` : ''}
      <div>
        <p class="letterhead__company"><strong>TKMR MARINE &amp; OFFSHORE ENGINEERING PTE LTD</strong></p>
        <p class="letterhead__contact">Tel: +65-97264770 | Email: mgr@tkmrmarine.com.sg | UEN: 202231288E</p>
      </div>
    </div>
    <div class="letterhead__document">
      <p class="letterhead__document-title">${escapeHtml(input.documentTitle)}</p>
      ${(input.documentMeta ?? []).map((line) => `<p class="letterhead__document-meta">${escapeHtml(line)}</p>`).join('')}
    </div>
  </header>`;
}
