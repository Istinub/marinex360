CREATE TABLE "JobOrderEditHistory" (
  "id" TEXT NOT NULL,
  "jobOrderId" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "changedFields" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "JobOrderEditHistory_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "JobOrderEditHistory_jobOrderId_createdAt_idx" ON "JobOrderEditHistory"("jobOrderId", "createdAt");
CREATE INDEX "JobOrderEditHistory_actorId_idx" ON "JobOrderEditHistory"("actorId");

ALTER TABLE "JobOrderEditHistory" ADD CONSTRAINT "JobOrderEditHistory_jobOrderId_fkey" FOREIGN KEY ("jobOrderId") REFERENCES "JobOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "JobOrderEditHistory" ADD CONSTRAINT "JobOrderEditHistory_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
