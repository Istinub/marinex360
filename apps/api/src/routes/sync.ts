// Sync endpoints — INTERFACE_CONTRACT v1.1 §4. Real per-op apply (was a Phase-1 stub) +
// real /sync/assigned delta (Mobile R-8), closing the two endpoints Mobile needs to wire a
// live backend instead of Mobile_app_mockServer.js for S0-6.
import type { FastifyInstance } from 'fastify';
import type { Prisma, PrismaClient } from '@prisma/client';
import { AppError, type ErrorCode } from '../lib/errors.js';
import { findProcessedOp, recordProcessedOp, type OpApplyStatus } from '../services/idempotency.js';
import { appendAudit } from '../services/audit.js';
import { isDispatched, resolveReviewState, snapshotLabourRate, parseChangeSeqCursor, WRITABLE_ENTITIES, type WritableEntity } from '../domain/sync.js';
import { validateItemDefs, validateResults } from '../domain/checklist.js';

export const SYNC_SCHEMA_VERSION = 1;
const MAX_BATCH = 200; // contract §1 batch bound

interface SyncOp {
  opId: string;
  entity: WritableEntity;
  action: 'CREATE' | 'UPDATE';
  entityId: string;
  jobOrderId: string;
  payload: Record<string, unknown>;
  baseVersion?: number | null;
}

interface OpResult {
  opId: string;
  status: OpApplyStatus | 'IDEMPOTENT_REPLAY' | ErrorCode;
  resultRef?: string;
  serverVersion?: number;
  reviewState?: string;
  error?: { code: string; message: string };
}

const DELEGATE: Record<WritableEntity, string> = {
  WorkLog: 'workLog', Photo: 'photo', Observation: 'observation',
  ChecklistInstance: 'checklistInstance', MaterialLine: 'materialLine', ESignature: 'eSignature',
};

/** Build the entity-specific `data` for CREATE, stripping anything the client shouldn't control. */
function buildCreateData(entity: WritableEntity, p: Record<string, unknown>, ctx: { userId: string }, jo: any) {
  switch (entity) {
    case 'WorkLog': {
      const rate = snapshotLabourRate(jo); // CC-9 — snapshotted at CREATE, never re-resolved
      return {
        technicianId: ctx.userId, // never trust payload for actor identity
        startedAt: p.startedAt, endedAt: p.endedAt ?? null,
        labourRateAmountMinor: rate.amountMinor, labourRateCurrency: rate.currency,
      };
    }
    case 'Photo':
      return { s3Key: p.s3Key ?? null, phase: p.phase, geoLat: p.geoLat ?? null, geoLng: p.geoLng ?? null, takenAt: p.takenAt, capturedById: ctx.userId };
    case 'Observation':
      return { templateKey: p.templateKey ?? null, body: p.body, authorId: ctx.userId };
    case 'ChecklistInstance':
      return { templateId: p.templateId, results: [] };
    case 'MaterialLine':
      return {
        partCatalogId: p.partCatalogId ?? null, description: p.description, quantity: p.quantity, unit: p.unit,
        unitCostAmountMinor: p.unitCostAmountMinor, unitCostCurrency: p.unitCostCurrency,
        source: p.source ?? 'FIELD', addedById: ctx.userId,
      };
    case 'ESignature':
      // D-059/CC-18 (ratified): full OD-06 evidence bundle now captured, not just the image fallback.
      return {
        imageS3Key: p.imageS3Key ?? null,
        signerName: p.signerName ?? null,
        signerRole: p.signerRole ?? null,
        signedAt: p.signedAt ?? null,
        deviceId: p.deviceId ?? null,
        geoLat: p.geoLat ?? null,
        geoLng: p.geoLng ?? null,
        documentHash: p.documentHash ?? null,
      };
  }
}

