/**
 * src/routes/facilities.js
 * ─────────────────────────
 * Express router for all facility-related API endpoints.
 * Mounted at /api/facilities in src/index.js.
 *
 * Person 4: Smart Referral AI – Facility Management Routes
 *
 * Route Summary:
 * ┌────────────────────────────────────────────┬──────────────────────────────────────┬──────────────────────────┐
 * │ Method + Path                              │ Controller Function                   │ Allowed Roles            │
 * ├────────────────────────────────────────────┼──────────────────────────────────────┼──────────────────────────┤
 * │ GET    /api/facilities                     │ listFacilities                        │ Any authenticated        │
 * │ POST   /api/facilities                     │ createFacility                        │ HOSPITAL_ADMIN, SYS_ADMIN│
 * │ POST   /api/facilities/recommend           │ getSmartReferralRecommendationOnly    │ DOCTOR, SPECIALIST       │
 * │ GET    /api/facilities/:id                 │ getFacility                           │ Any authenticated        │
 * │ PUT    /api/facilities/:id                 │ updateFacility                        │ HOSPITAL_ADMIN, SYS_ADMIN│
 * │ DELETE /api/facilities/:id                 │ deleteFacility                        │ SYSTEM_ADMIN             │
 * │ POST   /api/facilities/:id/services        │ upsertFacilityService                 │ HOSPITAL_ADMIN, SYS_ADMIN│
 * │ DELETE /api/facilities/:id/services/:name  │ deleteFacilityService                 │ HOSPITAL_ADMIN, SYS_ADMIN│
 * │ POST   /api/facilities/:id/specialists     │ upsertFacilitySpecialist              │ HOSPITAL_ADMIN, SYS_ADMIN│
 * │ DELETE /api/facilities/:id/specialists/:sp │ deleteFacilitySpecialist              │ HOSPITAL_ADMIN, SYS_ADMIN│
 * │ POST   /api/facilities/:id/resources       │ upsertFacilityResource                │ HOSPITAL_ADMIN, SYS_ADMIN│
 * │ DELETE /api/facilities/:id/resources/:name │ deleteFacilityResource                │ HOSPITAL_ADMIN, SYS_ADMIN│
 * └────────────────────────────────────────────┴──────────────────────────────────────┴──────────────────────────┘
 */

const express = require('express');
const router = express.Router();
const { authenticate, authorize } = require('../middleware/auth');
const fc = require('../controllers/facilityController');

// =============================================================================
// READ – Any authenticated user
// =============================================================================

/**
 * GET /api/facilities
 * List all facilities with optional query filters.
 *
 * @query type, district, state, operationalStatus, emergencyCapability
 */
router.get(
  '/',
  authenticate,
  fc.listFacilities
);

/**
 * POST /api/facilities/recommend
 * Preview facility recommendations WITHOUT creating a referral.
 * NOTE: This route must be registered BEFORE /:id to avoid "recommend" being
 * parsed as an ID.
 *
 * @body patientLatitude, patientLongitude, requiredService?, requiredSpecialist?,
 *       priority?, emergency?, requiredDiagnostics?
 */
router.post(
  '/recommend',
  authenticate,
  authorize('DOCTOR', 'SPECIALIST', 'HOSPITAL_ADMIN', 'SYSTEM_ADMIN'),
  fc.getSmartReferralRecommendationOnly
);

/**
 * GET /api/facilities/:id
 * Get full details for a single facility including services, specialists, resources.
 */
router.get(
  '/:id',
  authenticate,
  fc.getFacility
);

// =============================================================================
// CREATE – HOSPITAL_ADMIN or SYSTEM_ADMIN
// =============================================================================

/**
 * POST /api/facilities
 * Create a new healthcare facility.
 *
 * @body name, type, address, district, state, latitude, longitude,
 *       emergencyCapability?, waitingTimeMinutes?, phone?, operationalStatus?
 */
router.post(
  '/',
  authenticate,
  authorize('HOSPITAL_ADMIN', 'SYSTEM_ADMIN'),
  fc.createFacility
);

// =============================================================================
// UPDATE – HOSPITAL_ADMIN or SYSTEM_ADMIN
// =============================================================================

/**
 * PUT /api/facilities/:id
 * Update facility core fields.
 */
router.put(
  '/:id',
  authenticate,
  authorize('HOSPITAL_ADMIN', 'SYSTEM_ADMIN'),
  fc.updateFacility
);

// =============================================================================
// DELETE – SYSTEM_ADMIN only
// =============================================================================

/**
 * DELETE /api/facilities/:id
 * Permanently delete a facility (cascades to services, specialists, resources).
 */
router.delete(
  '/:id',
  authenticate,
  authorize('SYSTEM_ADMIN'),
  fc.deleteFacility
);

// =============================================================================
// SERVICES sub-resource
// =============================================================================

/**
 * POST /api/facilities/:id/services
 * Add or update a service for this facility (upsert).
 *
 * @body serviceName, available
 */
router.post(
  '/:id/services',
  authenticate,
  authorize('HOSPITAL_ADMIN', 'SYSTEM_ADMIN'),
  fc.upsertFacilityService
);

/**
 * DELETE /api/facilities/:id/services/:serviceName
 * Remove a service from this facility.
 */
router.delete(
  '/:id/services/:serviceName',
  authenticate,
  authorize('HOSPITAL_ADMIN', 'SYSTEM_ADMIN'),
  fc.deleteFacilityService
);

// =============================================================================
// SPECIALISTS sub-resource
// =============================================================================

/**
 * POST /api/facilities/:id/specialists
 * Add or update a specialist at this facility (upsert).
 *
 * @body specialization, available, doctorCount?
 */
router.post(
  '/:id/specialists',
  authenticate,
  authorize('HOSPITAL_ADMIN', 'SYSTEM_ADMIN'),
  fc.upsertFacilitySpecialist
);

/**
 * DELETE /api/facilities/:id/specialists/:specialization
 * Remove a specialist from this facility.
 */
router.delete(
  '/:id/specialists/:specialization',
  authenticate,
  authorize('HOSPITAL_ADMIN', 'SYSTEM_ADMIN'),
  fc.deleteFacilitySpecialist
);

// =============================================================================
// RESOURCES / DIAGNOSTICS sub-resource
// =============================================================================

/**
 * POST /api/facilities/:id/resources
 * Add or update a diagnostic/resource at this facility (upsert).
 *
 * @body resourceName, available, quantity?
 */
router.post(
  '/:id/resources',
  authenticate,
  authorize('HOSPITAL_ADMIN', 'SYSTEM_ADMIN'),
  fc.upsertFacilityResource
);

/**
 * DELETE /api/facilities/:id/resources/:resourceName
 * Remove a resource/diagnostic from this facility.
 */
router.delete(
  '/:id/resources/:resourceName',
  authenticate,
  authorize('HOSPITAL_ADMIN', 'SYSTEM_ADMIN'),
  fc.deleteFacilityResource
);

module.exports = router;
