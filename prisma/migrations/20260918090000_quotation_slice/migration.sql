-- Quotation first slice: global sequence-backed quotation numbers + editable draft lines.
CREATE SEQUENCE IF NOT EXISTS "quotation_number_seq" START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;

CREATE TABLE "Quotation" (
  "id" TEXT NOT NULL,
  "quotationNumber" TEXT NOT NULL,
  "clientId" TEXT,
  "vesselId" TEXT,
  "manualClientName" TEXT,
  "manualVesselName" TEXT,
  "category" TEXT NOT NULL,
  "quotationDate" TIMESTAMP(3) NOT NULL,
  "location" TEXT,
  "currency" TEXT NOT NULL,
  "validityDays" INTEGER NOT NULL DEFAULT 30,
  "workDurationText" TEXT,
  "exclusionsText" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "pdfObjectKey" TEXT,
  "branch" TEXT NOT NULL,
  "createdBy" TEXT NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "Quotation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "QuotationLine" (
  "id" TEXT NOT NULL,
  "quotationId" TEXT NOT NULL,
  "itemCode" TEXT,
  "description" TEXT NOT NULL,
  "unit" TEXT,
  "quantity" DECIMAL(12,3),
  "unitPrice" DECIMAL(12,2),
  "amount" DECIMAL(12,2),
  "remarks" TEXT,

  CONSTRAINT "QuotationLine_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Quotation_quotationNumber_key" ON "Quotation"("quotationNumber");
CREATE INDEX "Quotation_branch_status_idx" ON "Quotation"("branch", "status");
CREATE INDEX "Quotation_clientId_idx" ON "Quotation"("clientId");
CREATE INDEX "Quotation_vesselId_idx" ON "Quotation"("vesselId");
CREATE INDEX "Quotation_quotationDate_idx" ON "Quotation"("quotationDate");
CREATE INDEX "QuotationLine_quotationId_idx" ON "QuotationLine"("quotationId");

ALTER TABLE "Quotation" ADD CONSTRAINT "Quotation_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Quotation" ADD CONSTRAINT "Quotation_vesselId_fkey" FOREIGN KEY ("vesselId") REFERENCES "Vessel"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "QuotationLine" ADD CONSTRAINT "QuotationLine_quotationId_fkey" FOREIGN KEY ("quotationId") REFERENCES "Quotation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
