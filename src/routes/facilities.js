/**
 * src/routes/facilities.js
 * -------------------------
 * Mounted under /api/facilities in src/index.js.
 *
 * ┌──────────────────┬───────────────────┬────────────────────────┐
 * │ Method + Path    │ Controller        │ Allowed Roles          │
 * ├──────────────────┼───────────────────┼────────────────────────┤
 * │ GET  /           │ listFacilities    │ Any authenticated role │
 * └──────────────────┴───────────────────┴────────────────────────┘
 */

const express = require('express');
const router = express.Router();

const { authenticate } = require('../middleware/auth');
const { listFacilities } = require('../controllers/facilityController');

/**
 * GET /api/facilities
 * Optional query: ?district=Pune
 */
router.get('/', authenticate, listFacilities);

module.exports = router;
