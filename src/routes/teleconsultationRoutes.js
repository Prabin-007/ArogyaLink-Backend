/**
 * src/routes/teleconsultationRoutes.js
 * --------------------------------------
 * REST endpoints for the teleconsultation request lifecycle.
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

// All routes require authentication
router.use(authenticate);

// ── Collection routes ────────────────────────────────────────────────────────

// POST / — create a teleconsultation request
router.post(
  '/',
  authorize('ASHA', 'ANM', 'DOCTOR', 'SPECIALIST', 'SYSTEM_ADMIN'),
  createRequest
);

// GET /incoming — doctor/specialist live queue
router.get(
  '/incoming',
  authorize('DOCTOR', 'SPECIALIST', 'SYSTEM_ADMIN'),
  listIncoming
);

// GET /mine — requester's list
router.get('/mine', listMine);

// ── Single-resource routes ────────────────────────────────────────────────────

// GET /:id — fetch single request
router.get('/:id', getRequestById);

// PATCH /:id/accept — accept request
router.patch(
  '/:id/accept',
  authorize('DOCTOR', 'SPECIALIST', 'SYSTEM_ADMIN'),
  acceptRequest
);

// PATCH /:id/reject — decline request
router.patch(
  '/:id/reject',
  authorize('DOCTOR', 'SPECIALIST', 'SYSTEM_ADMIN'),
  rejectRequest
);

// PATCH /:id/cancel — cancel request
router.patch('/:id/cancel', cancelRequest);

// PATCH /:id/complete — mark call completed
router.patch(
  '/:id/complete',
  authorize('DOCTOR', 'SPECIALIST', 'SYSTEM_ADMIN'),
  completeRequest
);

module.exports = router;
