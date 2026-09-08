CREATE TABLE "BrandingSettings" (
  "id" TEXT NOT NULL,
  "logoFilename" TEXT NOT NULL DEFAULT 'TKMR_Logo.png',
  "updatedBy" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "BrandingSettings_pkey" PRIMARY KEY ("id")
);

INSERT INTO "BrandingSettings" ("id", "logoFilename", "updatedAt")
VALUES ('singleton', 'TKMR_Logo.png', CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;
