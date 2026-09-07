import type { FastifyInstance, FastifyReply } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import { AppError } from '../lib/errors.js';
import { hashPassword, verifyPassword } from '../auth/password.js';
import { issueSession } from './auth.js';
import { assertBranchAccess, scopeWhere } from '../services/branchScope.js';
import { createDeviceUnlockRateLimiter } from '../services/deviceUnlockRateLimit.js';

const DEVICE_ROLES = ['SYSTEM_ADMIN', 'DIRECTOR'] as const;

function assertDeviceManager(roles: string[]): void {
  if (!roles.some((role) => DEVICE_ROLES.includes(role as any))) throw new AppError('FORBIDDEN');
}

function validatePin(pin: unknown): string {
  if (typeof pin !== 'string' || !/^\d{4}$/.test(pin)) {
    throw new AppError('VALIDATION_ERROR', 'pin must be a 4-digit string', { field: 'pin', reason: 'format' });
  }
  return pin;
}

export function deviceRoutes(app: FastifyInstance, prisma: PrismaClient, accessSecret: string): void {
  const unlockRateLimiter = createDeviceUnlockRateLimiter();
  app.addHook('onClose', async () => {
    await unlockRateLimiter.close();
  });

  async function sendDeviceSession(reply: FastifyReply, device: { id: string; assignedUser: { id: string; roles: string[]; branch: string } }) {
    const session = await issueSession(
      prisma,
      accessSecret,
      {
        id: device.assignedUser.id,
        roles: device.assignedUser.roles,
        branch: device.assignedUser.branch,
        mfaComplete: true,
        deviceId: device.id,
      },
      true,
    );
    return reply.send(session);
  }

  app.get('/api/v1/devices', { preHandler: [app.authenticate, app.requireMfaEnrolled, app.requireAction('user:admin')] }, async (req) => {
    assertDeviceManager(req.ctx.roles);
    return prisma.device.findMany({
      where: scopeWhere(req.ctx),
      orderBy: { createdAt: 'desc' },
      include: { assignedUser: { select: { id: true, name: true, email: true, roles: true, branch: true } } },
    });
  });

  app.patch('/api/v1/devices/:id', { preHandler: [app.authenticate, app.requireMfaEnrolled, app.requireAction('user:admin')] }, async (req) => {
    assertDeviceManager(req.ctx.roles);
    const { id } = req.params as { id: string };
    const body = (req.body ?? {}) as any;
    const device = await prisma.device.findFirst({ where: { id } });
    if (!device) throw new AppError('NOT_FOUND');
    assertBranchAccess(req.ctx, device.branch);

    const data: { name?: string | null; pin?: string } = {};
    if ('name' in body) data.name = typeof body.name === 'string' && body.name.trim() ? body.name.trim() : null;
    if ('pin' in body) data.pin = await hashPassword(validatePin(body.pin));

    return prisma.device.update({
      where: { id },
      data,
      include: { assignedUser: { select: { id: true, name: true, email: true, roles: true, branch: true } } },
    });
  });

  app.post('/api/v1/devices/unlock-by-pin', { preHandler: [unlockRateLimiter.preHandler] }, async (req, reply) => {
    const { pin } = (req.body ?? {}) as any;
    const invalid = () => new AppError('UNAUTHORIZED', 'invalid PIN');
    if (typeof pin !== 'string' || !/^\d{4}$/.test(pin)) throw invalid();

    const devices = await prisma.device.findMany({
      include: { assignedUser: true },
      orderBy: { createdAt: 'asc' },
    });
    for (const device of devices) {
      if (device.assignedUser.active && await verifyPassword(pin, device.pin)) {
        return sendDeviceSession(reply, device);
      }
    }

    throw invalid();
  });

  app.post('/api/v1/devices/:id/unlock', { preHandler: [unlockRateLimiter.preHandler] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const { pin } = (req.body ?? {}) as any;
    const invalid = () => new AppError('UNAUTHORIZED', 'invalid device or PIN');
    if (typeof pin !== 'string') throw invalid();

    const device = await prisma.device.findUnique({
      where: { id },
      include: { assignedUser: true },
    });
    if (!device || !device.assignedUser.active || !(await verifyPassword(pin, device.pin))) {
      throw invalid();
    }

    return sendDeviceSession(reply, device);
  });
}
