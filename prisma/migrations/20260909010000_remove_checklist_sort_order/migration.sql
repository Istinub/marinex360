DROP INDEX IF EXISTS "ChecklistCategory_sortOrder_idx";
DROP INDEX IF EXISTS "ChecklistTemplateItem_categoryId_sortOrder_idx";
DROP INDEX IF EXISTS "ChecklistTemplateEntry_templateId_sortOrder_idx";
DROP INDEX IF EXISTS "JobOrderChecklistItem_jobOrderId_sortOrder_idx";

ALTER TABLE "ChecklistCategory" ADD COLUMN "createdAt" TIMESTAMP(3);
ALTER TABLE "ChecklistTemplateItem" ADD COLUMN "createdAt" TIMESTAMP(3);
ALTER TABLE "ChecklistTemplateEntry" ADD COLUMN "createdAt" TIMESTAMP(3);

UPDATE "ChecklistCategory"
SET "createdAt" = TIMESTAMP '2026-01-01 00:00:00' + ("sortOrder" * INTERVAL '1 second')
WHERE "createdAt" IS NULL;

UPDATE "ChecklistTemplateItem"
SET "createdAt" = TIMESTAMP '2026-01-01 00:00:00' + ("sortOrder" * INTERVAL '1 second')
WHERE "createdAt" IS NULL;

UPDATE "ChecklistTemplateEntry"
SET "createdAt" = TIMESTAMP '2026-01-01 00:00:00' + ("sortOrder" * INTERVAL '1 second')
WHERE "createdAt" IS NULL;

ALTER TABLE "ChecklistCategory" ALTER COLUMN "createdAt" SET NOT NULL;
ALTER TABLE "ChecklistCategory" ALTER COLUMN "createdAt" SET DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "ChecklistTemplateItem" ALTER COLUMN "createdAt" SET NOT NULL;
ALTER TABLE "ChecklistTemplateItem" ALTER COLUMN "createdAt" SET DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "ChecklistTemplateEntry" ALTER COLUMN "createdAt" SET NOT NULL;
ALTER TABLE "ChecklistTemplateEntry" ALTER COLUMN "createdAt" SET DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "ChecklistCategory" DROP COLUMN "sortOrder";
ALTER TABLE "ChecklistTemplateItem" DROP COLUMN "sortOrder";
ALTER TABLE "ChecklistTemplateEntry" DROP COLUMN "sortOrder";
ALTER TABLE "JobOrderChecklistItem" DROP COLUMN "sortOrder";

CREATE INDEX "ChecklistTemplateItem_categoryId_createdAt_idx" ON "ChecklistTemplateItem"("categoryId", "createdAt");
CREATE INDEX "ChecklistTemplateEntry_templateId_createdAt_idx" ON "ChecklistTemplateEntry"("templateId", "createdAt");
CREATE INDEX "JobOrderChecklistItem_jobOrderId_createdAt_idx" ON "JobOrderChecklistItem"("jobOrderId", "createdAt");