function buildUpdateData(entity: WritableEntity, p: Record<string, unknown>) {
  switch (entity) {
    case 'WorkLog': return { endedAt: p.endedAt };
    case 'Photo': return { phase: p.phase, geoLat: p.geoLat, geoLng: p.geoLng };
    case 'Observation': return { body: p.body };
    case 'ChecklistInstance': return { results: p.results }; // validated separately before this is called
    case 'MaterialLine': return { description: p.description, quantity: p.quantity, unitCostAmountMinor: p.unitCostAmountMinor, unitCostCurrency: p.unitCostCurrency };
    case 'ESignature': return {}; // D-059: signatures are immutable; applyOp rejects UPDATE before this is used.
  }
}

async function buildChecklistCreateData(
  tx: Prisma.TransactionClient,
  p: Record<string, unknown>,
  ctx: { userId: string },
): Promise<OpResult | Record<string, unknown>> {
  if (typeof p.templateId !== 'string' || !p.templateId) {
    return { opId: '', status: 'VALIDATION_ERROR', error: { code: 'VALIDATION_ERROR', message: 'templateId required' } };
  }

  const template = await tx.checklistTemplate.findUnique({ where: { id: p.templateId } });
  if (!template || !template.active) {
    return { opId: '', status: 'VALIDATION_ERROR', error: { code: 'TEMPLATE_NOT_FOUND', message: String(p.templateId) } };
  }

  if (!('results' in p)) return { templateId: p.templateId, results: [] };

  try {
    const defs = validateItemDefs(template.items);
    const validated = validateResults(defs, p.results);
    const completedAt = p.completedAt ? new Date(String(p.completedAt)) : new Date();
    if (Number.isNaN(completedAt.getTime())) {
      return { opId: '', status: 'VALIDATION_ERROR', error: { code: 'VALIDATION_ERROR', message: 'completedAt is invalid' } };
    }

    return {
      templateId: p.templateId,
      results: validated,
      completedById: ctx.userId,
      completedAt,
    };
  } catch (e) {
    const msg = e instanceof AppError ? e.message : 'invalid checklist results';
    return { opId: '', status: 'VALIDATION_ERROR', error: { code: 'VALIDATION_ERROR', message: msg } };
  }
}

function isOpResult(value: OpResult | Record<string, unknown>): value is OpResult {
  return typeof value.status === 'string';
}

