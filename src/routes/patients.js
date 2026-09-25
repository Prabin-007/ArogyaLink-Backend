/**
 * src/routes/patients.js
 * ----------------------
 * Patient Routes — ArogyaLink Person 3 Backend
 *
 * All routes here are mounted at /api/patients in src/index.js.
 * Every route requires authentication (JWT). Authorization is
 * role-based per route as specified in the ArogyaLink RBAC design.
 *
 * Route summary:
 *   GET    /                  → List all patients (admin/clinical staff only)
 *   POST   /                  → Register a new patient (field workers + doctors)
 *   GET    /:id               → Get a single patient by ID (all authenticated roles)
 *   PUT    /:id               → Update patient details (field workers + doctors)
 *   GET    /:id/timeline      → Get patient's event timeline (all roles)
 *   GET    /:id/assessments   → Get patient's assessments, newest first (doctor/specialist/admins)
 *   GET    /:id/followups     → Get patient's follow-ups (all roles)
 *   GET    /:id/referrals     → Get patient's referrals (all roles)
 */

const express = require('express');

// Auth middleware
const { authenticate, authorize } = require('../middleware/auth');

// Patient controller functions
const {
  createPatient,
  getPatient,
  updatePatient,
  getPatientTimeline,
  getPatientAssessments,
  getPatientFollowUps,
  getPatientReferrals,
  listPatients,
} = require('../controllers/patientController');

const router = express.Router();

// ─── Apply authentication to ALL routes in this file ─────────────────────────
// Every request to /api/patients/* must carry a valid JWT.
router.use(authenticate);

// =============================================================================
// LIST PATIENTS
// GET /api/patients
// =============================================================================
// Only administrative and clinical staff should be able to browse the full
// patient list. Field workers (ASHA/ANM) should access only their assigned
// patients (filter by ?assignedAshaId=).
router.get(
  '/',
  authorize('SYSTEM_ADMIN', 'DOCTOR', 'SPECIALIST', 'HOSPITAL_ADMIN', 'ASHA', 'ANM'),
  listPatients
);

// =============================================================================
// CREATE PATIENT
// POST /api/patients
// =============================================================================
// ASHA workers and ANMs register patients in the field. Doctors can also
// register a patient directly if needed.
router.post(
  '/',
  authorize('ASHA', 'ANM', 'DOCTOR'),
  createPatient
);

// =============================================================================
// GET SINGLE PATIENT
// GET /api/patients/:id
// =============================================================================
// Any authenticated user can look up a patient — everyone in the care chain
// needs access to view patient details.
router.get(
  '/:id',
  // No authorize() call = all authenticated roles are allowed
  getPatient
);

// =============================================================================
// UPDATE PATIENT
// PUT /api/patients/:id
// =============================================================================
// Field workers and doctors can update patient details (e.g., address change,
// contact update, reassignment). Admins manage this at the system level.
router.put(
  '/:id',
  authorize('ASHA', 'ANM', 'DOCTOR'),
  updatePatient
);

// =============================================================================
// GET PATIENT TIMELINE
// GET /api/patients/:id/timeline
// =============================================================================
// All roles need to view the patient's care history for context before
// any clinical decision. No restriction beyond authentication.
router.get(
  '/:id/timeline',
  getPatientTimeline
);

// =============================================================================
// GET PATIENT ASSESSMENTS
// GET /api/patients/:id/assessments
// =============================================================================
// For the doctor dashboard: the structured forms an ASHA completed for this
// patient, newest first. Clinical / admin roles only (field workers see their
// own assessments on the phone).
router.get(
  '/:id/assessments',
  authorize('DOCTOR', 'SPECIALIST', 'HOSPITAL_ADMIN', 'SYSTEM_ADMIN'),
  getPatientAssessments
);

// =============================================================================
// GET PATIENT FOLLOW-UPS
// GET /api/patients/:id/followups
// =============================================================================
// All authenticated users can check follow-up status (e.g., ASHA checks
// their assigned tasks, doctors check if follow-ups were completed).
router.get(
  '/:id/followups',
  getPatientFollowUps
);

// =============================================================================
// GET PATIENT REFERRALS
// GET /api/patients/:id/referrals
// =============================================================================
// Hospital admins, specialists, and doctors all need to view referrals.
// No restriction beyond authentication.
router.get(
  '/:id/referrals',
  getPatientReferrals
);

module.exports = router;
