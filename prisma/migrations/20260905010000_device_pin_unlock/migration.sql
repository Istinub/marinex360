CREATE TABLE "Device" (
  "id" TEXT NOT NULL,
  "name" TEXT,
  "pin" TEXT NOT NULL,
  "assignedUserId" TEXT NOT NULL,
  "branch" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "Device_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Device_branch_idx" ON "Device"("branch");
CREATE INDEX "Device_assignedUserId_idx" ON "Device"("assignedUserId");

ALTER TABLE "Device"
  ADD CONSTRAINT "Device_assignedUserId_fkey"
  FOREIGN KEY ("assignedUserId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
