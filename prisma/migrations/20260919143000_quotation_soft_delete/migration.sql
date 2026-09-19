ALTER TABLE "Quotation" ADD COLUMN "deletedAt" TIMESTAMP(3),
ADD COLUMN "purgedAt" TIMESTAMP(3);

CREATE INDEX "Quotation_deletedAt_idx" ON "Quotation"("deletedAt");
