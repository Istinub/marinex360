import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export function daysBefore(now: Date, days: number): Date {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}

export async function reconcileJobOrderLifecycle(now: Date = new Date()): Promise<{ purged: number; archived: number }> {
  const trashCutoff = daysBefore(now, 30);
  const archiveCutoff = daysBefore(now, 15);

  const purged = await prisma.jobOrder.updateMany({
    where: {
      deletedAt: { lte: trashCutoff },
      purgedAt: null,
    },
    data: { purgedAt: now },
  });

  const completedCandidates = await prisma.jobStatusHistory.findMany({
    where: {
      toState: "COMPLETED",
      at: { lte: archiveCutoff },
      jobOrder: {
        state: "COMPLETED",
        deletedAt: null,
        archivedAt: null,
        purgedAt: null,
      },
    },
    distinct: ["jobOrderId"],
    select: { jobOrderId: true },
  });

  const archived = completedCandidates.length > 0
    ? await prisma.jobOrder.updateMany({
      where: {
        id: { in: completedCandidates.map((candidate) => candidate.jobOrderId) },
        state: "COMPLETED",
        deletedAt: null,
        archivedAt: null,
        purgedAt: null,
      },
      data: { archivedAt: now },
    })
    : { count: 0 };

  return { purged: purged.count, archived: archived.count };
}
