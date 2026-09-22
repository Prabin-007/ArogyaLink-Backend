-- Align Module 6 service availability constraints with the Prisma schema.

-- Rename legacy primary key/index names.
ALTER INDEX IF EXISTS "facility_services_pkey"
RENAME TO "service_availability_pkey";

ALTER INDEX IF EXISTS "facility_services_facilityId_idx"
RENAME TO "service_availability_facilityId_idx";

ALTER INDEX IF EXISTS "facility_services_serviceId_idx"
RENAME TO "service_availability_serviceId_idx";

ALTER INDEX IF EXISTS "facility_services_serviceId_facilityId_key"
RENAME TO "service_availability_serviceId_facilityId_key";

-- Replace RESTRICT foreign keys with CASCADE behaviour
-- defined by ServiceAvailability in schema.prisma.
ALTER TABLE "service_availability"
DROP CONSTRAINT IF EXISTS "facility_services_serviceId_fkey";

ALTER TABLE "service_availability"
DROP CONSTRAINT IF EXISTS "facility_services_facilityId_fkey";

ALTER TABLE "service_availability"
ADD CONSTRAINT "service_availability_serviceId_fkey"
FOREIGN KEY ("serviceId") REFERENCES "services"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "service_availability"
ADD CONSTRAINT "service_availability_facilityId_fkey"
FOREIGN KEY ("facilityId") REFERENCES "facilities"("id")
ON DELETE CASCADE ON UPDATE CASCADE;