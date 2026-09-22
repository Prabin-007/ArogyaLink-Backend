/**
 * src/routes/sync.js
 * -------------------
 * Express router for offline data synchronization endpoints.
 *
 * All routes are mounted under /api/sync in src/index.js.
 *
 * These endpoints are exclusively for ASHA/ANM mobile workers who operate
 * offline and need to sync their local SQLite data with the central server.
 *
 * Route Summary:
 * ┌──────────────────┬──────────────────────┬──────────────────────┐
 * │ Method + Path    │ Controller Function   │ Allowed Roles        │
 * ├──────────────────┼──────────────────────┼──────────────────────┤
 * │ POST   /upload   │ uploadOfflineData     │ ASHA, ANM            │
 * │ GET    /download │ downloadUpdates       │ ASHA, ANM            │
 * └──────────────────┴──────────────────────┴──────────────────────┘
 */

const express = require('express');
const router = express.Router();

// Middleware
const { authenticate, authorize, ROLES } = require('../middleware/auth');

// Controller functions
const {
  uploadOfflineData,
  downloadUpdates,
} = require('../controllers/syncController');

// ─── Routes ───────────────────────────────────────────────────────────────────

/**
 * POST /api/sync/upload
 * Upload a batch of offline-created records to the central server.
 * Body: { deviceId, records: { patients, encounters, vitals, prescriptions, followups } }
 *
 * Returns a detailed sync result with per-record success/failure info.
 */
router.post(
  '/upload',
  authenticate,
  authorize(ROLES.ASHA, ROLES.ANM),
  uploadOfflineData
);

/**
 * GET /api/sync/download
 * Download records updated after a given timestamp for the worker's patients.
 * Query params: ?deviceId=X&lastSyncedAt=2026-09-01T00:00:00Z
 */
router.get(
  '/download',
  authenticate,
  authorize(ROLES.ASHA, ROLES.ANM),
  downloadUpdates
);

module.exports = router;
