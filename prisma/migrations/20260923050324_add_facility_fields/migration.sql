-- CreateEnum
CREATE TYPE "FacilityOperationalStatus" AS ENUM ('OPERATIONAL', 'PARTIALLY_OPERATIONAL', 'CLOSED', 'MAINTENANCE');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "FacilityType" ADD VALUE 'TERTIARY';
ALTER TYPE "FacilityType" ADD VALUE 'PRIVATE';
ALTER TYPE "FacilityType" ADD VALUE 'AYUSHMAN';

-- AlterTable
ALTER TABLE "facilities" ADD COLUMN     "address" TEXT,
ADD COLUMN     "emergencyCapability" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "lastUpdated" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "operationalStatus" "FacilityOperationalStatus" NOT NULL DEFAULT 'OPERATIONAL',
ADD COLUMN     "waitingTimeMinutes" INTEGER;

-- AlterTable
ALTER TABLE "referrals" ADD COLUMN     "alternativeFacilities" JSONB,
ADD COLUMN     "recommendationReasons" TEXT[],
ADD COLUMN     "recommendationScore" DOUBLE PRECISION;

-- CreateTable
CREATE TABLE "facility_services" (
    "id" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "serviceName" TEXT NOT NULL,
    "available" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "facility_services_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "facility_specialists" (
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

-- CreateTable
CREATE TABLE "facility_resources" (
    "id" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "resourceName" TEXT NOT NULL,
    "available" BOOLEAN NOT NULL DEFAULT true,
    "quantity" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "facility_resources_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "facility_services_facilityId_idx" ON "facility_services"("facilityId");

-- CreateIndex
CREATE INDEX "facility_services_serviceName_available_idx" ON "facility_services"("serviceName", "available");

-- CreateIndex
CREATE UNIQUE INDEX "facility_services_facilityId_serviceName_key" ON "facility_services"("facilityId", "serviceName");

-- CreateIndex
CREATE INDEX "facility_specialists_facilityId_idx" ON "facility_specialists"("facilityId");

-- CreateIndex
CREATE INDEX "facility_specialists_specialization_available_idx" ON "facility_specialists"("specialization", "available");

-- CreateIndex
CREATE UNIQUE INDEX "facility_specialists_facilityId_specialization_key" ON "facility_specialists"("facilityId", "specialization");

-- CreateIndex
CREATE INDEX "facility_resources_facilityId_idx" ON "facility_resources"("facilityId");

-- CreateIndex
CREATE INDEX "facility_resources_resourceName_available_idx" ON "facility_resources"("resourceName", "available");

-- CreateIndex
CREATE UNIQUE INDEX "facility_resources_facilityId_resourceName_key" ON "facility_resources"("facilityId", "resourceName");

-- CreateIndex
CREATE INDEX "facilities_type_idx" ON "facilities"("type");

-- CreateIndex
CREATE INDEX "facilities_district_state_idx" ON "facilities"("district", "state");

-- CreateIndex
CREATE INDEX "facilities_operationalStatus_idx" ON "facilities"("operationalStatus");

-- AddForeignKey
ALTER TABLE "facility_services" ADD CONSTRAINT "facility_services_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "facilities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "facility_specialists" ADD CONSTRAINT "facility_specialists_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "facilities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "facility_resources" ADD CONSTRAINT "facility_resources_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "facilities"("id") ON DELETE CASCADE ON UPDATE CASCADE;
