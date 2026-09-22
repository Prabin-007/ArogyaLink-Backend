-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('FOLLOWUP_DUE', 'FOLLOWUP_OVERDUE', 'REFERRAL_UPDATE', 'MEDICINE_UNAVAILABLE', 'DIAGNOSTIC_UNAVAILABLE', 'EMERGENCY_ESCALATION', 'TELECONSULT_SCHEDULED', 'GENERAL');

-- CreateEnum
CREATE TYPE "NotificationPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'URGENT');

-- CreateTable
CREATE TABLE "medicines" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "strength" TEXT,
    "form" TEXT,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "medicines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "medicine_inventory" (
    "id" TEXT NOT NULL,
    "medicineId" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 0,
    "lastUpdated" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "medicine_inventory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "diagnostic_tests" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "diagnostic_tests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "diagnostic_availability" (
    "id" TEXT NOT NULL,
    "testId" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "available" BOOLEAN NOT NULL DEFAULT false,
    "lastUpdated" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "diagnostic_availability_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "patientId" TEXT,
    "type" "NotificationType" NOT NULL,
    "priority" "NotificationPriority" NOT NULL DEFAULT 'MEDIUM',
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "medicines_name_idx" ON "medicines"("name");

-- CreateIndex
CREATE INDEX "medicine_inventory_facilityId_idx" ON "medicine_inventory"("facilityId");

-- CreateIndex
CREATE INDEX "medicine_inventory_medicineId_idx" ON "medicine_inventory"("medicineId");

-- CreateIndex
CREATE UNIQUE INDEX "medicine_inventory_medicineId_facilityId_key" ON "medicine_inventory"("medicineId", "facilityId");

-- CreateIndex
CREATE INDEX "diagnostic_tests_name_idx" ON "diagnostic_tests"("name");

-- CreateIndex
CREATE INDEX "diagnostic_availability_facilityId_idx" ON "diagnostic_availability"("facilityId");

-- CreateIndex
CREATE INDEX "diagnostic_availability_testId_idx" ON "diagnostic_availability"("testId");

-- CreateIndex
CREATE UNIQUE INDEX "diagnostic_availability_testId_facilityId_key" ON "diagnostic_availability"("testId", "facilityId");

-- CreateIndex
CREATE INDEX "notifications_userId_idx" ON "notifications"("userId");

-- CreateIndex
CREATE INDEX "notifications_patientId_idx" ON "notifications"("patientId");

-- CreateIndex
CREATE INDEX "notifications_readAt_idx" ON "notifications"("readAt");

-- AddForeignKey
ALTER TABLE "medicine_inventory" ADD CONSTRAINT "medicine_inventory_medicineId_fkey" FOREIGN KEY ("medicineId") REFERENCES "medicines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medicine_inventory" ADD CONSTRAINT "medicine_inventory_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "facilities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "diagnostic_availability" ADD CONSTRAINT "diagnostic_availability_testId_fkey" FOREIGN KEY ("testId") REFERENCES "diagnostic_tests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "diagnostic_availability" ADD CONSTRAINT "diagnostic_availability_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "facilities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "patients"("id") ON DELETE SET NULL ON UPDATE CASCADE;
