/**
 * src/routes/auth.js
 * -------------------
 * Express router for authentication and user management endpoints.
 *
 * All routes are mounted under /api/auth in src/index.js.
 *
 * Route Summary:
 * ┌──────────────────┬────────────────────┬──────────────────────────────────────┐
 * │ Method + Path    │ Controller Function │ Auth Required                         │
 * ├──────────────────┼────────────────────┼──────────────────────────────────────┤
 * │ POST   /login    │ login              │ None (public endpoint)                │
 * │ GET    /me       │ getMe              │ authenticate (any valid JWT)          │
 * │ POST   /register │ createUser         │ authenticate + authorize(SYSTEM_ADMIN)│
 * └──────────────────┴────────────────────┴──────────────────────────────────────┘
 */

const express = require('express');
const router = express.Router();

// Middleware
const { authenticate, authorize, ROLES } = require('../middleware/auth');

// Controller functions
const {
  login,
  getMe,
  createUser,
} = require('../controllers/authController');

// ─── Routes ───────────────────────────────────────────────────────────────────

/**
 * POST /api/auth/login
 * Public endpoint — no authentication required.
 * Accepts { identifier, password, role } and returns a JWT token on success.
 */
router.post('/login', login);

/**
 * GET /api/auth/me
 * Returns the current user's profile from the database.
 * Requires a valid JWT in the Authorization header.
 */
router.get(
  '/me',
  authenticate,
  getMe
);

/**
 * POST /api/auth/register
 * Admin-only endpoint to create a new healthcare worker account.
 * Only SYSTEM_ADMIN can call this — regular users cannot self-register.
 *
 * Body: { name, phone, role, identifier, password }
 */
router.post(
  '/register',
  authenticate,
  authorize(ROLES.SYSTEM_ADMIN),
  createUser
);

module.exports = router;
