import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import {
  certificateExpiryWindowEnd,
  isCertificateExpiryAlertCandidate,
  reconcileCertificateExpiryAlerts,
} from '../src/jobs/certificateExpiryAlert.js';

describe('certificate expiry alert rules', () => {
  const now = new Date('2026-08-01T00:00:00Z');

  it('uses a configurable day window', () => {
    expect(certificateExpiryWindowEnd(now, 30).toISOString()).toBe('2026-08-31T00:00:00.000Z');
  });

  it('selects only non-deleted, non-alerted certificates expiring inside the window', () => {
    expect(isCertificateExpiryAlertCandidate({ deletedAt: null, alertedAt: null, expiresAt: new Date('2026-08-31T00:00:00Z') }, now, 30)).toBe(true);
    expect(isCertificateExpiryAlertCandidate({ deletedAt: new Date(), alertedAt: null, expiresAt: new Date('2026-08-15T00:00:00Z') }, now, 30)).toBe(false);
    expect(isCertificateExpiryAlertCandidate({ deletedAt: null, alertedAt: new Date(), expiresAt: new Date('2026-08-15T00:00:00Z') }, now, 30)).toBe(false);
    expect(isCertificateExpiryAlertCandidate({ deletedAt: null, alertedAt: null, expiresAt: new Date('2026-09-02T00:00:00Z') }, now, 30)).toBe(false);
  });
});

const runDb = process.env.RUN_DB_TESTS ? describe : describe.skip;

runDb('certificate expiry alert job (integration)', () => {
  let prisma: PrismaClient;
  let certId: string;

  beforeAll(async () => {
    prisma = new PrismaClient();
    const uniq = Date.now().toString().slice(-9);
    const ops = await prisma.user.upsert({
      where: { email: `worker-cert-ops-${uniq}@tkmr.local` },
      update: {},
      create: {
        email: `worker-cert-ops-${uniq}@tkmr.local`,
        name: 'Worker Cert Ops',
        passwordHash: 'x',
        roles: ['OPS_SUPERVISOR'],
        branch: 'SG',
      },
    });
    const tech = await prisma.user.create({
      data: {
        email: `worker-cert-tech-${uniq}@tkmr.local`,
        name: 'Worker Cert Tech',
        passwordHash: 'x',
        roles: ['TECHNICIAN'],
        branch: ops.branch,
      },
    });
    const cert = await prisma.certificate.create({
      data: {
        ownerType: 'TECHNICIAN',
        ownerId: tech.id,
        certType: 'HUET',
        identifier: `HUET-${uniq}`,
        expiresAt: new Date('2026-08-20T00:00:00Z'),
      },
    });
    certId = cert.id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('sets alertedAt and does not create duplicate notifications when run twice', async () => {
    const now = new Date('2026-08-01T00:00:00Z');
    const first = await reconcileCertificateExpiryAlerts(now);
    const second = await reconcileCertificateExpiryAlerts(now);

    expect(first.alerted).toBeGreaterThanOrEqual(1);
    expect(second.alerted).toBe(0);

    const cert = await prisma.certificate.findUniqueOrThrow({ where: { id: certId } });
    expect(cert.alertedAt?.toISOString()).toBe(now.toISOString());
    expect(await prisma.auditEntry.count({ where: { entityType: 'Certificate', entityId: certId, action: 'EXPIRY_ALERT' } })).toBe(1);
    expect(await prisma.notification.count({ where: { kind: 'CERTIFICATE_EXPIRING', body: { contains: 'HUET' } } })).toBeGreaterThanOrEqual(1);
  });
});
