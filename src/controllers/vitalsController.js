/**
 * src/controllers/vitalsController.js
 * -------------------------------------
 * Vitals Controller — ArogyaLink Person 3 Backend
 *
 * Vitals represent clinical measurements taken for a patient — either
 * during an encounter (linked via encounterId) or independently in the
 * field by an ASHA worker (encounterId is optional in both cases).
 *
 * Each recorded vitals entry:
 *   - Links to the patient
 *   - Optionally links to an encounter
 *   - Records who took the measurements (recordedById from req.user)
 *   - Appends a VITALS_RECORDED timeline event for the patient
 *
 * Prisma models used:
 *   prisma.vitals         → "vitals" table
 *   prisma.timelineEvent  → "timeline_events" table
 *
 * NOTE: In the Prisma schema, the Vitals model uses:
 *   bpSystolic  (not bloodPressureSystolic)
 *   bpDiastolic (not bloodPressureDiastolic)
 * The API accepts the more descriptive names and maps them internally.
 */

const prisma = require('../config/db');
const { successResponse, errorResponse } = require('../utils/responseHelper');
const { buildVitalsSummary, logVitalsRecorded } = require('../utils/timeline');

// =============================================================================
// RECORD VITALS
// =============================================================================

/**
 * POST /api/vitals
 *
 * Records a new set of vitals for a patient. At least one measurement must
 * be provided (you can't create an empty vitals record).
 *
 * Required body fields:
 *   patientId
 *
 * Optional body fields (at least one measurement must be present):
 *   encounterId              — Link to an encounter (omit for standalone vitals)
 *   temperature              — Body temperature in °C (float)
 *   heartRate                — Beats per minute (integer)
 *   bloodPressureSystolic    — Systolic BP in mmHg (integer)
 *   bloodPressureDiastolic   — Diastolic BP in mmHg (integer)
 *   oxygenSaturation         — SpO2 percentage e.g. 98.5 (float)
 *   weight                   — Body weight in kg (float)
 *
 * The recordedById is automatically set from the authenticated user (req.user.id).
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
const recordVitals = async (req, res, next) => {
  try {
    const {
      patientId,
      encounterId,
      temperature,
      heartRate,
      bloodPressureSystolic,
      bloodPressureDiastolic,
      oxygenSaturation,
      weight,
    } = req.body;

    // ── Validation ────────────────────────────────────────────────────────────
    if (!patientId) {
      return errorResponse(res, 'Missing required field: patientId', 400);
    }

    // At least one measurement must be provided — a blank vitals record is useless.
    const hasMeasurement = (
      temperature             !== undefined ||
      heartRate               !== undefined ||
      bloodPressureSystolic   !== undefined ||
      bloodPressureDiastolic  !== undefined ||
      oxygenSaturation        !== undefined ||
      weight                  !== undefined
    );

    if (!hasMeasurement) {
      return errorResponse(
        res,
        'At least one vitals measurement must be provided ' +
        '(temperature, heartRate, bloodPressureSystolic, bloodPressureDiastolic, oxygenSaturation, weight)',
        400
      );
    }

    // Verify the patient exists
    const patient = await prisma.patient.findUnique({ where: { id: patientId } });
    if (!patient) {
      return errorResponse(res, `Patient with ID "${patientId}" not found`, 404);
    }

    // If an encounterId is given, verify it exists and belongs to this patient
    if (encounterId) {
      const encounter = await prisma.encounter.findUnique({ where: { id: encounterId } });
      if (!encounter) {
        return errorResponse(res, `Encounter with ID "${encounterId}" not found`, 404);
      }
      if (encounter.patientId !== patientId) {
        return errorResponse(
          res,
          `Encounter "${encounterId}" does not belong to patient "${patientId}"`,
          400
        );
      }
    }

    // ── Create Vitals + Timeline Event (transaction) ──────────────────────────
    const result = await prisma.$transaction(async (tx) => {
      // 1. Create the vitals record
      // NOTE: The schema uses bpSystolic/bpDiastolic (short form).
      //       We accept the descriptive names from the API and map them here.
      const vitals = await tx.vitals.create({
        data: {
          patientId,
          encounterId:     encounterId     || null,
          temperature:     temperature     !== undefined ? parseFloat(temperature)    : null,
          heartRate:       heartRate       !== undefined ? parseInt(heartRate, 10)    : null,
          bpSystolic:      bloodPressureSystolic  !== undefined ? parseInt(bloodPressureSystolic, 10)  : null,
          bpDiastolic:     bloodPressureDiastolic !== undefined ? parseInt(bloodPressureDiastolic, 10) : null,
          oxygenSaturation: oxygenSaturation !== undefined ? parseFloat(oxygenSaturation) : null,
          weight:           weight           !== undefined ? parseFloat(weight)           : null,
          // The authenticated user (ASHA/ANM/Doctor) who took the readings
          recordedById:    req.user.id,
        },
      });

      // 2. Build a human-readable summary for the timeline description
      // (raw request values are passed so the text matches what clients always saw)
      const measurementSummary = buildVitalsSummary({
        temperature,
        heartRate,
        bpSystolic:  bloodPressureSystolic,
        bpDiastolic: bloodPressureDiastolic,
        oxygenSaturation,
        weight,
      });

      // 3. Append a timeline event for the patient (shared helper)
      await logVitalsRecorded(tx, vitals, measurementSummary);

      return vitals;
    });

    return successResponse(res, { vitals: result }, 'Vitals recorded successfully', 201);
  } catch (error) {
    next(error);
  }
};

// =============================================================================
// GET VITALS FOR AN ENCOUNTER
// =============================================================================

/**
 * GET /api/vitals/encounter/:encounterId
 *
 * Fetches all vitals records associated with a specific encounter.
 * Useful for doctors reviewing the measurements taken during a visit.
 *
 * @param {import('express').Request}  req - req.params.encounterId
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
const getEncounterVitals = async (req, res, next) => {
  try {
    const { encounterId } = req.params;

    // Verify the encounter exists before querying its vitals
    const encounter = await prisma.encounter.findUnique({ where: { id: encounterId } });
    if (!encounter) {
      return errorResponse(res, `Encounter with ID "${encounterId}" not found`, 404);
    }

    const vitals = await prisma.vitals.findMany({
      where:   { encounterId },
      include: {
        // Show who recorded the vitals (useful for audit)
        recordedBy: {
          select: { name: true, identifier: true, role: true },
        },
      },
      orderBy: { recordedAt: 'desc' }, // Most recently recorded first
    });

    return successResponse(
      res,
      { encounterId, vitals },
      'Encounter vitals fetched successfully'
    );
  } catch (error) {
    next(error);
  }
};

// =============================================================================
// EXPORTS
// =============================================================================

module.exports = {
  recordVitals,
  getEncounterVitals,
};
