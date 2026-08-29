-- D-012: one sequence is shared by every sync-visible model. Separate BIGSERIAL defaults
-- would only be monotonic within each table and are unsafe with a single cross-table cursor.
CREATE SEQUENCE "SyncChangeSeq" AS BIGINT;

ALTER TABLE "ChecklistInstance" ADD COLUMN "changeSeq" BIGINT NOT NULL DEFAULT nextval('"SyncChangeSeq"'::regclass);
ALTER TABLE "ESignature" ADD COLUMN "changeSeq" BIGINT NOT NULL DEFAULT nextval('"SyncChangeSeq"'::regclass);
ALTER TABLE "JobOrder" ADD COLUMN "changeSeq" BIGINT NOT NULL DEFAULT nextval('"SyncChangeSeq"'::regclass);
ALTER TABLE "MaterialLine" ADD COLUMN "changeSeq" BIGINT NOT NULL DEFAULT nextval('"SyncChangeSeq"'::regclass);
ALTER TABLE "Observation" ADD COLUMN "changeSeq" BIGINT NOT NULL DEFAULT nextval('"SyncChangeSeq"'::regclass);
ALTER TABLE "Photo" ADD COLUMN "changeSeq" BIGINT NOT NULL DEFAULT nextval('"SyncChangeSeq"'::regclass);
ALTER TABLE "WorkLog" ADD COLUMN "changeSeq" BIGINT NOT NULL DEFAULT nextval('"SyncChangeSeq"'::regclass);

CREATE INDEX "ChecklistInstance_changeSeq_idx" ON "ChecklistInstance"("changeSeq");
CREATE INDEX "ESignature_changeSeq_idx" ON "ESignature"("changeSeq");
CREATE INDEX "JobOrder_changeSeq_idx" ON "JobOrder"("changeSeq");
CREATE INDEX "MaterialLine_changeSeq_idx" ON "MaterialLine"("changeSeq");
CREATE INDEX "Observation_changeSeq_idx" ON "Observation"("changeSeq");
CREATE INDEX "Photo_changeSeq_idx" ON "Photo"("changeSeq");
CREATE INDEX "WorkLog_changeSeq_idx" ON "WorkLog"("changeSeq");

-- Prisma's autoincrement default covers inserts. Updates need a database-side assignment so
-- every write path, including future ones, advances the same cursor without relying on callers.
CREATE FUNCTION "setSyncChangeSeq"() RETURNS trigger AS $$
BEGIN
  NEW."changeSeq" = nextval('"SyncChangeSeq"'::regclass);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ChecklistInstance_sync_change_seq" BEFORE UPDATE ON "ChecklistInstance"
  FOR EACH ROW EXECUTE FUNCTION "setSyncChangeSeq"();
CREATE TRIGGER "ESignature_sync_change_seq" BEFORE UPDATE ON "ESignature"
  FOR EACH ROW EXECUTE FUNCTION "setSyncChangeSeq"();
CREATE TRIGGER "JobOrder_sync_change_seq" BEFORE UPDATE ON "JobOrder"
  FOR EACH ROW EXECUTE FUNCTION "setSyncChangeSeq"();
CREATE TRIGGER "MaterialLine_sync_change_seq" BEFORE UPDATE ON "MaterialLine"
  FOR EACH ROW EXECUTE FUNCTION "setSyncChangeSeq"();
CREATE TRIGGER "Observation_sync_change_seq" BEFORE UPDATE ON "Observation"
  FOR EACH ROW EXECUTE FUNCTION "setSyncChangeSeq"();
CREATE TRIGGER "Photo_sync_change_seq" BEFORE UPDATE ON "Photo"
  FOR EACH ROW EXECUTE FUNCTION "setSyncChangeSeq"();
CREATE TRIGGER "WorkLog_sync_change_seq" BEFORE UPDATE ON "WorkLog"
  FOR EACH ROW EXECUTE FUNCTION "setSyncChangeSeq"();
