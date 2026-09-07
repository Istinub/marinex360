-- Extend the older JSON-backed ChecklistTemplate into named reusable templates,
-- and add per-job snapshot checklist items.

ALTER TABLE "ChecklistTemplate"
  ADD COLUMN "categoryId" TEXT,
  ADD COLUMN "createdBy" TEXT NOT NULL DEFAULT 'system',
  ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

UPDATE "ChecklistTemplate"
SET "categoryId" = "serviceCategory"
WHERE "serviceCategory" IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM "ChecklistCategory"
    WHERE "ChecklistCategory"."id" = "ChecklistTemplate"."serviceCategory"
  );

CREATE TABLE "ChecklistTemplateEntry" (
  "id" TEXT NOT NULL,
  "templateId" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,

  CONSTRAINT "ChecklistTemplateEntry_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "JobOrderChecklistItem" (
  "id" TEXT NOT NULL,
  "jobOrderId" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "checked" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "JobOrderChecklistItem_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ChecklistTemplate_categoryId_idx" ON "ChecklistTemplate"("categoryId");
CREATE INDEX "ChecklistTemplateEntry_templateId_sortOrder_idx" ON "ChecklistTemplateEntry"("templateId", "sortOrder");
CREATE INDEX "JobOrderChecklistItem_jobOrderId_sortOrder_idx" ON "JobOrderChecklistItem"("jobOrderId", "sortOrder");

ALTER TABLE "ChecklistTemplate"
  ADD CONSTRAINT "ChecklistTemplate_categoryId_fkey"
  FOREIGN KEY ("categoryId") REFERENCES "ChecklistCategory"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ChecklistTemplateEntry"
  ADD CONSTRAINT "ChecklistTemplateEntry_templateId_fkey"
  FOREIGN KEY ("templateId") REFERENCES "ChecklistTemplate"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "JobOrderChecklistItem"
  ADD CONSTRAINT "JobOrderChecklistItem_jobOrderId_fkey"
  FOREIGN KEY ("jobOrderId") REFERENCES "JobOrder"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
