// Auth routes (P1-1) — INTERFACE_CONTRACT v1.1 §4. Uses the verified primitives in auth/*.
import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import { createHash } from 'node:crypto';
import { AppError } from '../lib/errors.js';
import { verifyPassword } from '../auth/password.js';
import {
  generateBase32Secret, verifyTotp, provisioningUri, maskSecret, generateRecoveryCodes,
} from '../auth/totp.js';
import {
  signAccessToken, newRefreshSecret, hashRefresh, newFamilyId, decideRotation, REFRESH_TTL,
} from '../auth/tokens.js';
import { requiresMfaAtLogin, type Role } from '../domain/rbac.js';

const hashCode = (c: string) => createHash('sha256').update(c.trim().toUpperCase()).digest('hex');

async function issueSession(
  prisma: PrismaClient, secret: string,
  user: { id: string; roles: string[]; branch: string; mfaComplete: boolean },
  longLived: boolean,
) {
  const family = newFamilyId();
  const raw = newRefreshSecret();
  const ttl = longLived ? REFRESH_TTL.mobile : REFRESH_TTL.web;
  await prisma.refreshToken.create({
    data: { userId: user.id, tokenHash: hashRefresh(raw), family, longLived, expiresAt: new Date(Date.now() + ttl * 1000) },
  });
  const access = signAccessToken({ sub: user.id, roles: user.roles as Role[], branch: user.branch, mfaComplete: user.mfaComplete }, secret);
  return { access, refresh: raw };
}

export function authRoutes(app: FastifyInstance, prisma: PrismaClient, accessSecret: string): void {
  app.post('/api/v1/auth/login', async (req, reply) => {
    const { email, password, totp, longLived } = (req.body ?? {}) as any;
    if (!email || !password) throw new AppError('VALIDATION_ERROR', 'email and password required');
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || !user.active || !(await verifyPassword(password, user.passwordHash))) {
      throw new AppError('UNAUTHORIZED', 'invalid credentials');
    }
    const mfaRequired = requiresMfaAtLogin(user.roles as Role[]);
    if (mfaRequired && user.mfaEnrolled) {
      if (!totp || !user.totpSecret || !verifyTotp(user.totpSecret, String(totp))) {
        throw new AppError('UNAUTHORIZED', 'valid TOTP required');
      }
    }
    const mfaComplete = !mfaRequired || user.mfaEnrolled;
    const session = await issueSession(prisma, accessSecret, { id: user.id, roles: user.roles, branch: user.branch, mfaComplete }, !!longLived);
    return reply.send({ ...session, mfaEnrollmentRequired: mfaRequired && !user.mfaEnrolled });
  });

  app.post('/api/v1/auth/refresh', async (req, reply) => {
    const { refresh, longLived } = (req.body ?? {}) as any;
    if (!refresh) throw new AppError('VALIDATION_ERROR', 'refresh required');
    const presented = hashRefresh(String(refresh));
    const row = await prisma.refreshToken.findUnique({ where: { tokenHash: presented } });
    const decision = decideRotation(presented, row);
    if (decision.action === 'REVOKE_FAMILY') {
      await prisma.refreshToken.updateMany({ where: { family: decision.revokeFamily!, revokedAt: null }, data: { revokedAt: new Date() } });
      throw new AppError('UNAUTHORIZED', 'refresh reuse detected; session revoked');
    }
    const user = await prisma.user.findUnique({ where: { id: row!.userId } });
    if (!user || !user.active) throw new AppError('UNAUTHORIZED', 'user inactive');
    // rotate: revoke old, mint new in same family
    const raw = newRefreshSecret();
    const useLong = row!.longLived || !!longLived;
    const ttl = useLong ? REFRESH_TTL.mobile : REFRESH_TTL.web;
    await prisma.$transaction([
      prisma.refreshToken.update({ where: { tokenHash: presented }, data: { revokedAt: new Date() } }),
      prisma.refreshToken.create({ data: { userId: user.id, tokenHash: hashRefresh(raw), family: row!.family, longLived: useLong, expiresAt: new Date(Date.now() + ttl * 1000) } }),
    ]);
    const mfaComplete = !requiresMfaAtLogin(user.roles as Role[]) || user.mfaEnrolled;
    const access = signAccessToken({ sub: user.id, roles: user.roles as Role[], branch: user.branch, mfaComplete }, accessSecret);
    return reply.send({ access, refresh: raw });
  });

  // ---- TOTP enrolment (G-2) — all require a valid access token ----
  app.post('/api/v1/auth/totp/enroll', { preHandler: app.authenticate }, async (req, reply) => {
    const secret = generateBase32Secret();
    const user = await prisma.user.findUnique({ where: { id: req.ctx.userId } });
    if (!user) throw new AppError('NOT_FOUND');
    await prisma.user.update({ where: { id: user.id }, data: { totpPendingSecret: secret } });
    return reply.send({ provisioningUri: provisioningUri(secret, user.email), secretMasked: maskSecret(secret) });
  });

  app.post('/api/v1/auth/totp/enroll/confirm', { preHandler: app.authenticate }, async (req, reply) => {
    const { code } = (req.body ?? {}) as any;
    const user = await prisma.user.findUnique({ where: { id: req.ctx.userId } });
    if (!user?.totpPendingSecret) throw new AppError('VALIDATION_ERROR', 'no pending enrolment');
    if (!verifyTotp(user.totpPendingSecret, String(code))) throw new AppError('UNAUTHORIZED', 'code did not verify');
    const { plaintext } = generateRecoveryCodes(10);
    await prisma.user.update({
      where: { id: user.id },
      data: { totpSecret: user.totpPendingSecret, totpPendingSecret: null, mfaEnrolled: true, recoveryCodes: plaintext.map(hashCode) },
    });
    return reply.send({ recoveryCodes: plaintext }); // shown ONCE; only hashes are stored
  });

  app.post('/api/v1/auth/totp/verify', { preHandler: app.authenticate }, async (req, reply) => {
    const { code } = (req.body ?? {}) as any;
    const user = await prisma.user.findUnique({ where: { id: req.ctx.userId } });
    if (!user?.totpSecret || !verifyTotp(user.totpSecret, String(code))) throw new AppError('UNAUTHORIZED', 'invalid code');
    return reply.send({ ok: true });
  });

  app.post('/api/v1/auth/totp/recovery/verify', async (req, reply) => {
    const { email, code, longLived } = (req.body ?? {}) as any;
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) throw new AppError('UNAUTHORIZED', 'invalid recovery');
    const h = hashCode(String(code));
    if (!user.recoveryCodes.includes(h)) throw new AppError('UNAUTHORIZED', 'invalid recovery code');
    await prisma.user.update({ where: { id: user.id }, data: { recoveryCodes: user.recoveryCodes.filter((x) => x !== h) } }); // consume
    const session = await issueSession(prisma, accessSecret, { id: user.id, roles: user.roles, branch: user.branch, mfaComplete: true }, !!longLived);
    return reply.send(session);
  });
}
