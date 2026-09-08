import { readdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AppError } from '../lib/errors.js';

export const BRANDING_SETTINGS_ID = 'singleton';
export const DEFAULT_LOGO_FILENAME = 'TKMR_Logo.png';
export const BRANDING_ASSETS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../assets/branding');

export async function listBrandingLogoFilenames(): Promise<string[]> {
  const files = await readdir(BRANDING_ASSETS_DIR);
  return files.filter((file) => file.toLowerCase().endsWith('.png')).sort((a, b) => a.localeCompare(b));
}

export async function assertBrandingLogoFilename(filename: unknown): Promise<string> {
  if (typeof filename !== 'string' || !filename.trim()) {
    throw new AppError('VALIDATION_ERROR', 'logoFilename required', { field: 'logoFilename', reason: 'required' });
  }
  const normalized = filename.trim();
  const logos = await listBrandingLogoFilenames();
  if (!logos.includes(normalized)) {
    throw new AppError('VALIDATION_ERROR', 'logoFilename must be one of the available branding PNG files', {
      field: 'logoFilename',
      allowed: logos,
    });
  }
  return normalized;
}
