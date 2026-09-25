-- Assessments: a completed structured form (questionnaire) filled in by an ASHA on
-- the phone and uploaded through POST /api/sync/upload (same rules as vitals).
--
-- Purely additive: a new enum, one new TimelineEventType value, one new table.
-- Nothing existing is altered or dropped.
--
-- Two different triage results live on the row:
--   "triageLevel" / "triageReasons" / "score"  computed on the phone (AssessmentTriageLevel)
--   "serverTriage*"                            computed by the server's existing rule
--                                              engine (EMERGENCY/HIGH/MEDIUM/LOW), kept as
--                                              plain TEXT because that engine's scale is not a
--                                              database enum.

-- CreateEnum
CREATE TYPE "AssessmentTriageLevel" AS ENUM ('EMERGENCY', 'REFER_SOON', 'WATCH', 'ROUTINE');

-- AlterEnum
ALTER TYPE "TimelineEventType" ADD VALUE 'ASSESSMENT_COMPLETED';

-- CreateTable
CREATE TABLE "assessments" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "encounterId" TEXT,
    "formId" TEXT NOT NULL,
    "formVersion" INTEGER NOT NULL,
    "answers" JSONB NOT NULL,
    "score" INTEGER,
    "triageLevel" "AssessmentTriageLevel" NOT NULL,
    "triageReasons" TEXT[],
    "completedAt" TIMESTAMP(3) NOT NULL,
    "serverTriageLevel" TEXT,
    "serverTriageScore" INTEGER,
    "serverTriageReasons" TEXT[],
    "recordedById" TEXT,
    "lastModifiedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "assessments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "assessments_patientId_completedAt_idx" ON "assessments"("patientId", "completedAt");

-- CreateIndex
CREATE INDEX "assessments_encounterId_idx" ON "assessments"("encounterId");

-- CreateIndex
CREATE INDEX "assessments_updatedAt_idx" ON "assessments"("updatedAt");

-- AddForeignKey
ALTER TABLE "assessments" ADD CONSTRAINT "assessments_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessments" ADD CONSTRAINT "assessments_encounterId_fkey" FOREIGN KEY ("encounterId") REFERENCES "encounters"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessments" ADD CONSTRAINT "assessments_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessments" ADD CONSTRAINT "assessments_lastModifiedById_fkey" FOREIGN KEY ("lastModifiedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
