import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import { AppError } from '../lib/errors.js';
import {
  BRANDING_ASSETS_DIR,
  BRANDING_SETTINGS_ID,
  DEFAULT_LOGO_FILENAME,
  assertBrandingLogoFilename,
  listBrandingLogoFilenames,
} from '../services/brandingAssets.js';

const BRANDING_ROLES = ['SYSTEM_ADMIN', 'DIRECTOR'] as const;

function assertBrandingManager(roles: string[]): void {
  if (!roles.some((role) => BRANDING_ROLES.includes(role as any))) throw new AppError('FORBIDDEN');
}

export function brandingSettingsRoutes(app: FastifyInstance, prisma: PrismaClient): void {
  app.get('/api/v1/branding-settings', { preHandler: [app.authenticate, app.requireMfaEnrolled] }, async () => {
    const [settings, availableLogoFilenames] = await Promise.all([
      prisma.brandingSettings.upsert({
        where: { id: BRANDING_SETTINGS_ID },
        update: {},
        create: { id: BRANDING_SETTINGS_ID, logoFilename: DEFAULT_LOGO_FILENAME },
      }),
      listBrandingLogoFilenames(),
    ]);
    return { ...settings, availableLogoFilenames };
  });

  app.patch('/api/v1/branding-settings', { preHandler: [app.authenticate, app.requireMfaEnrolled, app.requireAction('user:admin')] }, async (req) => {
    assertBrandingManager(req.ctx.roles);
    const { logoFilename } = (req.body ?? {}) as any;
    const nextLogoFilename = await assertBrandingLogoFilename(logoFilename);
    return prisma.brandingSettings.upsert({
      where: { id: BRANDING_SETTINGS_ID },
      update: { logoFilename: nextLogoFilename, updatedBy: req.ctx.userId },
      create: { id: BRANDING_SETTINGS_ID, logoFilename: nextLogoFilename, updatedBy: req.ctx.userId },
    });
  });

  app.get('/api/v1/branding-settings/assets/:filename', async (req, reply) => {
    const { filename } = req.params as { filename: string };
    const safeFilename = await assertBrandingLogoFilename(filename);
    const bytes = await readFile(join(BRANDING_ASSETS_DIR, safeFilename));
    return reply.type('image/png').send(bytes);
  });
}
