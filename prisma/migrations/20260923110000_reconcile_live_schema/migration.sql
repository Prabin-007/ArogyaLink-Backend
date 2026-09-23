-- Reconcile the existing ArogyaLink database with the merged schema.
-- Data-preserving migration.

-- ============================================================================
-- Facility enums
-- ============================================================================

ALTER TYPE "FacilityType" ADD VALUE IF NOT EXISTS 'TERTIARY';
ALTER TYPE "FacilityType" ADD VALUE IF NOT EXISTS 'PRIVATE';
ALTER TYPE "FacilityType" ADD VALUE IF NOT EXISTS 'AYUSHMAN';

DO $$
BEGIN
    CREATE TYPE "FacilityOperationalStatus" AS ENUM (
        'OPERATIONAL',
        'PARTIALLY_OPERATIONAL',
        'CLOSED',
        'MAINTENANCE'
    );
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- Facility fields
-- ============================================================================

ALTER TABLE "facilities"
    ADD COLUMN IF NOT EXISTS "address" TEXT;

ALTER TABLE "facilities"
    ADD COLUMN IF NOT EXISTS "operationalStatus"
        "FacilityOperationalStatus" NOT NULL DEFAULT 'OPERATIONAL';

ALTER TABLE "facilities"
    ADD COLUMN IF NOT EXISTS "emergencyCapability"
        BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "facilities"
    ADD COLUMN IF NOT EXISTS "waitingTimeMinutes" INTEGER;

ALTER TABLE "facilities"
    ADD COLUMN IF NOT EXISTS "lastUpdated"
        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX IF NOT EXISTS "facilities_district_idx"
    ON "facilities"("district");

CREATE INDEX IF NOT EXISTS "facilities_type_idx"
    ON "facilities"("type");

CREATE INDEX IF NOT EXISTS "facilities_district_state_idx"
    ON "facilities"("district", "state");

CREATE INDEX IF NOT EXISTS "facilities_operationalStatus_idx"
    ON "facilities"("operationalStatus");

-- ============================================================================
-- Person 4 Smart Referral fields
-- ============================================================================

ALTER TABLE "referrals"
    ADD COLUMN IF NOT EXISTS "recommendationScore" DOUBLE PRECISION;

ALTER TABLE "referrals"
    ADD COLUMN IF NOT EXISTS "recommendationReasons"
        TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

ALTER TABLE "referrals"
    ADD COLUMN IF NOT EXISTS "alternativeFacilities" JSONB;

ALTER TABLE "referrals"
    ALTER COLUMN "recommendationReasons" DROP DEFAULT;

-- ============================================================================
-- Person 4 FacilitySpecialist
-- ============================================================================

CREATE TABLE IF NOT EXISTS "facility_specialists" (
    "id" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "specialization" TEXT NOT NULL,
    "available" BOOLEAN NOT NULL DEFAULT true,
    "doctorCount" INTEGER NOT NULL DEFAULT 1,
    "maleDoctorCount" INTEGER NOT NULL DEFAULT 0,
    "femaleDoctorCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "facility_specialists_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS
    "facility_specialists_facilityId_specialization_key"
    ON "facility_specialists"("facilityId", "specialization");

CREATE INDEX IF NOT EXISTS "facility_specialists_facilityId_idx"
    ON "facility_specialists"("facilityId");

CREATE INDEX IF NOT EXISTS
    "facility_specialists_specialization_available_idx"
    ON "facility_specialists"("specialization", "available");

ALTER TABLE "facility_specialists"
    DROP CONSTRAINT IF EXISTS "facility_specialists_facilityId_fkey";

ALTER TABLE "facility_specialists"
    ADD CONSTRAINT "facility_specialists_facilityId_fkey"
    FOREIGN KEY ("facilityId")
    REFERENCES "facilities"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- ============================================================================
-- Person 4 FacilityResource
-- ============================================================================

CREATE TABLE IF NOT EXISTS "facility_resources" (
    "id" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "resourceName" TEXT NOT NULL,
    "available" BOOLEAN NOT NULL DEFAULT true,
    "quantity" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "facility_resources_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS
    "facility_resources_facilityId_resourceName_key"
    ON "facility_resources"("facilityId", "resourceName");

CREATE INDEX IF NOT EXISTS "facility_resources_facilityId_idx"
    ON "facility_resources"("facilityId");

CREATE INDEX IF NOT EXISTS
    "facility_resources_resourceName_available_idx"
    ON "facility_resources"("resourceName", "available");

ALTER TABLE "facility_resources"
    DROP CONSTRAINT IF EXISTS "facility_resources_facilityId_fkey";

ALTER TABLE "facility_resources"
    ADD CONSTRAINT "facility_resources_facilityId_fkey"
    FOREIGN KEY ("facilityId")
    REFERENCES "facilities"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- ============================================================================
-- Ensure ServiceAvailability table exists safely
-- ============================================================================

CREATE TABLE IF NOT EXISTS "service_availability" (
    "id" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "available" BOOLEAN NOT NULL DEFAULT false,
    "lastUpdated" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "service_availability_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "service_availability_serviceId_facilityId_key"
    ON "service_availability"("serviceId", "facilityId");

CREATE INDEX IF NOT EXISTS "service_availability_facilityId_idx"
    ON "service_availability"("facilityId");

CREATE INDEX IF NOT EXISTS "service_availability_serviceId_idx"
    ON "service_availability"("serviceId");

ALTER TABLE "service_availability"
    DROP CONSTRAINT IF EXISTS "service_availability_serviceId_fkey";

ALTER TABLE "service_availability"
    ADD CONSTRAINT "service_availability_serviceId_fkey"
    FOREIGN KEY ("serviceId")
    REFERENCES "services"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "service_availability"
    DROP CONSTRAINT IF EXISTS "service_availability_facilityId_fkey";

ALTER TABLE "service_availability"
    ADD CONSTRAINT "service_availability_facilityId_fkey"
    FOREIGN KEY ("facilityId")
    REFERENCES "facilities"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- ============================================================================
-- Recreate FacilityService for Person 4 Smart Referral.
--
-- Existing ServiceAvailability rows are copied into FacilityService rows.
-- ============================================================================

CREATE TABLE IF NOT EXISTS "facility_services" (
    "id" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "serviceName" TEXT NOT NULL,
    "available" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "facility_services_pkey" PRIMARY KEY ("id")
);

INSERT INTO "facility_services" (
    "id",
    "facilityId",
    "serviceName",
    "available",
    "createdAt",
    "updatedAt"
)
SELECT
    md5(sa."facilityId" || ':' || s."name"),
    sa."facilityId",
    s."name",
    sa."available",
    sa."createdAt",
    sa."lastUpdated"
FROM "service_availability" sa
JOIN "services" s
    ON s."id" = sa."serviceId"
ON CONFLICT ("id") DO NOTHING;

CREATE UNIQUE INDEX IF NOT EXISTS
    "facility_services_facilityId_serviceName_key"
    ON "facility_services"("facilityId", "serviceName");

CREATE INDEX IF NOT EXISTS
    "facility_services_facilityId_idx"
    ON "facility_services"("facilityId");

CREATE INDEX IF NOT EXISTS
    "facility_services_serviceName_available_idx"
    ON "facility_services"("serviceName", "available");

ALTER TABLE "facility_services"
    DROP CONSTRAINT IF EXISTS "facility_services_facilityId_fkey";

ALTER TABLE "facility_services"
    ADD CONSTRAINT "facility_services_facilityId_fkey"
    FOREIGN KEY ("facilityId")
    REFERENCES "facilities"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
