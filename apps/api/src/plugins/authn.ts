// Authentication: verify the Bearer access token and attach RequestContext. branch/roles come
// ONLY from the verified token (RBAC-SPOOF-1). Also exposes guards used by routes.
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { verifyAccessToken } from '../auth/tokens.js';
import { AppError } from '../lib/errors.js';
import { assertCan, requiresMfaAtLogin, type Action, type Role } from '../domain/rbac.js';
import type { RequestContext } from '../services/context.js';

declare module 'fastify' {
  interface FastifyRequest { ctx: RequestContext; }
}

export function registerAuthn(app: FastifyInstance, opts: { accessSecret: string }): void {
  app.decorateRequest('ctx', null as unknown as RequestContext);

  app.decorate('authenticate', async (req: FastifyRequest) => {
    const h = req.headers.authorization;
    if (!h?.startsWith('Bearer ')) throw new AppError('UNAUTHORIZED', 'missing bearer token');
    const claims = verifyAccessToken(h.slice(7), opts.accessSecret);
    req.ctx = { userId: claims.sub, roles: claims.roles as Role[], branch: claims.branch };
    // NFR-07: admin/finance may authenticate to ENROL but hold no full-access token until enrolled.
    (req as any)._mfaComplete = claims.mfaComplete ?? !requiresMfaAtLogin(claims.roles as Role[]);
  });

  // Route guard: business endpoints require MFA-complete for admin/finance.
  app.decorate('requireMfaEnrolled', async (req: FastifyRequest) => {
    if (!(req as any)._mfaComplete) throw new AppError('FORBIDDEN', 'TOTP enrolment required before this action');
  });

  // Route guard factory: RBAC action check.
  app.decorate('requireAction', (action: Action) => async (req: FastifyRequest) => assertCan(req.ctx.roles, action));
}

// Fastify type augmentation for the decorators above.
declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requireMfaEnrolled: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requireAction: (action: Action) => (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}
