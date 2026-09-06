CREATE TABLE "ChecklistCategory" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ChecklistCategory_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ChecklistTemplateItem" (
    "id" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ChecklistTemplateItem_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ChecklistCategory_sortOrder_idx" ON "ChecklistCategory"("sortOrder");
CREATE INDEX "ChecklistTemplateItem_categoryId_sortOrder_idx" ON "ChecklistTemplateItem"("categoryId", "sortOrder");

ALTER TABLE "ChecklistTemplateItem" ADD CONSTRAINT "ChecklistTemplateItem_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ChecklistCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