async function applyOp(tx: Prisma.TransactionClient, ctx: { userId: string; branch: string }, op: SyncOp): Promise<OpResult> {
  // Idempotent replay — return the ORIGINAL result, do nothing else (SYNC-02).
  const prior = await findProcessedOp(tx, op.opId);
  if (prior) return { opId: op.opId, status: 'IDEMPOTENT_REPLAY', resultRef: prior.resultRef ?? undefined };

  if (!WRITABLE_ENTITIES.has(op.entity)) {
    return { opId: op.opId, status: 'VALIDATION_ERROR', error: { code: 'UNKNOWN_ENTITY', message: String(op.entity) } };
  }
  const jo = await tx.jobOrder.findFirst({ where: { id: op.jobOrderId, deletedAt: null } });
  if (!jo) return { opId: op.opId, status: 'VALIDATION_ERROR', error: { code: 'UNKNOWN_JOB', message: op.jobOrderId } };
  if (jo.branch !== ctx.branch) {
    // Cross-branch — contract ADR-7: NOT_FOUND-equivalent for direct access, but a sync op
    // targeting the wrong branch entirely is a distinct, explicit denial (BRANCH_SCOPE_DENIED).
    return { opId: op.opId, status: 'BRANCH_SCOPE_DENIED', error: { code: 'BRANCH_SCOPE_DENIED', message: 'job order is in another branch' } };
  }

  if (op.entity === 'ESignature' && jo.executionOwnerId !== ctx.userId) {
    return { opId: op.opId, status: 'FORBIDDEN', error: { code: 'FORBIDDEN', message: "only the job's execution owner may sign" } };
  }
  if (op.entity === 'ESignature' && op.action === 'UPDATE') {
    return { opId: op.opId, status: 'VALIDATION_ERROR', error: { code: 'VALIDATION_ERROR', message: 'ESignature is immutable and cannot be updated' } };
  }

  const { flagged, reviewState } = resolveReviewState(jo, ctx.userId); // D-002/SYNC-13

  const delegate = (tx as any)[DELEGATE[op.entity]];

  if (op.action === 'UPDATE') {
    const existing = await delegate.findUnique({ where: { id: op.entityId } });
    if (!existing) return { opId: op.opId, status: 'VALIDATION_ERROR', error: { code: 'ROW_NOT_FOUND', message: op.entityId } };
    if (typeof op.baseVersion === 'number' && op.baseVersion !== existing.version) {
      return { opId: op.opId, status: 'VERSION_CONFLICT', serverVersion: existing.version };
    }
    let data: Record<string, unknown>;
    if (op.entity === 'ChecklistInstance') {
      const template = await tx.checklistTemplate.findUnique({ where: { id: existing.templateId } });
      if (!template) return { opId: op.opId, status: 'VALIDATION_ERROR', error: { code: 'TEMPLATE_NOT_FOUND', message: existing.templateId } };
      try {
        const defs = validateItemDefs(template.items);
        const validated = validateResults(defs, op.payload.results);
        data = { results: validated, completedById: ctx.userId, completedAt: new Date() };
      } catch (e) {
        const msg = e instanceof AppError ? e.message : 'invalid checklist results';
        return { opId: op.opId, status: 'VALIDATION_ERROR', error: { code: 'VALIDATION_ERROR', message: msg } };
      }
    } else {
      data = buildUpdateData(op.entity, op.payload) as Record<string, unknown>;
    }
    const updated = await delegate.update({ where: { id: op.entityId }, data: { ...data, reviewState, version: { increment: 1 } } });
    await recordProcessedOp(tx, { opId: op.opId, entity: op.entity, action: 'UPDATE', resultRef: updated.id, status: flagged ? 'APPLIED_FLAGGED' : 'APPLIED' });
    await appendAudit(tx, ctx as any, { entityType: op.entity, entityId: updated.id, action: 'UPDATE', diff: { via: 'sync', flagged } });
    return flagged
      ? { opId: op.opId, status: 'APPLIED_FLAGGED', resultRef: updated.id, serverVersion: updated.version, reviewState: reviewState! }
      : { opId: op.opId, status: 'APPLIED', resultRef: updated.id, serverVersion: updated.version };
  }

  // CREATE — client supplies entityId (CC-MOB-1); persisted as-is so resultRef == id.
  let data: Record<string, unknown>;
  if (op.entity === 'ChecklistInstance') {
    const checklistData = await buildChecklistCreateData(tx, op.payload, ctx);
    if (isOpResult(checklistData)) return { ...checklistData, opId: op.opId };
    data = checklistData;
  } else {
    data = buildCreateData(op.entity, op.payload, ctx, jo);
  }
  const created = await delegate.create({ data: { id: op.entityId, jobOrderId: op.jobOrderId, opId: op.opId, reviewState, ...data } });
  await recordProcessedOp(tx, { opId: op.opId, entity: op.entity, action: 'CREATE', resultRef: created.id, status: flagged ? 'APPLIED_FLAGGED' : 'APPLIED' });
  await appendAudit(tx, ctx as any, { entityType: op.entity, entityId: created.id, action: 'CREATE', diff: { via: 'sync', flagged } });
  return flagged
    ? { opId: op.opId, status: 'APPLIED_FLAGGED', resultRef: created.id, serverVersion: created.version, reviewState: reviewState! }
    : { opId: op.opId, status: 'APPLIED', resultRef: created.id, serverVersion: created.version };
}

