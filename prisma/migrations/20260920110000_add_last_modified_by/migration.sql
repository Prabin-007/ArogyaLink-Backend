-- lastModifiedById: who last wrote a Patient / Encounter / Vitals / FollowUp row.
-- Set on every write (web endpoints and mobile sync). Sync uses it to tell a
-- lost-response retry (same user edited again) from a real conflict (someone
-- else changed the row). Existing rows stay NULL = "unknown".

ALTER TABLE "patients"   ADD COLUMN "lastModifiedById" TEXT;
ALTER TABLE "encounters" ADD COLUMN "lastModifiedById" TEXT;
ALTER TABLE "vitals"     ADD COLUMN "lastModifiedById" TEXT;
ALTER TABLE "followups"  ADD COLUMN "lastModifiedById" TEXT;

ALTER TABLE "patients"   ADD CONSTRAINT "patients_lastModifiedById_fkey"   FOREIGN KEY ("lastModifiedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "encounters" ADD CONSTRAINT "encounters_lastModifiedById_fkey" FOREIGN KEY ("lastModifiedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "vitals"     ADD CONSTRAINT "vitals_lastModifiedById_fkey"     FOREIGN KEY ("lastModifiedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "followups"  ADD CONSTRAINT "followups_lastModifiedById_fkey"  FOREIGN KEY ("lastModifiedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
