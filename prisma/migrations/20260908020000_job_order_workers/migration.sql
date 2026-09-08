CREATE TABLE "JobOrderWorker" (
  "id" TEXT NOT NULL,
  "jobOrderId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "JobOrderWorker_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "JobOrderWorker"
  ADD CONSTRAINT "JobOrderWorker_jobOrderId_fkey"
  FOREIGN KEY ("jobOrderId") REFERENCES "JobOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "JobOrderWorker_jobOrderId_idx" ON "JobOrderWorker"("jobOrderId");
CREATE INDEX "JobOrderWorker_name_idx" ON "JobOrderWorker"("name");
CREATE INDEX "JobOrderWorker_addedAt_idx" ON "JobOrderWorker"("addedAt");
