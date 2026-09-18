import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { BrandingLogo } from './branding.js';

const CERT_ASSETS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../assets/Certs');
const BIZSAFE_LOGO_PATH = resolve(CERT_ASSETS_DIR, 'bizsafe.png');
let bizsafeDataUri: string | null = null;

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

export const pdfPageMargins = {
  top: '20mm',
  right: '20mm',
  bottom: '24mm',
  left: '20mm',
};

function loadBizsafeLogoDataUri(): string {
  bizsafeDataUri ??= `data:image/png;base64,${readFileSync(BIZSAFE_LOGO_PATH).toString('base64')}`;
  return bizsafeDataUri;
}

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

export function renderPdfFooterTemplate(): string {
  const bizsafeLogo = loadBizsafeLogoDataUri();
  return `<style>
    .pdf-footer {
      box-sizing: border-box;
      width: 100%;
      display: grid;
      grid-template-columns: 1fr auto 1fr;
      align-items: center;
      gap: 10px;
      padding: 0 20mm;
      color: #5C7081;
      font-family: "IBM Plex Sans", Arial, sans-serif;
      font-size: 8px;
    }
    .pdf-footer__disclaimer {
      justify-self: start;
      color: #8B98A3;
      font-size: 7px;
      white-space: nowrap;
    }
    .pdf-footer__page {
      justify-self: center;
      white-space: nowrap;
    }
    .pdf-footer__cert {
      justify-self: end;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      white-space: nowrap;
    }
    .pdf-footer__cert-label {
      color: #5C7081;
      font-size: 8px;
    }
    .pdf-footer__cert-logo {
      width: 45px;
      height: 45px;
      object-fit: contain;
    }
  </style>
  <div class="pdf-footer">
    <div class="pdf-footer__disclaimer">Report auto generated electronically — powered by MarineX360.</div>
    <div class="pdf-footer__page">Page <span class="pageNumber"></span> of <span class="totalPages"></span></div>
    <div class="pdf-footer__cert"><span class="pdf-footer__cert-label">Certified by</span><img class="pdf-footer__cert-logo" src="${bizsafeLogo}" alt="bizSAFE" /></div>
  </div>`;
}