export function syncRoutes(app: FastifyInstance, prisma: PrismaClient): void {
  const authed = { preHandler: [app.authenticate, app.requireMfaEnrolled] };

  app.post('/api/v1/sync/batch', authed, async (req, reply) => {
    const { schemaVersion, ops } = (req.body ?? {}) as any;
    if (schemaVersion !== SYNC_SCHEMA_VERSION) {
      // Whole batch rejected, queue preserved client-side, never partially applied (ADR-3).
      throw new AppError('BATCH_REJECTED_SCHEMA', `expected schemaVersion ${SYNC_SCHEMA_VERSION}`);
    }
    if (!Array.isArray(ops)) throw new AppError('VALIDATION_ERROR', 'ops[] required');
    if (ops.length > MAX_BATCH) throw new AppError('BATCH_REJECTED_SCHEMA', `batch exceeds ${MAX_BATCH} ops`);

    const results: OpResult[] = [];
    // Each op is its own transaction — one op's failure never rolls back another (SYNC-08:
    // per-op results, not all-or-nothing).
    for (const op of ops as SyncOp[]) {
      try {
        const result = await prisma.$transaction((tx) => applyOp(tx, req.ctx, op));
        results.push(result);
      } catch (e) {
        if (e instanceof AppError) {
          results.push({ opId: op.opId, status: e.code, error: { code: e.code, message: e.message } });
        } else {
          req.log.error(e);
          results.push({ opId: op.opId, status: 'VALIDATION_ERROR', error: { code: 'INTERNAL', message: 'apply failed' } });
        }
      }
    }
    return reply.send({ schemaVersion: SYNC_SCHEMA_VERSION, results });
  });

  // GET /sync/assigned?since=<changeSeq> -- D-012 CLOSED: monotonic changeSeq cursor, not
  // timestamp-based. Cursor values are bigint, transmitted as decimal strings (JSON has no
  // native bigint) -- both in the query param and the response.
  app.get('/api/v1/sync/assigned', authed, async (req) => {
    const since = parseChangeSeqCursor((req.query as any)?.since);
    const userId = req.ctx.userId;

    const jobOrders = await prisma.jobOrder.findMany({
      where: {
        branch: req.ctx.branch, deletedAt: null,
        OR: [{ assignedTechnicianIds: { has: userId } }, { executionOwnerId: userId }],
      },
    });
    const joIds = jobOrders.map((j) => j.id);
    const changedJobOrders = jobOrders.filter((j) => j.changeSeq > since);

    const whereChild = { jobOrderId: { in: joIds }, changeSeq: { gt: since } } as const;
    const [worklogs, photos, observations, checklists, materials, esignatures] = await Promise.all([
      prisma.workLog.findMany({ where: whereChild }),
      prisma.photo.findMany({ where: whereChild }),
      prisma.observation.findMany({ where: whereChild }),
      prisma.checklistInstance.findMany({ where: whereChild }),
      prisma.materialLine.findMany({ where: whereChild }),
      prisma.eSignature.findMany({ where: whereChild }),
    ]);

    const allSeqs: bigint[] = [
      ...changedJobOrders.map((j) => j.changeSeq),
      ...worklogs.map((r) => r.changeSeq),
      ...photos.map((r) => r.changeSeq),
      ...observations.map((r) => r.changeSeq),
      ...checklists.map((r) => r.changeSeq),
      ...materials.map((r) => r.changeSeq),
      ...esignatures.map((r) => r.changeSeq),
    ];
    const newCursor = allSeqs.length ? allSeqs.reduce((a, b) => (b > a ? b : a)) : since;

    const stringifySeq = <T extends { changeSeq: bigint }>(rows: T[]) =>
      rows.map((r) => ({ ...r, changeSeq: r.changeSeq.toString() }));

    return {
      cursor: newCursor.toString(),
      jobOrders: stringifySeq(changedJobOrders),
      children: {
        worklogs: stringifySeq(worklogs),
        photos: stringifySeq(photos),
        observations: stringifySeq(observations),
        checklists: stringifySeq(checklists),
        materials: stringifySeq(materials),
        esignatures: stringifySeq(esignatures),
      },
    };
  });
}
