/**
 * src/controllers/encounterController.js
 * ----------------------------------------
 * Encounter Controller — ArogyaLink Person 3 Backend
 *
 * An Encounter represents a single clinical interaction between a patient
 * and a doctor. It is the anchor record for:
 *   - Vitals recorded during the visit
 *   - Prescriptions issued
 *   - Referrals created
 *   - Follow-ups scheduled
 *
 * Every encounter creation automatically appends an ENCOUNTER_CREATED
 * event to the patient's timeline.
 *
 * Prisma models used:
 *   prisma.encounter      → "encounters" table
 *   prisma.timelineEvent  → "timeline_events" table
 */

const prisma = require('../config/db');
const { successResponse, errorResponse } = require('../utils/responseHelper');
const { logEncounterCreated } = require('../utils/timeline');

// =============================================================================
// CREATE ENCOUNTER
// =============================================================================

/**
 * POST /api/encounters
 *
 * Records a new clinical encounter for a patient.
 * Automatically logs an ENCOUNTER_CREATED timeline event.
 *
 * Required body fields:
 *   patientId, doctorId, facilityId, encounterType, encounterDate
 *
 * Optional body fields:
 *   symptoms (string[]), clinicalNotes (string)
 *
 * Valid encounterType values:
 *   PHC_VISIT | TELECONSULTATION | EMERGENCY | FOLLOW_UP_VISIT
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
const createEncounter = async (req, res, next) => {
  try {
    const {
      patientId,
      doctorId,
      facilityId,
      encounterType,
      symptoms,
      clinicalNotes,
      encounterDate,
    } = req.body;

    // doctorId can be explicitly provided, or it defaults to the logged-in doctor/user
    const effectiveDoctorId = doctorId || (req.user && req.user.id ? req.user.id : null);

    // ── Validation ────────────────────────────────────────────────────────────
    const missingFields = [];
    if (!patientId)          missingFields.push('patientId');
    if (!effectiveDoctorId)  missingFields.push('doctorId');
    if (!facilityId)         missingFields.push('facilityId');
    if (!encounterType)      missingFields.push('encounterType');
    if (!encounterDate)      missingFields.push('encounterDate');

    if (missingFields.length > 0) {
      return errorResponse(
        res,
        `Missing required fields: ${missingFields.join(', ')}`,
        400
      );
    }

    // Validate encounterType against the schema enum
    const validEncounterTypes = ['PHC_VISIT', 'TELECONSULTATION', 'EMERGENCY', 'FOLLOW_UP_VISIT'];
    if (!validEncounterTypes.includes(encounterType)) {
      return errorResponse(
        res,
        `Invalid encounterType. Must be one of: ${validEncounterTypes.join(', ')}`,
        400
      );
    }

    // Verify the patient exists before creating the encounter
    const patient = await prisma.patient.findUnique({ where: { id: patientId } });
    if (!patient) {
      return errorResponse(res, `Patient with ID "${patientId}" not found`, 404);
    }

    // ── Create Encounter + Timeline Event (transaction) ───────────────────────
    const result = await prisma.$transaction(async (tx) => {
      // 1. Create the encounter record
      const encounter = await tx.encounter.create({
        data: {
          patientId,
          doctorId:      effectiveDoctorId,
          facilityId,
          encounterType,
          // symptoms is a String[] in Prisma (PostgreSQL array); default to []
          symptoms:      Array.isArray(symptoms) ? symptoms : [],
          clinicalNotes: clinicalNotes || null,
          encounterDate: new Date(encounterDate),
        },
      });

      // 2. Log the encounter as a timeline event for the patient
      // (shared helper — same event the mobile sync path writes)
      await logEncounterCreated(tx, encounter);

      return encounter;
    });

    return successResponse(res, { encounter: result }, 'Encounter created successfully', 201);
  } catch (error) {
    next(error);
  }
};

// =============================================================================
// GET SINGLE ENCOUNTER
// =============================================================================

/**
 * GET /api/encounters/:id
 *
 * Fetches a single encounter by ID with all related clinical data:
 *   - Patient name (for display)
 *   - Doctor name and identifier
 *   - All vitals recorded during this encounter
 *   - All prescriptions issued during this encounter
 *
 * @param {import('express').Request}  req - req.params.id = encounter ID
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
const getEncounter = async (req, res, next) => {
  try {
    const { id } = req.params;

    const encounter = await prisma.encounter.findUnique({
      where: { id },
      include: {
        // Patient: just the name for display
        patient: {
          select: { name: true },
        },
        // Doctor: name and their official identifier (doctor reg. number)
        doctor: {
          select: {
            name:       true,
            identifier: true,
          },
        },
        // All vitals recorded during this encounter
        vitals: true,
        // All prescriptions issued during this encounter
        prescriptions: true,
      },
    });

    if (!encounter) {
      return errorResponse(res, `Encounter with ID "${id}" not found`, 404);
    }

    return successResponse(res, { encounter }, 'Encounter fetched successfully');
  } catch (error) {
    next(error);
  }
};

// =============================================================================
// LIST ENCOUNTERS FOR A PATIENT (Internal Helper)
// =============================================================================

/**
 * listPatientEncounters
 *
 * Fetches all encounters for a given patient, ordered by most recent first.
 * This function is primarily used internally (e.g., by sync services or
 * report generation). It is not directly exposed as a route but is exported
 * for use by other parts of the application.
 *
 * @param {string} patientId - The ID of the patient to fetch encounters for
 * @returns {Promise<Array>} Array of encounter objects
 */
const listPatientEncounters = async (patientId) => {
  // This is an internal helper, not an Express handler — no req/res needed.
  const encounters = await prisma.encounter.findMany({
    where:   { patientId },
    include: {
      doctor: {
        select: { name: true, identifier: true },
      },
      vitals:        true,
      prescriptions: true,
    },
    orderBy: { encounterDate: 'desc' },
  });
  return encounters;
};

// =============================================================================
// EXPORTS
// =============================================================================

module.exports = {
  createEncounter,
  getEncounter,
  listPatientEncounters, // Exported for internal use by other modules
};
