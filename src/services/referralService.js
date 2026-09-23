/**
 * src/services/referralService.js
 *
 * Shared referral creation logic.
 *
 * Used by:
 * - referralController.js
 * - triageController.js
 *
 * Person 5 can use this service after HIGH/EMERGENCY triage.
 */

const prisma = require('../config/db');
const {
  getSmartReferralRecommendation,
} = require('./smartReferralService');

const VALID_PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'EMERGENCY'];

async function createReferralRecord({
  patientId,
  encounterId = null,
  referringFacilityId,
  receivingFacilityId = null,

  reason,
  priority,

  patientLatitude = null,
  patientLongitude = null,

  requiredService,
  requiredSpecialist,
  preferredSpecialistGender,
  emergency = false,
  requiredDiagnostics = [],

  createdById,
}) {
  // --------------------------------------------------
  // Validation
  // --------------------------------------------------

  if (!patientId || !reason || !priority) {
    throw new Error('patientId, reason and priority are required.');
  }

  if (!VALID_PRIORITIES.includes(priority)) {
    throw new Error(
      `Invalid priority. Must be one of: ${VALID_PRIORITIES.join(', ')}`
    );
  }

  if (!referringFacilityId) {
    throw new Error('referringFacilityId is required.');
  }

  if (!createdById) {
    throw new Error('createdById is required.');
  }

  // --------------------------------------------------
  // Verify patient
  // --------------------------------------------------

  const patient = await prisma.patient.findUnique({
    where: { id: patientId },
  });

  if (!patient) {
    const error = new Error(
      `Patient with ID "${patientId}" not found.`
    );
    error.statusCode = 404;
    throw error;
  }

  // --------------------------------------------------
  // Determine smart vs direct referral
  // --------------------------------------------------

  const isSmartMode =
    patientLatitude != null &&
    patientLongitude != null &&
    !receivingFacilityId;

  let resolvedReceivingFacilityId = receivingFacilityId;
  let recommendationData = null;

  // --------------------------------------------------
  // Smart Referral
  // --------------------------------------------------

  if (isSmartMode) {
    const result = await getSmartReferralRecommendation({
      patientLatitude: parseFloat(patientLatitude),
      patientLongitude: parseFloat(patientLongitude),
      requiredService,
      requiredSpecialist,
      preferredSpecialistGender,
      priority,
      emergency: emergency === true || emergency === 'true',
      requiredDiagnostics: Array.isArray(requiredDiagnostics)
        ? requiredDiagnostics
        : [],
    });

    if (result.noEligibleFacilities) {
      const error = new Error(
        result.message ||
          'No eligible facilities found for smart referral.'
      );

      error.statusCode = 422;
      throw error;
    }

    resolvedReceivingFacilityId =
      result.recommendation.facilityId;

    recommendationData = result;
  }

  // --------------------------------------------------
  // Direct referral
  // --------------------------------------------------

  else if (!receivingFacilityId) {
    const error = new Error(
      'Provide either receivingFacilityId for a direct referral, ' +
      'or patientLatitude and patientLongitude for a smart referral.'
    );

    error.statusCode = 400;
    throw error;
  }

  // --------------------------------------------------
  // Create referral + audit + timeline atomically
  // --------------------------------------------------

  const referral = await prisma.$transaction(async (tx) => {
    const newReferral = await tx.referral.create({
      data: {
        patientId,
        encounterId,

        referringFacilityId,
        receivingFacilityId: resolvedReceivingFacilityId,

        createdById,

        reason,
        priority,

        status: 'CREATED',

        recommendationScore: recommendationData
          ? recommendationData.recommendation.score
          : null,

        recommendationReasons: recommendationData
          ? recommendationData.recommendation.reasons
          : [],

        alternativeFacilities: recommendationData
          ? recommendationData.alternatives
          : null,
      },
    });

    // Audit event
    await tx.referralEvent.create({
      data: {
        referralId: newReferral.id,
        previousStatus: null,
        newStatus: 'CREATED',
        updatedById: createdById,

        remarks: isSmartMode
          ? `Smart referral created. AI recommended facility with score ${recommendationData.recommendation.score}.`
          : 'Referral created.',
      },
    });

    // Patient timeline
    await tx.timelineEvent.create({
      data: {
        patientId,
        eventType: 'REFERRAL_CREATED',
        referenceId: newReferral.id,

        description: isSmartMode
          ? `Smart referral created with priority ${priority}. Reason: ${reason}. AI-recommended facility score: ${recommendationData.recommendation.score}.`
          : `Referral created with priority ${priority}. Reason: ${reason}`,
      },
    });

    return newReferral;
  });

  return {
    referral,
    recommendationData,
    isSmartMode,
  };
}

module.exports = {
  createReferralRecord,
};