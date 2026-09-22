-- CreateEnum
CREATE TYPE "TeleconsultationStatus" AS ENUM ('CREATED', 'ACCEPTED', 'REJECTED', 'CANCELLED', 'COMPLETED');

-- CreateTable
CREATE TABLE "teleconsultation_requests" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "doctorId" TEXT NOT NULL,
    "requesterId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "TeleconsultationStatus" NOT NULL DEFAULT 'CREATED',
    "roomId" TEXT,
    "encounterId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "teleconsultation_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "teleconsultation_requests_encounterId_key" ON "teleconsultation_requests"("encounterId");

-- CreateIndex
CREATE INDEX "teleconsultation_requests_patientId_idx" ON "teleconsultation_requests"("patientId");

-- CreateIndex
CREATE INDEX "teleconsultation_requests_doctorId_idx" ON "teleconsultation_requests"("doctorId");

-- CreateIndex
CREATE INDEX "teleconsultation_requests_requesterId_idx" ON "teleconsultation_requests"("requesterId");

-- CreateIndex
CREATE INDEX "teleconsultation_requests_status_idx" ON "teleconsultation_requests"("status");

-- AddForeignKey
ALTER TABLE "teleconsultation_requests" ADD CONSTRAINT "teleconsultation_requests_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teleconsultation_requests" ADD CONSTRAINT "teleconsultation_requests_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teleconsultation_requests" ADD CONSTRAINT "teleconsultation_requests_requesterId_fkey" FOREIGN KEY ("requesterId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
