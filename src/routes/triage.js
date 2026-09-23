const express = require('express');

const { authenticate, authorize } = require('../middleware/auth');

const {
  assessEncounterTriage,
  assessAndRefer,
} = require('../controllers/triageController');

const router = express.Router();

// All triage routes require authentication
router.use(authenticate);

// POST /api/triage/:encounterId
// Run triage assessment only.
router.post(
  '/:encounterId',
  authorize('DOCTOR', 'SPECIALIST', 'SYSTEM_ADMIN'),
  assessEncounterTriage
);

// POST /api/triage/:encounterId/refer
// Run triage + create smart referral for HIGH/EMERGENCY.
router.post(
  '/:encounterId/refer',
  authorize('DOCTOR', 'SPECIALIST', 'SYSTEM_ADMIN'),
  assessAndRefer
);

module.exports = router;