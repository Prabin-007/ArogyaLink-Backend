/**
 * src/routes/encounters.js
 * -------------------------
 * Encounter Routes — ArogyaLink Person 3 Backend
 *
 * All routes here are mounted at /api/encounters in src/index.js.
 * Every route requires authentication (JWT).
 *
 * Route summary:
 *   POST  /      → Create a new encounter (field workers + doctors)
 *   GET   /:id   → Get a single encounter with full clinical details (all roles)
 */

const express = require('express');

// Auth middleware
const { authenticate, authorize } = require('../middleware/auth');

// Encounter controller functions
const {
  createEncounter,
  getEncounter,
  listEncounters,
} = require('../controllers/encounterController');

const router = express.Router();

// ─── Apply authentication to ALL routes in this file ─────────────────────────
router.use(authenticate);

// =============================================================================
// CREATE ENCOUNTER
// POST /api/encounters
// =============================================================================
// ASHA/ANM workers record encounters in the field; doctors create encounters
// at the PHC. Specialists may also create teleconsultation encounters.
router.post(
  '/',
  authorize('ASHA', 'ANM', 'DOCTOR'),
  createEncounter
);

// =============================================================================
// LIST ENCOUNTERS
// GET /api/encounters
// =============================================================================
router.get('/', listEncounters);

// =============================================================================
// GET SINGLE ENCOUNTER
// GET /api/encounters/:id
// =============================================================================
// Any authenticated user across the care chain needs to view encounter details
// (vitals, prescriptions) to make informed decisions.
router.get(
  '/:id',
  // No additional authorize() = all authenticated roles allowed
  getEncounter
);

module.exports = router;
