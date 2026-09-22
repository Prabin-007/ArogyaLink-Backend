/**
 * src/routes/services.js
 * ----------------------
 * Service availability routes.
 */

const express = require('express');
const { authenticate, authorize } = require('../middleware/auth');

const {
  createService,
  getServices,
  updateServiceAvailability,
  getServiceAvailability,
} = require('../controllers/serviceController');

const router = express.Router();

router.use(authenticate);

router.post(
  '/',
  authorize('SYSTEM_ADMIN', 'HOSPITAL_ADMIN'),
  createService
);

router.get('/', getServices);

router.post(
  '/availability',
  authorize('SYSTEM_ADMIN', 'HOSPITAL_ADMIN'),
  updateServiceAvailability
);

router.get('/:id/availability', getServiceAvailability);

module.exports = router;
