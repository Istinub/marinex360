ALTER TABLE "JobOrder" ADD COLUMN "deadline" TIMESTAMP(3);

ALTER TABLE "RefreshToken" ADD COLUMN "deviceId" TEXT;

ALTER TABLE "JobStatusHistory" ADD COLUMN "deviceId" TEXT;

CREATE INDEX "RefreshToken_deviceId_idx" ON "RefreshToken"("deviceId");
CREATE INDEX "JobStatusHistory_actorId_idx" ON "JobStatusHistory"("actorId");
CREATE INDEX "JobStatusHistory_deviceId_idx" ON "JobStatusHistory"("deviceId");

ALTER TABLE "RefreshToken"
  ADD CONSTRAINT "RefreshToken_deviceId_fkey"
  FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "JobStatusHistory"
  ADD CONSTRAINT "JobStatusHistory_actorId_fkey"
  FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "JobStatusHistory"
  ADD CONSTRAINT "JobStatusHistory_deviceId_fkey"
  FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "JobOrder"
  ADD CONSTRAINT "JobOrder_clientId_fkey"
  FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "JobOrder"
  ADD CONSTRAINT "JobOrder_vesselId_fkey"
  FOREIGN KEY ("vesselId") REFERENCES "Vessel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
