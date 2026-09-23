/**
 * src/controllers/triageController.js
 *
 * Person 5 — Emergency & Clinical Triage
 */

const prisma = require('../config/db');
const { successResponse, errorResponse } = require('../utils/responseHelper');
const { assessTriage } = require('../services/triageService');
const { createReferralRecord } = require('../services/referralService');

// =============================================================================
// ASSESS TRIAGE FOR AN ENCOUNTER
// =============================================================================

/**
 * POST /api/triage/:encounterId
 *
 * Fetch encounter + latest vitals and run triage.
 *
 * Returns:
 * EMERGENCY | HIGH | MEDIUM | LOW
 */
const assessEncounterTriage = async (req, res, next) => {
  try {
    const { encounterId } = req.params;

    const encounter = await prisma.encounter.findUnique({
      where: { id: encounterId },
      include: {
        vitals: true,
      },
    });

    if (!encounter) {
      return errorResponse(
        res,
        `Encounter with ID "${encounterId}" not found`,
        404
      );
    }

    // Get most recently recorded vitals
    const latestVitals =
      encounter.vitals && encounter.vitals.length > 0
        ? encounter.vitals
            .slice()
            .sort(
              (a, b) =>
                new Date(b.recordedAt) - new Date(a.recordedAt)
            )[0]
        : {};

    const result = assessTriage({
      vitals: {
        temperature: latestVitals.temperature,
        heartRate: latestVitals.heartRate,
        bpSystolic: latestVitals.bpSystolic,
        bpDiastolic: latestVitals.bpDiastolic,
        oxygenSaturation: latestVitals.oxygenSaturation,
      },
      symptoms: encounter.symptoms || [],
    });

    return successResponse(
      res,
      {
        encounterId: encounter.id,
        patientId: encounter.patientId,
        triage: result,
      },
      'Triage assessment completed successfully'
    );
  } catch (error) {
    next(error);
  }
};

// =============================================================================
// ASSESS TRIAGE + CREATE REFERRAL
// =============================================================================

/**
 * POST /api/triage/:encounterId/refer
 *
 * Runs triage and creates a referral using the existing
 * Smart Referral system.
 *
 * Frontend supplies:
 * - patientLatitude
 * - patientLongitude
 * - referringFacilityId
 */
const assessAndRefer = async (req, res, next) => {
  try {
    const { encounterId } = req.params;

    const {
      patientLatitude,
      patientLongitude,
      referringFacilityId,
    } = req.body;

    // --------------------------------------------------
    // Validate referral location information
    // --------------------------------------------------

    if (
      patientLatitude == null ||
      patientLongitude == null ||
      !referringFacilityId
    ) {
      return errorResponse(
        res,
        'patientLatitude, patientLongitude and referringFacilityId are required.',
        400
      );
    }

    // --------------------------------------------------
    // Fetch encounter + latest vitals
    // --------------------------------------------------

    const encounter = await prisma.encounter.findUnique({
      where: { id: encounterId },
      include: {
        vitals: true,
      },
    });

    if (!encounter) {
      return errorResponse(
        res,
        `Encounter with ID "${encounterId}" not found`,
        404
      );
    }

    const latestVitals =
      encounter.vitals && encounter.vitals.length > 0
        ? encounter.vitals
            .slice()
            .sort(
              (a, b) =>
                new Date(b.recordedAt) - new Date(a.recordedAt)
            )[0]
        : {};

    // --------------------------------------------------
    // Run triage
    // --------------------------------------------------

    const triage = assessTriage({
      vitals: {
        temperature: latestVitals.temperature,
        heartRate: latestVitals.heartRate,
        bpSystolic: latestVitals.bpSystolic,
        bpDiastolic: latestVitals.bpDiastolic,
        oxygenSaturation: latestVitals.oxygenSaturation,
      },
      symptoms: encounter.symptoms || [],
    });

    // --------------------------------------------------
    // LOW / MEDIUM
    // --------------------------------------------------

    // Do not automatically create referrals for
    // LOW or MEDIUM cases.
    if (
      triage.triageLevel === 'LOW' ||
      triage.triageLevel === 'MEDIUM'
    ) {
      return successResponse(
        res,
        {
          encounterId: encounter.id,
          patientId: encounter.patientId,
          triage,
          referral: null,
        },
        'Triage completed. Referral not required for this triage level.'
      );
    }

    // --------------------------------------------------
    // HIGH / EMERGENCY
    // --------------------------------------------------

    const referralResult = await createReferralRecord({
      patientId: encounter.patientId,
      encounterId: encounter.id,

      referringFacilityId,

      reason:
        triage.triageLevel === 'EMERGENCY'
          ? 'Emergency red flag detected during triage'
          : 'High-risk condition detected during triage',

      priority: triage.triageLevel,

      patientLatitude: parseFloat(patientLatitude),
      patientLongitude: parseFloat(patientLongitude),

      emergency: triage.triageLevel === 'EMERGENCY',

      createdById: req.user.id,
    });

    return successResponse(
      res,
      {
        encounterId: encounter.id,
        patientId: encounter.patientId,

        triage,

        referral: {
          id: referralResult.referral.id,
          priority: referralResult.referral.priority,
          status: referralResult.referral.status,
          receivingFacilityId:
            referralResult.referral.receivingFacilityId,
        },

        recommendation: referralResult.recommendationData
          ? referralResult.recommendationData.recommendation
          : null,

        alternatives: referralResult.recommendationData
          ? referralResult.recommendationData.alternatives
          : [],
      },
      'Triage completed and referral created successfully'
    );
  } catch (error) {
    next(error);
  }
};

module.exports = {
  assessEncounterTriage,
  assessAndRefer,
};