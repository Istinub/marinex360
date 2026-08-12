-- CC-9: WorkLog stores the labour-rate snapshot captured when the log is created.
ALTER TABLE "WorkLog" ADD COLUMN "labourRateAmountMinor" INTEGER;
ALTER TABLE "WorkLog" ADD COLUMN "labourRateCurrency" TEXT DEFAULT 'SGD';
