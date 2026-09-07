CREATE TABLE "Vendor" (
  "id" TEXT NOT NULL,
  "branch" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "email" TEXT,
  "phone" TEXT,
  "address" TEXT,
  "deletedAt" TIMESTAMP(3),
  "version" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "Vendor_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Vendor_branch_idx" ON "Vendor"("branch");
CREATE INDEX "Vendor_name_idx" ON "Vendor"("name");

ALTER TABLE "JobOrder" ADD COLUMN "vendorId" TEXT;
ALTER TABLE "JobOrder" ADD COLUMN "isSubcontracted" BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX "JobOrder_vendorId_idx" ON "JobOrder"("vendorId");

ALTER TABLE "Variation" ADD COLUMN "vendorId" TEXT;
ALTER TABLE "Variation" ADD COLUMN "isSubcontracted" BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX "Variation_vendorId_idx" ON "Variation"("vendorId");

ALTER TABLE "JobOrder" ADD CONSTRAINT "JobOrder_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Variation" ADD CONSTRAINT "Variation_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE SET NULL ON UPDATE CASCADE;
