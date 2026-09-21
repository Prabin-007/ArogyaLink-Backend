/**
 * src/controllers/prescriptionController.js
 * -------------------------------------------
 * Prescription Controller — ArogyaLink Person 3 Backend
 *
 * Manages prescriptions issued by doctors to patients.
 * A prescription is always linked to:
 *   - A patient  (patientId)
 *   - An encounter (encounterId) — the clinical session it was issued during
 *   - The prescribing doctor (doctorId — automatically set from req.user.id)
 *
 * Medicine details are stored as a JSON array, where each item has the shape:
 *   { name, dosage, frequency, duration, instructions }
 *
 * Every prescription creation appends a PRESCRIPTION_ISSUED timeline event.
 *
 * Prisma models used:
 *   prisma.prescription   → "prescriptions" table
 *   prisma.timelineEvent  → "timeline_events" table
 */

const prisma = require('../config/db');
const { successResponse, errorResponse } = require('../utils/responseHelper');

// =============================================================================
// CREATE PRESCRIPTION
// =============================================================================

/**
 * POST /api/prescriptions
 *
 * Issues a new prescription for a patient.
 * The doctorId is automatically extracted from req.user.id (the authenticated
 * user must be a DOCTOR or SPECIALIST — enforced by the route authorization).
 *
 * Required body fields:
 *   patientId, encounterId, medicineDetails (array)
 *
 * Optional body fields:
 *   instructions — General instructions (e.g., "Take after meals, avoid dairy")
 *
 * medicineDetails array example:
 *   [
 *     {
 *       name: "Amoxicillin",
 *       dosage: "500mg",
 *       frequency: "Twice daily",
 *       duration: "7 days",
 *       instructions: "Take with water"
 *     }
 *   ]
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
const createPrescription = async (req, res, next) => {
  try {
    const {
      patientId,
      encounterId,
      medicineDetails,
      instructions,
    } = req.body;

    // ── Validation ────────────────────────────────────────────────────────────
    const missingFields = [];
    if (!patientId)  missingFields.push('patientId');
    if (!encounterId) missingFields.push('encounterId');
    if (!medicineDetails) missingFields.push('medicineDetails');

    if (missingFields.length > 0) {
      return errorResponse(
        res,
        `Missing required fields: ${missingFields.join(', ')}`,
        400
      );
    }

    // medicineDetails must be a non-empty array
    if (!Array.isArray(medicineDetails) || medicineDetails.length === 0) {
      return errorResponse(
        res,
        'medicineDetails must be a non-empty array of medicine objects ' +
        '[{ name, dosage, frequency, duration, instructions }]',
        400
      );
    }

    // Validate each medicine entry has at least a name
    for (let i = 0; i < medicineDetails.length; i++) {
      if (!medicineDetails[i].name) {
        return errorResponse(
          res,
          `Medicine at index ${i} is missing a required "name" field`,
          400
        );
      }
    }

    // Verify the patient exists
    const patient = await prisma.patient.findUnique({ where: { id: patientId } });
    if (!patient) {
      return errorResponse(res, `Patient with ID "${patientId}" not found`, 404);
    }

    // Verify the encounter exists and belongs to this patient
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

    // ── Create Prescription + Timeline Event (transaction) ────────────────────
    const result = await prisma.$transaction(async (tx) => {
      // 1. Create the prescription
      const prescription = await tx.prescription.create({
        data: {
          patientId,
          encounterId,
          // doctorId comes from the authenticated user — not from the request body.
          // This prevents impersonation (a doctor can't claim another doctor wrote the prescription).
          doctorId:       req.user.id,
          medicineDetails, // Stored as JSON in PostgreSQL
          instructions:    instructions || null,
        },
      });

      // 2. Build a human-readable medicine list for the timeline description
      const medicineList = medicineDetails
        .map((m) => m.name)
        .join(', ');

      // 3. Append a timeline event for the patient
      await tx.timelineEvent.create({
        data: {
          patientId,
          eventType:   'PRESCRIPTION_ISSUED',
          referenceId: prescription.id, // Deep-link to this prescription
          description: `Prescription issued: ${medicineList}.`,
        },
      });

      return prescription;
    });

    return successResponse(res, { prescription: result }, 'Prescription created successfully', 201);
  } catch (error) {
    next(error);
  }
};

// =============================================================================
// GET SINGLE PRESCRIPTION
// =============================================================================

/**
 * GET /api/prescriptions/:id
 *
 * Fetches a single prescription by ID.
 * Includes the patient name, encounter details, and the prescribing doctor.
 *
 * @param {import('express').Request}  req - req.params.id = prescription ID
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
const getPrescription = async (req, res, next) => {
  try {
    const { id } = req.params;

    const prescription = await prisma.prescription.findUnique({
      where: { id },
      include: {
        patient:  { select: { name: true } },
        encounter: {
          select: {
            encounterType: true,
            encounterDate: true,
            facilityId:    true,
          },
        },
        doctor: {
          select: { name: true, identifier: true },
        },
      },
    });

    if (!prescription) {
      return errorResponse(res, `Prescription with ID "${id}" not found`, 404);
    }

    return successResponse(res, { prescription }, 'Prescription fetched successfully');
  } catch (error) {
    next(error);
  }
};

// =============================================================================
// GET ALL PRESCRIPTIONS FOR A PATIENT
// =============================================================================

/**
 * GET /api/prescriptions/patient/:patientId
 *
 * Fetches all prescriptions ever issued to a patient, ordered newest-first.
 * Includes the prescribing doctor's name and the linked encounter details
 * so the frontend can show a complete medication history.
 *
 * @param {import('express').Request}  req - req.params.patientId
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
const getPatientPrescriptions = async (req, res, next) => {
  try {
    const { patientId } = req.params;

    // Verify the patient exists
    const patient = await prisma.patient.findUnique({ where: { id: patientId } });
    if (!patient) {
      return errorResponse(res, `Patient with ID "${patientId}" not found`, 404);
    }

    const prescriptions = await prisma.prescription.findMany({
      where:   { patientId },
      include: {
        doctor: {
          select: { name: true, identifier: true },
        },
        encounter: {
          select: {
            encounterType: true,
            encounterDate: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' }, // Most recently issued first
    });

    return successResponse(
      res,
      { patientId, prescriptions },
      'Patient prescriptions fetched successfully'
    );
  } catch (error) {
    next(error);
  }
};

// =============================================================================
// EXPORTS
// =============================================================================

module.exports = {
  createPrescription,
  getPrescription,
  getPatientPrescriptions,
};
