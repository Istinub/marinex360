-- AlterTable
ALTER TABLE "User" ADD COLUMN     "clientId" TEXT;

-- CreateTable
CREATE TABLE "JobRequest" (
    "id" TEXT NOT NULL,
    "clientId" TEXT,
    "guestName" TEXT,
    "guestEmail" TEXT,
    "guestCompany" TEXT,
    "vesselDescription" TEXT NOT NULL,
    "scopeSummary" TEXT NOT NULL,
    "requestedDate" TIMESTAMP(3),
    "branch" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "convertedJobOrderId" TEXT,
    "declineReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JobRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "JobRequest_branch_idx" ON "JobRequest"("branch");

-- CreateIndex
CREATE INDEX "JobRequest_clientId_idx" ON "JobRequest"("clientId");

-- CreateIndex
CREATE INDEX "JobRequest_status_idx" ON "JobRequest"("status");

-- CreateIndex
CREATE INDEX "User_clientId_idx" ON "User"("clientId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobRequest" ADD CONSTRAINT "JobRequest_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;
