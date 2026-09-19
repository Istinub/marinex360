CREATE TABLE "QuotationLineTemplate" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "QuotationLineTemplate_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "QuotationLineTemplateEntry" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "itemCode" TEXT,
    "description" TEXT NOT NULL,
    "unit" TEXT,
    "typicalUnitPrice" DECIMAL(12,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QuotationLineTemplateEntry_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "QuotationLineTemplate_category_idx" ON "QuotationLineTemplate"("category");
CREATE INDEX "QuotationLineTemplate_active_idx" ON "QuotationLineTemplate"("active");
CREATE INDEX "QuotationLineTemplateEntry_templateId_createdAt_idx" ON "QuotationLineTemplateEntry"("templateId", "createdAt");

ALTER TABLE "QuotationLineTemplateEntry" ADD CONSTRAINT "QuotationLineTemplateEntry_templateId_fkey"
  FOREIGN KEY ("templateId") REFERENCES "QuotationLineTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
