-- CreateTable
CREATE TABLE "services" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "services_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_availability" (
    "id" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "available" BOOLEAN NOT NULL DEFAULT false,
    "lastUpdated" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "facility_services_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "services_name_idx" ON "services"("name");

-- CreateIndex
CREATE INDEX "facility_services_facilityId_idx" ON "service_availability"("facilityId");

-- CreateIndex
CREATE INDEX "facility_services_serviceId_idx" ON "service_availability"("serviceId");

-- CreateIndex
CREATE UNIQUE INDEX "facility_services_serviceId_facilityId_key" ON "service_availability"("serviceId", "facilityId");

-- AddForeignKey
ALTER TABLE "service_availability" ADD CONSTRAINT "facility_services_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "services"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_availability" ADD CONSTRAINT "facility_services_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "facilities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
