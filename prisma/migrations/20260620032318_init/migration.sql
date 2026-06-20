-- CreateTable
CREATE TABLE "Contact" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "anonymised" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 0,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Contact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Client" (
    "id" TEXT NOT NULL,
    "branch" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "creditTerms" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "primaryContactId" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Client_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Vessel" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "imoNumber" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT,
    "flag" TEXT,
    "classification" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Vessel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobOrder" (
    "id" TEXT NOT NULL,
    "joNumber" TEXT NOT NULL,
    "branch" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "vesselId" TEXT NOT NULL,
    "serviceCategories" TEXT[],
    "port" TEXT,
    "scopeSummary" TEXT NOT NULL,
    "origin" TEXT NOT NULL DEFAULT 'MANUAL',
    "externalQuoteRef" TEXT,
    "externalRfqRef" TEXT,
    "quotedAmountMinor" INTEGER NOT NULL,
    "quotedCurrency" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'DRAFT',
    "assignedTechnicianIds" TEXT[],
    "plannedStartDate" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JobOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobStatusHistory" (
    "id" TEXT NOT NULL,
    "jobOrderId" TEXT NOT NULL,
    "fromState" TEXT NOT NULL,
    "toState" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JobStatusHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProcessedOp" (
    "opId" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "resultHash" TEXT,
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProcessedOp_pkey" PRIMARY KEY ("opId")
);

-- CreateIndex
CREATE INDEX "Client_branch_idx" ON "Client"("branch");

-- CreateIndex
CREATE UNIQUE INDEX "Vessel_imoNumber_key" ON "Vessel"("imoNumber");

-- CreateIndex
CREATE UNIQUE INDEX "JobOrder_joNumber_key" ON "JobOrder"("joNumber");

-- CreateIndex
CREATE INDEX "JobOrder_branch_state_idx" ON "JobOrder"("branch", "state");

-- AddForeignKey
ALTER TABLE "Client" ADD CONSTRAINT "Client_primaryContactId_fkey" FOREIGN KEY ("primaryContactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vessel" ADD CONSTRAINT "Vessel_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobOrder" ADD CONSTRAINT "JobOrder_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobOrder" ADD CONSTRAINT "JobOrder_vesselId_fkey" FOREIGN KEY ("vesselId") REFERENCES "Vessel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobStatusHistory" ADD CONSTRAINT "JobStatusHistory_jobOrderId_fkey" FOREIGN KEY ("jobOrderId") REFERENCES "JobOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
