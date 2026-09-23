/**
 * src/routes/medicines.js
 * -----------------------
 * Medicine Routes — ArogyaLink Person 6
 *
 * All routes require JWT authentication.
 */

const express = require('express');

const { authenticate, authorize } = require('../middleware/auth');

const {
  createMedicine,
  getMedicines,
  getMedicine,
  updateMedicineInventory,
  getMedicineAvailability,
} = require('../controllers/medicineController');

const router = express.Router();

// =============================================================================
// AUTHENTICATION
// =============================================================================

router.use(authenticate);

// =============================================================================
// CREATE MEDICINE
// POST /api/medicines
// =============================================================================

// Medicine master data should normally be managed by administrators.
router.post(
  '/',
  authorize('SYSTEM_ADMIN', 'HOSPITAL_ADMIN'),
  createMedicine
);

// =============================================================================
// GET ALL MEDICINES
// GET /api/medicines
// =============================================================================

router.get(
  '/',
  getMedicines
);

// =============================================================================
// UPDATE MEDICINE INVENTORY
// POST /api/medicines/inventory
// =============================================================================

// Facility/admin staff can update stock.
router.post(
  '/inventory',
  authorize('SYSTEM_ADMIN', 'HOSPITAL_ADMIN'),
  updateMedicineInventory
);

// =============================================================================
// GET MEDICINE AVAILABILITY
// GET /api/medicines/:id/availability
// =============================================================================

router.get(
  '/:id/availability',
  getMedicineAvailability
);

// =============================================================================
// GET SINGLE MEDICINE
// GET /api/medicines/:id
// =============================================================================

router.get(
  '/:id',
  getMedicine
);

module.exports = router;