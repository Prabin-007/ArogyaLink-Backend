const express = require('express');

const { authenticate, authorize, ROLES } = require('../middleware/auth');

const {
  assessEncounterTriage,
  assessAndRefer,
} = require('../controllers/triageController');

const router = express.Router();

// All triage routes require authentication
router.use(authenticate);

// POST /api/triage/:encounterId
// Run triage assessment only (Doctors, Specialists, Admins, ASHAs, and ANMs)
router.post(
  '/:encounterId',
  authorize(
    ROLES.DOCTOR,
    ROLES.SPECIALIST,
    ROLES.SYSTEM_ADMIN,
    ROLES.ASHA,
    ROLES.ANM
  ),
  assessEncounterTriage
);

// POST /api/triage/:encounterId/refer
// Run triage + create smart referral for HIGH/EMERGENCY.
router.post(
  '/:encounterId/refer',
  authorize(
    ROLES.DOCTOR,
    ROLES.SPECIALIST,
    ROLES.SYSTEM_ADMIN
  ),
  assessAndRefer
);

module.exports = router;