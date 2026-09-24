/**
 * src/controllers/triageController.js
 *
 * Person 5 — Emergency & Clinical Triage
 * Harmonized with Person 4 (Smart Referral AI) & Person 6 (Resource & Notification Engine)
 */

const prisma = require('../config/db');
const { successResponse, errorResponse } = require('../utils/responseHelper');
const { assessTriage } = require('../services/triageService');
const { createReferralRecord } = require('../services/referralService');

// =============================================================================
// ASSESS TRIAGE FOR AN ENCOUNTER (OR DIRECT / ADHOC)
// =============================================================================

/**
 * POST /api/triage/:encounterId
 *
 * Fetch encounter + latest vitals (or accept direct vitals/symptoms in req.body) and run triage.
 *
 * Returns:
 * EMERGENCY | HIGH | MEDIUM | LOW
 */
const assessEncounterTriage = async (req, res, next) => {
  try {
    const { encounterId } = req.params;
    const bodyVitals = req.body?.vitals;
    const bodySymptoms = req.body?.symptoms;

    let encounter = null;
    let vitals = {};
    let symptoms = [];

    // Support ad-hoc / simulation mode if encounterId is 'direct' or 'adhoc'
    if (encounterId === 'direct' || encounterId === 'adhoc') {
      vitals = bodyVitals || {};
      symptoms = Array.isArray(bodySymptoms) ? bodySymptoms : [];
    } else {
      encounter = await prisma.encounter.findUnique({
        where: { id: encounterId },
        include: {
          vitals: true,
          patient: true,
        },
      });

      if (!encounter) {
        // If not found in DB but vitals/symptoms provided in body, permit fallback evaluation
        if (bodyVitals || bodySymptoms) {
          vitals = bodyVitals || {};
          symptoms = Array.isArray(bodySymptoms) ? bodySymptoms : [];
        } else {
          return errorResponse(
            res,
            `Encounter with ID "${encounterId}" not found`,
            404
          );
        }
      } else {
        // Get most recently recorded vitals from encounter
        const latestVitals =
          encounter.vitals && encounter.vitals.length > 0
            ? encounter.vitals
                .slice()
                .sort(
                  (a, b) =>
                    new Date(b.recordedAt) - new Date(a.recordedAt)
                )[0]
            : {};

        vitals = bodyVitals || {
          temperature: latestVitals.temperature,
          heartRate: latestVitals.heartRate,
          bpSystolic: latestVitals.bpSystolic,
          bpDiastolic: latestVitals.bpDiastolic,
          oxygenSaturation: latestVitals.oxygenSaturation,
        };

        symptoms =
          Array.isArray(bodySymptoms) && bodySymptoms.length > 0
            ? bodySymptoms
            : (encounter.symptoms || []);
      }
    }

    const result = assessTriage({
      vitals: {
        temperature: vitals.temperature,
        heartRate: vitals.heartRate,
        bpSystolic: vitals.bpSystolic != null ? vitals.bpSystolic : vitals.systolicBP,
        bpDiastolic: vitals.bpDiastolic != null ? vitals.bpDiastolic : vitals.diastolicBP,
        oxygenSaturation: vitals.oxygenSaturation != null ? vitals.oxygenSaturation : vitals.spO2,
      },
      symptoms,
    });

    return successResponse(
      res,
      {
        encounterId: encounter ? encounter.id : (encounterId || null),
        patientId: encounter ? encounter.patientId : (req.body?.patientId || null),
        patient: encounter?.patient ? {
          id: encounter.patient.id,
          name: encounter.patient.name,
          gender: encounter.patient.gender,
          category: encounter.patient.category,
        } : null,
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
 * Runs triage and creates a smart referral for HIGH/EMERGENCY.
 * Automatically resolves coordinates and dispatches alerts.
 */
const assessAndRefer = async (req, res, next) => {
  try {
    const { encounterId } = req.params;

    const {
      patientId: bodyPatientId,
      patientLatitude,
      patientLongitude,
      referringFacilityId,
      requiredService,
      requiredSpecialist,
      preferredSpecialistGender,
      requiredDiagnostics = [],
      requiredMedicines = [],
      reason: customReason,
      vitals: bodyVitals,
      symptoms: bodySymptoms,
    } = req.body;

    let encounter = null;
    let targetPatientId = bodyPatientId;

    if (encounterId && encounterId !== 'adhoc' && encounterId !== 'direct') {
      encounter = await prisma.encounter.findUnique({
        where: { id: encounterId },
        include: {
          vitals: true,
          patient: true,
        },
      });
      if (encounter) {
        targetPatientId = encounter.patientId;
      }
    }

    // If ad-hoc or encounter not found, but patientId is provided, generate a clinical encounter
    if (!encounter && targetPatientId) {
      const patient = await prisma.patient.findUnique({
        where: { id: targetPatientId },
      });
      if (!patient) {
        return errorResponse(res, `Patient with ID "${targetPatientId}" not found`, 404);
      }

      encounter = await prisma.encounter.create({
        data: {
          patientId: targetPatientId,
          doctorId: req.user?.id || null,
          facilityId: referringFacilityId || req.user?.facilityId || 'PHC-DEMO-001',
          encounterType: 'EMERGENCY',
          symptoms: Array.isArray(bodySymptoms) ? bodySymptoms : [],
          clinicalNotes: customReason || 'Auto-created during Emergency Triage Assessment',
          encounterDate: new Date(),
        },
        include: { patient: true, vitals: true },
      });
    }

    if (!encounter) {
      return errorResponse(
        res,
        `Encounter "${encounterId}" not found and no patientId provided`,
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

    const vitals = bodyVitals || {
      temperature: latestVitals.temperature,
      heartRate: latestVitals.heartRate,
      bpSystolic: latestVitals.bpSystolic != null ? latestVitals.bpSystolic : latestVitals.systolicBP,
      bpDiastolic: latestVitals.bpDiastolic != null ? latestVitals.bpDiastolic : latestVitals.diastolicBP,
      oxygenSaturation: latestVitals.oxygenSaturation != null ? latestVitals.oxygenSaturation : latestVitals.spO2,
    };

    const symptoms =
      Array.isArray(bodySymptoms) && bodySymptoms.length > 0
        ? bodySymptoms
        : (encounter.symptoms || []);

    // --------------------------------------------------
    // Run triage
    // --------------------------------------------------

    const triage = assessTriage({
      vitals: {
        temperature: vitals.temperature,
        heartRate: vitals.heartRate,
        bpSystolic: vitals.bpSystolic,
        bpDiastolic: vitals.bpDiastolic,
        oxygenSaturation: vitals.oxygenSaturation,
      },
      symptoms,
    });

    // --------------------------------------------------
    // LOW / MEDIUM
    // --------------------------------------------------

    // Do not automatically create referrals for LOW or MEDIUM cases.
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

    // Determine referring facility ID
    const fromFacilityId =
      referringFacilityId ||
      encounter.facilityId ||
      req.user?.facilityId ||
      'PHC-DEMO-001';

    // Determine GPS coordinates for Smart Referral
    let lat = patientLatitude != null ? parseFloat(patientLatitude) : null;
    let lon = patientLongitude != null ? parseFloat(patientLongitude) : null;

    if (lat == null || lon == null || isNaN(lat) || isNaN(lon)) {
      if (fromFacilityId) {
        const fac = await prisma.facility.findUnique({
          where: { id: fromFacilityId },
        });
        if (fac && fac.latitude != null && fac.longitude != null) {
          lat = fac.latitude;
          lon = fac.longitude;
        }
      }
      // Standard Maharashtra / Pune fallback if coordinates not found
      if (lat == null || lon == null || isNaN(lat) || isNaN(lon)) {
        lat = 18.5204;
        lon = 73.8567;
      }
    }

    const referralReason =
      customReason ||
      (triage.triageLevel === 'EMERGENCY'
        ? `Emergency red flag detected: ${triage.redFlags.join(', ') || 'Critical condition'}`
        : `High-risk triage condition (${triage.reasons.join(', ')})`);

    const referralResult = await createReferralRecord({
      patientId: encounter.patientId,
      encounterId: encounter.id,

      referringFacilityId: fromFacilityId,

      reason: referralReason,
      priority: triage.triageLevel,

      patientLatitude: lat,
      patientLongitude: lon,

      emergency: triage.triageLevel === 'EMERGENCY',

      requiredService,
      requiredSpecialist,
      preferredSpecialistGender,
      requiredDiagnostics,
      requiredMedicines,

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
          referringFacilityId: referralResult.referral.referringFacilityId,
          receivingFacilityId: referralResult.referral.receivingFacilityId,
          recommendationScore: referralResult.referral.recommendationScore,
          recommendationReasons: referralResult.referral.recommendationReasons,
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