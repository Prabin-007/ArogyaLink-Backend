-- Mobile sync v2 schema changes.
-- Hand-written (no shadow DB available) and applied with `prisma migrate deploy`.
-- Everything is additive; existing rows are backfilled so nothing existing breaks.

-- ── New enum values ──────────────────────────────────────────────────────────
ALTER TYPE "EncounterType" ADD VALUE 'HOME_VISIT';
ALTER TYPE "TimelineEventType" ADD VALUE 'HIGH_RISK_FLAGGED';

-- ── New enums ────────────────────────────────────────────────────────────────
CREATE TYPE "PatientCategory" AS ENUM ('GENERAL', 'PREGNANT', 'CHILD_UNDER_5', 'NCD', 'ELDERLY');
CREATE TYPE "FacilityType" AS ENUM ('SUB_CENTRE', 'PHC', 'CHC', 'DISTRICT_HOSPITAL', 'MEDICAL_COLLEGE');

-- ── Patient: ASHA-specific fields (all defaulted / nullable) ─────────────────
ALTER TABLE "patients"
  ADD COLUMN "category"    "PatientCategory" NOT NULL DEFAULT 'GENERAL',
  ADD COLUMN "lmpDate"     TIMESTAMP(3),
  ADD COLUMN "isHighRisk"  BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "riskReasons" TEXT[];
UPDATE "patients" SET "riskReasons" = ARRAY[]::TEXT[];

-- ── updatedAt on Encounter / Vitals / Prescription ───────────────────────────
-- Prisma's @updatedAt has no DB default, so a plain NOT NULL column would fail
-- on existing rows. Add nullable → backfill from the best existing timestamp →
-- then enforce NOT NULL.
ALTER TABLE "encounters"    ADD COLUMN "updatedAt" TIMESTAMP(3);
ALTER TABLE "vitals"        ADD COLUMN "updatedAt" TIMESTAMP(3);
ALTER TABLE "prescriptions" ADD COLUMN "updatedAt" TIMESTAMP(3);

UPDATE "encounters"    SET "updatedAt" = "createdAt";
UPDATE "vitals"        SET "updatedAt" = "recordedAt";
UPDATE "prescriptions" SET "updatedAt" = "createdAt";

ALTER TABLE "encounters"    ALTER COLUMN "updatedAt" SET NOT NULL;
ALTER TABLE "vitals"        ALTER COLUMN "updatedAt" SET NOT NULL;
ALTER TABLE "prescriptions" ALTER COLUMN "updatedAt" SET NOT NULL;

-- ── Facility ─────────────────────────────────────────────────────────────────
CREATE TABLE "facilities" (
    "id"        TEXT NOT NULL,
    "name"      TEXT NOT NULL,
    "type"      "FacilityType" NOT NULL,
    "district"  TEXT NOT NULL,
    "state"     TEXT NOT NULL,
    "latitude"  DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "phone"     TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "facilities_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "facilities_district_idx" ON "facilities"("district");
