// CRM routes (P1-3/P1-4). OD-03: personal data lives once in Contact, referenced by id.
// Soft-delete only (SOFTDEL-1). Optimistic version on updates. Branch scoping throughout.
import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import { AppError } from '../lib/errors.js';
import { scopeWhere, assertBranchAccess, branchForCreate } from '../services/branchScope.js';
import { isCrossBranch } from '../domain/rbac.js';
import { appendAudit } from '../services/audit.js';

// D-019: Contact has no `branch` column by design (can serve Clients across branches).
// Non-cross-branch roles may access a Contact only if it's `primaryContactId` for a Client
// in the caller's branch; cross-branch roles (DIRECTOR/SYSTEM_ADMIN) are unrestricted.
// 404 NOT_FOUND otherwise — same existence-masking convention as everywhere else.
async function assertContactAccessible(prisma: PrismaClient, ctx: { roles: string[]; branch: string }, contactId: string): Promise<void> {
  if (isCrossBranch(ctx.roles as any)) return;
  const linked = await prisma.client.findFirst({ where: { primaryContactId: contactId, branch: ctx.branch, deletedAt: null } });
  if (!linked) throw new AppError('NOT_FOUND');
}

export function crmRoutes(app: FastifyInstance, prisma: PrismaClient): void {
  const w = (a: string) => ({ preHandler: [app.authenticate, app.requireMfaEnrolled, app.requireAction(a as any)] });

  // ---- Contacts (personal data, OD-03) ----
  app.post('/api/v1/contacts', w('contact:write'), async (req, reply) => {
    const b = (req.body ?? {}) as any;
    if (!b.name) throw new AppError('VALIDATION_ERROR', 'name required');
    const c = await prisma.$transaction(async (tx) => {
      const contact = await tx.contact.create({ data: { name: b.name, email: b.email ?? null, phone: b.phone ?? null } });
      await appendAudit(tx, req.ctx, { entityType: 'Contact', entityId: contact.id, action: 'CREATE' });
      return contact;
    });
    return reply.status(201).send(c);
  });

  app.get('/api/v1/contacts/:id', w('contact:read'), async (req) => {
    const { id } = req.params as any;
    const c = await prisma.contact.findUnique({ where: { id } });
    if (!c) throw new AppError('NOT_FOUND');
    await assertContactAccessible(prisma, req.ctx, id); // D-019
    return c;
  });

  app.patch('/api/v1/contacts/:id', w('contact:write'), async (req) => {
    const { id } = req.params as any; const b = (req.body ?? {}) as any;
    if (typeof b.version !== 'number') throw new AppError('VALIDATION_ERROR', 'version required');
    return prisma.$transaction(async (tx) => {
      const c = await tx.contact.findUnique({ where: { id } });
      if (!c) throw new AppError('NOT_FOUND');
      await assertContactAccessible(tx as any, req.ctx, id); // D-019, checked before version (CC-05 convention)
      const data: any = {};
      for (const f of ['name', 'email', 'phone']) if (f in b) data[f] = b[f];
      const res = await tx.contact.updateMany({ where: { id, version: b.version }, data: { ...data, version: { increment: 1 } } });
      if (res.count === 0) throw new AppError('VERSION_CONFLICT');
      await appendAudit(tx, req.ctx, { entityType: 'Contact', entityId: id, action: 'UPDATE', diff: data });
      return tx.contact.findUnique({ where: { id } });
    });
  });

  // ---- Clients ----
  app.post('/api/v1/clients', w('client:write'), async (req, reply) => {
    const b = (req.body ?? {}) as any;
    if (!b.name) throw new AppError('VALIDATION_ERROR', 'name required');
    const branch = branchForCreate(req.ctx);
    const client = await prisma.$transaction(async (tx) => {
      const c = await tx.client.create({ data: { branch, name: b.name, address: b.address ?? null, creditTerms: b.creditTerms ?? null, status: b.status ?? 'ACTIVE', primaryContactId: b.primaryContactId ?? null } });
      await appendAudit(tx, req.ctx, { entityType: 'Client', entityId: c.id, action: 'CREATE' });
      return c;
    });
    return reply.status(201).send(client);
  });

  app.get('/api/v1/clients', w('client:read'), async (req) =>
    prisma.client.findMany({ where: { ...scopeWhere(req.ctx), deletedAt: null }, orderBy: { name: 'asc' } }));

  app.get('/api/v1/clients/:id', w('client:read'), async (req) => {
    const { id } = req.params as any;
    const c = await prisma.client.findFirst({ where: { id, deletedAt: null }, include: { primaryContact: true, vessels: { where: { deletedAt: null } } } });
    if (!c) throw new AppError('NOT_FOUND');
    assertBranchAccess(req.ctx, c.branch);
    return c;
  });

  app.patch('/api/v1/clients/:id', w('client:write'), async (req) => {
    const { id } = req.params as any; const b = (req.body ?? {}) as any;
    if (typeof b.version !== 'number') throw new AppError('VALIDATION_ERROR', 'version required');
    return prisma.$transaction(async (tx) => {
      const c = await tx.client.findFirst({ where: { id, deletedAt: null } });
      if (!c) throw new AppError('NOT_FOUND');
      assertBranchAccess(req.ctx, c.branch);
      const data: any = {};
      for (const f of ['name', 'address', 'creditTerms', 'status', 'primaryContactId']) if (f in b) data[f] = b[f];
      const res = await tx.client.updateMany({ where: { id, version: b.version }, data: { ...data, version: { increment: 1 } } });
      if (res.count === 0) throw new AppError('VERSION_CONFLICT');
      await appendAudit(tx, req.ctx, { entityType: 'Client', entityId: id, action: 'UPDATE', diff: data });
      return tx.client.findUnique({ where: { id } });
    });
  });

  app.delete('/api/v1/clients/:id', w('client:write'), async (req) => {
    const { id } = req.params as any; // SOFTDEL-1: soft-delete only
    return prisma.$transaction(async (tx) => {
      const c = await tx.client.findFirst({ where: { id, deletedAt: null } });
      if (!c) throw new AppError('NOT_FOUND');
      assertBranchAccess(req.ctx, c.branch);
      await tx.client.update({ where: { id }, data: { deletedAt: new Date() } });
      await appendAudit(tx, req.ctx, { entityType: 'Client', entityId: id, action: 'SOFT_DELETE' });
      return { id, deleted: true };
    });
  });

  // ---- Vessels (P1-4). imoNumber unique; duplicate -> VALIDATION_ERROR (FR-02) ----
  app.post('/api/v1/vessels', w('vessel:write'), async (req, reply) => {
    const b = (req.body ?? {}) as any;
    if (!b.clientId || !b.imoNumber || !b.name) throw new AppError('VALIDATION_ERROR', 'clientId, imoNumber, name required');
    const client = await prisma.client.findFirst({ where: { id: b.clientId, deletedAt: null } });
    if (!client) throw new AppError('NOT_FOUND', 'client not found');
    assertBranchAccess(req.ctx, client.branch);
    const existing = await prisma.vessel.findUnique({ where: { imoNumber: b.imoNumber } });
    if (existing) throw new AppError('VALIDATION_ERROR', 'imoNumber already registered');
    const v = await prisma.$transaction(async (tx) => {
      const vessel = await tx.vessel.create({ data: { clientId: b.clientId, imoNumber: b.imoNumber, name: b.name, type: b.type ?? null, flag: b.flag ?? null, classification: b.classification ?? null } });
      await appendAudit(tx, req.ctx, { entityType: 'Vessel', entityId: vessel.id, action: 'CREATE' });
      return vessel;
    });
    return reply.status(201).send(v);
  });

  // Vessel service history (FR-03) — JOs for the vessel, branch-scoped.
  app.get('/api/v1/vessels/:id/job-orders', w('vessel:read'), async (req) => {
    const { id } = req.params as any;
    const vessel = await prisma.vessel.findUnique({ where: { id }, include: { client: true } });
    if (!vessel) throw new AppError('NOT_FOUND');
    assertBranchAccess(req.ctx, vessel.client.branch);
    return prisma.jobOrder.findMany({ where: { vesselId: id, ...scopeWhere(req.ctx), deletedAt: null }, orderBy: { createdAt: 'desc' } });
  });
}
