/**
 * src/routes/followups.js
 * ------------------------
 * Express router for all follow-up related API endpoints.
 *
 * All routes are mounted under /api/followups in src/index.js.
 *
 * IMPORTANT: Static routes (/assigned, /overdue) MUST be defined BEFORE
 * dynamic routes (/:id). If /:id came first, Express would try to treat
 * "assigned" and "overdue" as ID values and fail to find a match.
 *
 * Route Summary:
 * ┌──────────────────────┬──────────────────────────┬──────────────────────────────────┐
 * │ Method + Path        │ Controller Function       │ Allowed Roles                    │
 * ├──────────────────────┼──────────────────────────┼──────────────────────────────────┤
 * │ POST   /             │ createFollowUp            │ DOCTOR, SPECIALIST               │
 * │ GET    /assigned     │ getAssignedFollowUps      │ ASHA, ANM                        │
 * │ GET    /overdue      │ getOverdueFollowUps       │ DOCTOR, SPECIALIST, SYSTEM_ADMIN │
 * │ GET    /:id          │ getFollowUp               │ Any authenticated role           │
 * │ PATCH  /:id          │ updateFollowUp            │ ASHA, ANM, DOCTOR                │
 * └──────────────────────┴──────────────────────────┴──────────────────────────────────┘
 */

const express = require('express');
const router = express.Router();

// Middleware
const { authenticate, authorize, ROLES } = require('../middleware/auth');

// Controller functions
const {
  createFollowUp,
  getFollowUp,
  updateFollowUp,
  getAssignedFollowUps,
  getOverdueFollowUps,
} = require('../controllers/followupController');

// ─── Routes ───────────────────────────────────────────────────────────────────

/**
 * POST /api/followups
 * Schedule a new follow-up task for a patient.
 * Only doctors and specialists can prescribe follow-ups.
 */
router.post(
  '/',
  authenticate,
  authorize(ROLES.DOCTOR, ROLES.SPECIALIST),
  createFollowUp
);

/**
 * GET /api/followups/assigned
 * Returns follow-ups assigned to the logged-in ASHA/ANM worker.
 * Supports optional ?status=PENDING to show only actionable items.
 *
 * ⚠️  Must come BEFORE GET /:id to avoid "assigned" being treated as an ID.
 */
router.get(
  '/assigned',
  authenticate,
  authorize(ROLES.ASHA, ROLES.ANM, ROLES.DOCTOR, ROLES.SPECIALIST, ROLES.SYSTEM_ADMIN),
  getAssignedFollowUps
);

/**
 * GET /api/followups/overdue
 * Returns all follow-ups past their due date that are still PENDING or IN_PROGRESS.
 * For supervisory review by doctors and system admins.
 *
 * ⚠️  Must come BEFORE GET /:id to avoid "overdue" being treated as an ID.
 */
router.get(
  '/overdue',
  authenticate,
  authorize(ROLES.DOCTOR, ROLES.SPECIALIST, ROLES.SYSTEM_ADMIN),
  getOverdueFollowUps
);

/**
 * GET /api/followups/:id
 * Get a single follow-up by ID with full details (patient, assignedTo, encounter).
 * All authenticated roles can view a follow-up.
 */
router.get(
  '/:id',
  authenticate,
  getFollowUp
);

/**
 * PATCH /api/followups/:id
 * Update a follow-up's status, outcome, or notes.
 * ASHA/ANM workers do this in the field when they complete or miss a visit.
 * Doctors can also update if needed.
 */
router.patch(
  '/:id',
  authenticate,
  authorize(ROLES.ASHA, ROLES.ANM, ROLES.DOCTOR),
  updateFollowUp
);

module.exports = router;
