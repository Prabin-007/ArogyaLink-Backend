/**
 * src/routes/referrals.js
 * ------------------------
 * Express router for all referral-related API endpoints.
 *
 * All routes are mounted under /api/referrals in src/index.js.
 *
 * Route Summary:
 * ┌─────────────────────────────┬──────────────────────────────────────────┬─────────────────────────────────┐
 * │ Method + Path               │ Controller Function                       │ Allowed Roles                   │
 * ├─────────────────────────────┼──────────────────────────────────────────┼─────────────────────────────────┤
 * │ POST   /                    │ createReferral                            │ DOCTOR, SPECIALIST              │
 * │ GET    /                    │ getFacilityReferrals (?receivingFacilityId│ DOCTOR, SPECIALIST, HOSP_ADMIN  │
 * │                             │   or ?patientId, ?status, ?priority)      │                                 │
 * │ GET    /:id                 │ getReferral                               │ Any authenticated role          │
 * │ PATCH  /:id/status          │ updateReferralStatus                      │ DOCTOR, SPECIALIST, HOSP_ADMIN  │
 * └─────────────────────────────┴──────────────────────────────────────────┴─────────────────────────────────┘
 */

const express = require('express');
const router = express.Router();

// Middleware
const { authenticate, authorize, ROLES } = require('../middleware/auth');

// Controller functions
const {
  createReferral,
  getReferral,
  updateReferralStatus,
  getFacilityReferrals,
  getRecommendation,
} = require('../controllers/referralController');

// ─── Routes ───────────────────────────────────────────────────────────────────

/**
 * POST /api/referrals/recommend
 * Preview AI facility recommendations based on distance, live inventory, and readiness.
 */
router.post(
  '/recommend',
  authenticate,
  getRecommendation
);

/**
 * POST /api/referrals
 * Create a new referral for a patient.
 * Only doctors and specialists can raise referrals.
 */
router.post(
  '/',
  authenticate,
  authorize(ROLES.DOCTOR, ROLES.SPECIALIST, ROLES.SYSTEM_ADMIN),
  createReferral
);

/**
 * GET /api/referrals
 * Get referrals for a specific facility or patient.
 * Supports query params: ?receivingFacilityId=, ?patientId=, ?status=, ?priority=
 *
 * Hospital admins use this to see incoming referrals for their facility.
 * Doctors and field workers use this to track patient referrals.
 */
router.get(
  '/',
  authenticate,
  getFacilityReferrals
);

/**
 * GET /api/referrals/:id
 * Get a single referral by ID with full details (patient, audit log, follow-ups).
 * All authenticated roles can view a referral (read-only).
 */
router.get(
  '/:id',
  authenticate,
  getReferral
);

/**
 * PATCH /api/referrals/:id/status
 * Update the status of a referral (e.g., ACCEPTED, PATIENT_ARRIVED, TREATED).
 * Doctors, specialists, and hospital admins can update status.
 */
router.patch(
  '/:id/status',
  authenticate,
  authorize(ROLES.DOCTOR, ROLES.SPECIALIST, ROLES.HOSPITAL_ADMIN, ROLES.SYSTEM_ADMIN),
  updateReferralStatus
);

module.exports = router;
