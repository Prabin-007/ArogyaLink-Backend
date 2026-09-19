-- DropForeignKey
ALTER TABLE "encounters" DROP CONSTRAINT "encounters_doctorId_fkey";

-- DropForeignKey
ALTER TABLE "followups" DROP CONSTRAINT "followups_assignedToId_fkey";

-- DropForeignKey
ALTER TABLE "patients" DROP CONSTRAINT "patients_assignedAshaId_fkey";

-- DropForeignKey
ALTER TABLE "prescriptions" DROP CONSTRAINT "prescriptions_doctorId_fkey";

-- DropForeignKey
ALTER TABLE "prescriptions" DROP CONSTRAINT "prescriptions_encounterId_fkey";

-- DropForeignKey
ALTER TABLE "referral_events" DROP CONSTRAINT "referral_events_updatedById_fkey";

-- DropForeignKey
ALTER TABLE "referrals" DROP CONSTRAINT "referrals_createdById_fkey";

-- DropForeignKey
ALTER TABLE "referrals" DROP CONSTRAINT "referrals_encounterId_fkey";

-- DropForeignKey
ALTER TABLE "vitals" DROP CONSTRAINT "vitals_recordedById_fkey";

-- AlterTable
ALTER TABLE "encounters" ALTER COLUMN "doctorId" DROP NOT NULL,
ALTER COLUMN "facilityId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "followups" ALTER COLUMN "assignedToId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "patients" ALTER COLUMN "assignedAshaId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "prescriptions" ALTER COLUMN "encounterId" DROP NOT NULL,
ALTER COLUMN "doctorId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "referral_events" ALTER COLUMN "updatedById" DROP NOT NULL;

-- AlterTable
ALTER TABLE "referrals" ALTER COLUMN "encounterId" DROP NOT NULL,
ALTER COLUMN "createdById" DROP NOT NULL;

-- AlterTable
ALTER TABLE "vitals" ALTER COLUMN "recordedById" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "patients" ADD CONSTRAINT "patients_assignedAshaId_fkey" FOREIGN KEY ("assignedAshaId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "encounters" ADD CONSTRAINT "encounters_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vitals" ADD CONSTRAINT "vitals_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prescriptions" ADD CONSTRAINT "prescriptions_encounterId_fkey" FOREIGN KEY ("encounterId") REFERENCES "encounters"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prescriptions" ADD CONSTRAINT "prescriptions_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_encounterId_fkey" FOREIGN KEY ("encounterId") REFERENCES "encounters"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referral_events" ADD CONSTRAINT "referral_events_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "followups" ADD CONSTRAINT "followups_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
