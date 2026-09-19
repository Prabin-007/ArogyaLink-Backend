/**
 * src/routes/prescriptions.js
 * ----------------------------
 * Prescription Routes — ArogyaLink Person 3 Backend
 *
 * All routes here are mounted at /api/prescriptions in src/index.js.
 * Every route requires authentication (JWT).
 *
 * ⚠️  IMPORTANT — Route Ordering:
 * The "/patient/:patientId" route MUST be declared BEFORE "/:id".
 * If /:id is first, Express will match the literal string "patient"
 * as a prescription ID and the correct route will never be reached.
 *
 * Route summary:
 *   POST  /                        → Create a prescription (DOCTOR, SPECIALIST only)
 *   GET   /patient/:patientId      → Get all prescriptions for a patient (all roles)
 *   GET   /:id                     → Get a single prescription by ID (all roles)
 */

const express = require('express');

// Auth middleware
const { authenticate, authorize } = require('../middleware/auth');

// Prescription controller functions
const {
  createPrescription,
  getPrescription,
  getPatientPrescriptions,
} = require('../controllers/prescriptionController');

const router = express.Router();

// ─── Apply authentication to ALL routes in this file ─────────────────────────
router.use(authenticate);

// =============================================================================
// CREATE PRESCRIPTION
// POST /api/prescriptions
// =============================================================================
// Only licensed doctors and specialists may issue prescriptions.
// The doctorId is automatically captured from req.user.id in the controller.
router.post(
  '/',
  authorize('DOCTOR', 'SPECIALIST'),
  createPrescription
);

// =============================================================================
// GET PATIENT'S PRESCRIPTIONS
// GET /api/prescriptions/patient/:patientId
// =============================================================================
// ⚠️  Declared BEFORE /:id to prevent "patient" from being treated as an ID.
// All roles can view a patient's medication history.
router.get(
  '/patient/:patientId',
  // No additional authorize() = all authenticated roles allowed
  getPatientPrescriptions
);

// =============================================================================
// GET SINGLE PRESCRIPTION
// GET /api/prescriptions/:id
// =============================================================================
// Any authenticated user across the care chain can view a prescription.
// (ASHA workers need to know what medicine to tell the patient to take.)
router.get(
  '/:id',
  // No additional authorize() = all authenticated roles allowed
  getPrescription
);

module.exports = router;
