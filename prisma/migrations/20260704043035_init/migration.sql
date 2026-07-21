/*
  Warnings:

  - You are about to drop the column `deletedAt` on the `Contact` table. All the data in the column will be lost.
  - You are about to drop the column `resultHash` on the `ProcessedOp` table. All the data in the column will be lost.
  - Added the required column `action` to the `ProcessedOp` table without a default value. This is not possible if the table is not empty.
  - Added the required column `status` to the `ProcessedOp` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "JobOrder" DROP CONSTRAINT "JobOrder_clientId_fkey";

-- DropForeignKey
ALTER TABLE "JobOrder" DROP CONSTRAINT "JobOrder_vesselId_fkey";

-- AlterTable
ALTER TABLE "Contact" DROP COLUMN "deletedAt";

-- AlterTable
ALTER TABLE "JobOrder" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "executionOwnerId" TEXT,
ADD COLUMN     "labourRateAmountMinor" INTEGER,
ADD COLUMN     "labourRateCurrency" TEXT DEFAULT 'SGD';

-- AlterTable
ALTER TABLE "ProcessedOp" DROP COLUMN "resultHash",
ADD COLUMN     "action" TEXT NOT NULL,
ADD COLUMN     "resultRef" TEXT,
ADD COLUMN     "status" TEXT NOT NULL;

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "roles" TEXT[],
    "branch" TEXT NOT NULL,
    "designation" TEXT,
    "baseLocation" TEXT,
    "skills" TEXT[],
    "available" BOOLEAN NOT NULL DEFAULT true,
    "totpSecret" TEXT,
    "totpPendingSecret" TEXT,
    "mfaEnrolled" BOOLEAN NOT NULL DEFAULT false,
    "recoveryCodes" TEXT[],
    "active" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefreshToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "family" TEXT NOT NULL,
    "longLived" BOOLEAN NOT NULL DEFAULT false,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RefreshToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Variation" (
    "id" TEXT NOT NULL,
    "jobOrderId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "amountCurrency" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PROPOSED',
    "approverId" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Variation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MaterialLine" (
    "id" TEXT NOT NULL,
    "jobOrderId" TEXT,
    "variationId" TEXT,
    "partCatalogId" TEXT,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL,
    "unit" TEXT NOT NULL,
    "unitCostAmountMinor" INTEGER NOT NULL,
    "unitCostCurrency" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "addedById" TEXT NOT NULL,
    "opId" TEXT,
    "reviewState" TEXT,
    "deletedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MaterialLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PartCatalog" (
    "id" TEXT NOT NULL,
    "partNumber" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "makerModel" TEXT,
    "unit" TEXT NOT NULL,
    "costPriceAmountMinor" INTEGER NOT NULL,
    "costPriceCurrency" TEXT NOT NULL,
    "scrapSourceFlag" BOOLEAN NOT NULL DEFAULT false,
    "deletedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "PartCatalog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkLog" (
    "id" TEXT NOT NULL,
    "jobOrderId" TEXT NOT NULL,
    "technicianId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "opId" TEXT,
    "reviewState" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "WorkLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Photo" (
    "id" TEXT NOT NULL,
    "jobOrderId" TEXT NOT NULL,
    "s3Key" TEXT,
    "phase" TEXT NOT NULL,
    "geoLat" DOUBLE PRECISION,
    "geoLng" DOUBLE PRECISION,
    "takenAt" TIMESTAMP(3) NOT NULL,
    "capturedById" TEXT NOT NULL,
    "opId" TEXT,
    "reviewState" TEXT,

    CONSTRAINT "Photo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Observation" (
    "id" TEXT NOT NULL,
    "jobOrderId" TEXT NOT NULL,
    "templateKey" TEXT,
    "body" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "opId" TEXT,
    "reviewState" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Observation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChecklistTemplate" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "serviceCategory" TEXT,
    "jobType" TEXT,
    "items" JSONB NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ChecklistTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChecklistInstance" (
    "id" TEXT NOT NULL,
    "jobOrderId" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "results" JSONB NOT NULL,
    "completedById" TEXT,
    "completedAt" TIMESTAMP(3),
    "opId" TEXT,
    "reviewState" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ChecklistInstance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ESignature" (
    "id" TEXT NOT NULL,
    "jobOrderId" TEXT NOT NULL,
    "imageS3Key" TEXT,
    "signerName" TEXT,
    "signerRole" TEXT,
    "signedAt" TIMESTAMP(3),
    "deviceId" TEXT,
    "geoLat" DOUBLE PRECISION,
    "geoLng" DOUBLE PRECISION,
    "documentHash" TEXT,
    "opId" TEXT,
    "reviewState" TEXT,

    CONSTRAINT "ESignature_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL,
    "invoiceNumber" TEXT NOT NULL,
    "jobOrderId" TEXT NOT NULL,
    "branch" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "billToName" TEXT NOT NULL,
    "billToAddress" TEXT,
    "gstAmountMinor" INTEGER,
    "gstCurrency" TEXT,
    "totalAmountMinor" INTEGER NOT NULL,
    "totalCurrency" TEXT NOT NULL,
    "issuedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvoiceLine" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL,
    "unit" TEXT,
    "unitPriceAmountMinor" INTEGER NOT NULL,
    "unitPriceCurrency" TEXT NOT NULL,
    "lineTotalAmountMinor" INTEGER NOT NULL,
    "lineTotalCurrency" TEXT NOT NULL,

    CONSTRAINT "InvoiceLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Document" (
    "id" TEXT NOT NULL,
    "ownerType" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "s3Key" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Certificate" (
    "id" TEXT NOT NULL,
    "ownerType" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "certType" TEXT NOT NULL,
    "identifier" TEXT,
    "issuedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "s3Key" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Certificate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "recipientId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEntry" (
    "id" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "diff" JSONB,

    CONSTRAINT "AuditEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_branch_idx" ON "User"("branch");

-- CreateIndex
CREATE UNIQUE INDEX "RefreshToken_tokenHash_key" ON "RefreshToken"("tokenHash");

-- CreateIndex
CREATE INDEX "RefreshToken_userId_idx" ON "RefreshToken"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "MaterialLine_opId_key" ON "MaterialLine"("opId");

-- CreateIndex
CREATE INDEX "MaterialLine_jobOrderId_idx" ON "MaterialLine"("jobOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "PartCatalog_partNumber_key" ON "PartCatalog"("partNumber");

-- CreateIndex
CREATE UNIQUE INDEX "WorkLog_opId_key" ON "WorkLog"("opId");

-- CreateIndex
CREATE INDEX "WorkLog_jobOrderId_idx" ON "WorkLog"("jobOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "Photo_opId_key" ON "Photo"("opId");

-- CreateIndex
CREATE INDEX "Photo_jobOrderId_idx" ON "Photo"("jobOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "Observation_opId_key" ON "Observation"("opId");

-- CreateIndex
CREATE INDEX "Observation_jobOrderId_idx" ON "Observation"("jobOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "ChecklistInstance_opId_key" ON "ChecklistInstance"("opId");

-- CreateIndex
CREATE INDEX "ChecklistInstance_jobOrderId_idx" ON "ChecklistInstance"("jobOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "ESignature_jobOrderId_key" ON "ESignature"("jobOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "ESignature_opId_key" ON "ESignature"("opId");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_invoiceNumber_key" ON "Invoice"("invoiceNumber");

-- CreateIndex
CREATE INDEX "Invoice_branch_status_idx" ON "Invoice"("branch", "status");

-- CreateIndex
CREATE INDEX "InvoiceLine_invoiceId_idx" ON "InvoiceLine"("invoiceId");

-- CreateIndex
CREATE INDEX "Document_ownerType_ownerId_idx" ON "Document"("ownerType", "ownerId");

-- CreateIndex
CREATE INDEX "Certificate_ownerType_ownerId_idx" ON "Certificate"("ownerType", "ownerId");

-- CreateIndex
CREATE INDEX "Certificate_expiresAt_idx" ON "Certificate"("expiresAt");

-- CreateIndex
CREATE INDEX "Notification_recipientId_readAt_idx" ON "Notification"("recipientId", "readAt");

-- CreateIndex
CREATE INDEX "AuditEntry_entityType_entityId_idx" ON "AuditEntry"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "AuditEntry_at_idx" ON "AuditEntry"("at");

-- CreateIndex
CREATE INDEX "JobOrder_clientId_idx" ON "JobOrder"("clientId");

-- CreateIndex
CREATE INDEX "JobOrder_vesselId_idx" ON "JobOrder"("vesselId");

-- CreateIndex
CREATE INDEX "JobStatusHistory_jobOrderId_idx" ON "JobStatusHistory"("jobOrderId");

-- CreateIndex
CREATE INDEX "Vessel_clientId_idx" ON "Vessel"("clientId");

-- AddForeignKey
ALTER TABLE "RefreshToken" ADD CONSTRAINT "RefreshToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Variation" ADD CONSTRAINT "Variation_jobOrderId_fkey" FOREIGN KEY ("jobOrderId") REFERENCES "JobOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialLine" ADD CONSTRAINT "MaterialLine_jobOrderId_fkey" FOREIGN KEY ("jobOrderId") REFERENCES "JobOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialLine" ADD CONSTRAINT "MaterialLine_variationId_fkey" FOREIGN KEY ("variationId") REFERENCES "Variation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialLine" ADD CONSTRAINT "MaterialLine_partCatalogId_fkey" FOREIGN KEY ("partCatalogId") REFERENCES "PartCatalog"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkLog" ADD CONSTRAINT "WorkLog_jobOrderId_fkey" FOREIGN KEY ("jobOrderId") REFERENCES "JobOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Photo" ADD CONSTRAINT "Photo_jobOrderId_fkey" FOREIGN KEY ("jobOrderId") REFERENCES "JobOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Observation" ADD CONSTRAINT "Observation_jobOrderId_fkey" FOREIGN KEY ("jobOrderId") REFERENCES "JobOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChecklistInstance" ADD CONSTRAINT "ChecklistInstance_jobOrderId_fkey" FOREIGN KEY ("jobOrderId") REFERENCES "JobOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChecklistInstance" ADD CONSTRAINT "ChecklistInstance_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "ChecklistTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ESignature" ADD CONSTRAINT "ESignature_jobOrderId_fkey" FOREIGN KEY ("jobOrderId") REFERENCES "JobOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_jobOrderId_fkey" FOREIGN KEY ("jobOrderId") REFERENCES "JobOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceLine" ADD CONSTRAINT "InvoiceLine_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
