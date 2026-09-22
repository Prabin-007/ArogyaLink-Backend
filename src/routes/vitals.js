/**
 * src/routes/vitals.js
 * ---------------------
 * Vitals Routes — ArogyaLink Person 3 Backend
 *
 * All routes here are mounted at /api/vitals in src/index.js.
 * Every route requires authentication (JWT).
 *
 * Route summary:
 *   POST  /                          → Record new vitals (field workers + doctors)
 *   GET   /encounter/:encounterId    → Get all vitals for an encounter (all roles)
 */

const express = require('express');

// Auth middleware
const { authenticate, authorize } = require('../middleware/auth');

// Vitals controller functions
const {
  recordVitals,
  getEncounterVitals,
} = require('../controllers/vitalsController');

const router = express.Router();

// ─── Apply authentication to ALL routes in this file ─────────────────────────
router.use(authenticate);

// =============================================================================
// RECORD VITALS
// POST /api/vitals
// =============================================================================
// Field workers (ASHA/ANM) take readings in the field; doctors record vitals
// during a PHC encounter. Specialists can also record during teleconsultations.
router.post(
  '/',
  authorize('ASHA', 'ANM', 'DOCTOR'),
  recordVitals
);

// =============================================================================
// GET ENCOUNTER VITALS
// GET /api/vitals/encounter/:encounterId
// =============================================================================
// Any authenticated member of the care chain can view vitals for an encounter.
// IMPORTANT: This specific route must be defined BEFORE any /:id routes (if
// added in the future) to prevent Express from matching "encounter" as an ID.
router.get(
  '/encounter/:encounterId',
  // No additional authorize() = all authenticated roles allowed
  getEncounterVitals
);

module.exports = router;
