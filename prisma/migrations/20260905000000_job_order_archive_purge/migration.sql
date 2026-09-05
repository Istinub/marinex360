ALTER TABLE "JobOrder"
  ADD COLUMN IF NOT EXISTS "archivedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "purgedAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "JobOrder_archivedAt_idx" ON "JobOrder"("archivedAt");
CREATE INDEX IF NOT EXISTS "JobOrder_purgedAt_idx" ON "JobOrder"("purgedAt");
