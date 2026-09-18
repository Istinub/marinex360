ALTER TABLE "JobOrder" ADD COLUMN "shareToken" TEXT;

CREATE UNIQUE INDEX "JobOrder_shareToken_key" ON "JobOrder"("shareToken");
