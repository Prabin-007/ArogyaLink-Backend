/**
 * src/routes/teleconsultationRoutes.js
 * --------------------------------------
 * REST endpoints for the teleconsultation request lifecycle.
 *
 * All routes require authentication. Role checks are enforced in the controller
 * but the route-level authorize() calls provide a fast-fail at the middleware
 * layer before any DB hit.
 *
 * Full route table:
 *
 *   POST   /api/teleconsultations              create a new request (ASHA/ANM/DOCTOR/SPECIALIST)
 *   GET    /api/teleconsultations/incoming      doctor's live queue  (DOCTOR/SPECIALIST)
 *   GET    /api/teleconsultations/mine          requester's own list (all roles)
 *   GET    /api/teleconsultations/:id           fetch single request  (all roles)
 *   PATCH  /api/teleconsultations/:id/accept    accept → create Encounter + roomId (DOCTOR/SPECIALIST)
 *   PATCH  /api/teleconsultations/:id/reject    decline (DOCTOR/SPECIALIST)
 *   PATCH  /api/teleconsultations/:id/cancel    cancel before acceptance (requester only)
 *   PATCH  /api/teleconsultations/:id/complete  mark call done (DOCTOR/SPECIALIST)
 */

const express = require('express');
const { authenticate, authorize } = require('../middleware/auth');
const {
  createRequest,
  acceptRequest,
  rejectRequest,
  cancelRequest,
  completeRequest,
  getRequestById,
  listIncoming,
  listMine,
} = require('../controllers/teleconsultationController');

const router = express.Router();

// All routes require a valid JWT.
router.use(authenticate);

// ── Collection routes ────────────────────────────────────────────────────────

// POST — create a teleconsultation request (e.g., ASHA requesting a specialist)
router.post(
  '/',
  authorize('ASHA', 'ANM', 'DOCTOR', 'SPECIALIST'),
  createRequest
);

// GET — doctor/specialist's live incoming queue
// NOTE: /incoming and /mine must come BEFORE /:id so Express doesn't swallow them as params.
router.get(
  '/incoming',
  authorize('DOCTOR', 'SPECIALIST'),
  listIncoming
);

// GET — requester's own created requests (for polling status / getting roomId)
router.get('/mine', listMine);

// ── Single-resource routes ────────────────────────────────────────────────────

// GET — fetch any single request by id (any authenticated role)
router.get('/:id', getRequestById);

// PATCH — accept (creates Encounter + roomId, notifies requester via Socket.io)
router.patch(
  '/:id/accept',
  authorize('DOCTOR', 'SPECIALIST'),
  acceptRequest
);

// PATCH — reject (notifies requester via Socket.io)
router.patch(
  '/:id/reject',
  authorize('DOCTOR', 'SPECIALIST'),
  rejectRequest
);

// PATCH — cancel (requester pulls the request before the doctor acts)
router.patch('/:id/cancel', cancelRequest);

// PATCH — complete (doctor marks the call done after it ends)
router.patch(
  '/:id/complete',
  authorize('DOCTOR', 'SPECIALIST'),
  completeRequest
);

module.exports = router;
