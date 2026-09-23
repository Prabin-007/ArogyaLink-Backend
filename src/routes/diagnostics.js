const express = require('express');
const { authenticate, authorize } = require('../middleware/auth');

const {
  createDiagnosticTest,
  getDiagnosticTests,
  getDiagnosticAvailability,
  updateDiagnosticAvailability,
} = require('../controllers/diagnosticController');

const router = express.Router();

router.use(authenticate);

router.post(
  '/',
  authorize('SYSTEM_ADMIN', 'HOSPITAL_ADMIN'),
  createDiagnosticTest
);

router.get('/', getDiagnosticTests);

router.post(
  '/availability',
  authorize('SYSTEM_ADMIN', 'HOSPITAL_ADMIN'),
  updateDiagnosticAvailability
);

router.get('/:id/availability', getDiagnosticAvailability);

module.exports = router;