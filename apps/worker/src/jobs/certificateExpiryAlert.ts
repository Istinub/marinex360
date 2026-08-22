// FR-48/FR-60: recurring certificate-expiry alert. D-038-pattern config value for the window
// (not hardcoded, not final); D-042 direct alertedAt dedup field prevents re-alerting each run.
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export const ALERT_WINDOW_DAYS = Number(process.env.CERT_EXPIRY_ALERT_DAYS ?? "30"); // TODO-CERT-EXPIRY-WINDOW placeholder
const OFFICE_ALERT_ROLES = ["SYSTEM_ADMIN", "DIRECTOR", "OPS_SUPERVISOR"];

export function certificateExpiryWindowEnd(now: Date = new Date(), windowDays: number = ALERT_WINDOW_DAYS): Date {
  return new Date(now.getTime() + windowDays * 24 * 60 * 60 * 1000);
}

export function isCertificateExpiryAlertCandidate(
  cert: { deletedAt: Date | null; alertedAt: Date | null; expiresAt: Date },
  now: Date = new Date(),
  windowDays: number = ALERT_WINDOW_DAYS,
): boolean {
  return cert.deletedAt == null && cert.alertedAt == null && cert.expiresAt <= certificateExpiryWindowEnd(now, windowDays);
}

async function ownerBranch(tx: PrismaClient, cert: { ownerType: string; ownerId: string }): Promise<string | null> {
  if (cert.ownerType === "COMPANY") return null;
  if (cert.ownerType === "TECHNICIAN") {
    const user = await tx.user.findFirst({ where: { id: cert.ownerId, active: true }, select: { branch: true } });
    return user?.branch ?? null;
  }
  if (cert.ownerType === "VESSEL") {
    const vessel = await tx.vessel.findFirst({
      where: { id: cert.ownerId, deletedAt: null },
      select: { client: { select: { branch: true, deletedAt: true } } },
    });
    return vessel?.client.deletedAt == null ? vessel?.client.branch ?? null : null;
  }
  return null;
}

async function alertRecipients(tx: PrismaClient, branch: string | null): Promise<{ id: string }[]> {
  return tx.user.findMany({
    where: {
      active: true,
      roles: { hasSome: OFFICE_ALERT_ROLES },
      ...(branch ? { OR: [{ branch }, { roles: { hasSome: ["SYSTEM_ADMIN", "DIRECTOR"] } }] } : {}),
    },
    select: { id: true },
  });
}

export async function reconcileCertificateExpiryAlerts(now: Date = new Date()): Promise<{ alerted: number }> {
  const windowEnd = certificateExpiryWindowEnd(now);
  const certificates = await prisma.certificate.findMany({
    where: { deletedAt: null, alertedAt: null, expiresAt: { lte: windowEnd } },
    select: {
      id: true,
      ownerType: true,
      ownerId: true,
      certType: true,
      identifier: true,
      expiresAt: true,
    },
  });

  let alerted = 0;
  for (const cert of certificates) {
    const didAlert = await prisma.$transaction(async (tx) => {
      const fresh = await tx.certificate.findUnique({ where: { id: cert.id } });
      if (!fresh || !isCertificateExpiryAlertCandidate(fresh, now)) return false;

      const branch = await ownerBranch(tx as unknown as PrismaClient, fresh);
      const recipients = await alertRecipients(tx as unknown as PrismaClient, branch);
      const title = `Certificate ${fresh.certType} is expiring`;
      const body = `Certificate ${fresh.certType}${fresh.identifier ? ` (${fresh.identifier})` : ""} expires on ${fresh.expiresAt.toISOString().slice(0, 10)}.`;

      await tx.notification.createMany({
        data: recipients.map((recipient) => ({
          recipientId: recipient.id,
          kind: "CERTIFICATE_EXPIRING",
          title,
          body,
        })),
      });
      await tx.certificate.update({ where: { id: fresh.id }, data: { alertedAt: now } });
      await tx.auditEntry.create({
        data: {
          entityType: "Certificate",
          entityId: fresh.id,
          action: "EXPIRY_ALERT",
          actorId: "system:certificate-expiry-alert",
          diff: { at: now, recipientCount: recipients.length },
        },
      });
      return true;
    });

    if (didAlert) alerted += 1;
  }

  return { alerted };
}
