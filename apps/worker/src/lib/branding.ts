import { readFile, readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PrismaClient } from '@prisma/client';

export interface BrandingLogo {
  filename: string;
  dataUri: string;
}

const BRANDING_SETTINGS_ID = 'singleton';
const DEFAULT_LOGO_FILENAME = 'TKMR_Logo.png';
const BRANDING_ASSETS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../assets/branding');

async function listLogoFilenames(): Promise<string[]> {
  const files = await readdir(BRANDING_ASSETS_DIR);
  return files.filter((file) => file.toLowerCase().endsWith('.png'));
}

async function logoDataUri(filename: string): Promise<BrandingLogo> {
  const bytes = await readFile(join(BRANDING_ASSETS_DIR, filename));
  return { filename, dataUri: `data:image/png;base64,${Buffer.from(bytes).toString('base64')}` };
}

export async function loadBrandingLogo(prisma: PrismaClient): Promise<BrandingLogo> {
  const [settings, available] = await Promise.all([
    prisma.brandingSettings.findUnique({ where: { id: BRANDING_SETTINGS_ID } }),
    listLogoFilenames(),
  ]);
  const filename = settings?.logoFilename && available.includes(settings.logoFilename)
    ? settings.logoFilename
    : DEFAULT_LOGO_FILENAME;
  return logoDataUri(filename);
}
