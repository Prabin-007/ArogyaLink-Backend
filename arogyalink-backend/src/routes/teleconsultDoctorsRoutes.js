/**
 * src/routes/teleconsultDoctorsRoutes.js
 * ----------------------------------------
 * Provides a directory of doctors and specialists for the teleconsultation
 * request UI — so the requester (ASHA/ANM/PHC Doctor) can pick who to call.
 *
 * GET /api/teleconsult-doctors          — list all DOCTOR + SPECIALIST users
 * GET /api/teleconsult-doctors/:id      — single doctor/specialist profile
 *
 * Only non-sensitive fields are returned (no passwordHash, no internal ids
 * beyond the id needed to create a request).
 */

const express = require('express');
const { authenticate } = require('../middleware/auth');
const prisma = require('../config/db');
const { successResponse, errorResponse } = require('../utils/responseHelper');

const router = express.Router();

// Fields safe to expose to any authenticated user browsing the doctor directory.
const SAFE_FIELDS = {
  id:         true,
  name:       true,
  phone:      true,
  role:       true,
  identifier: true,
  isActive:   true,
  createdAt:  true,
};

// ── GET /api/teleconsult-doctors ─────────────────────────────────────────────
/**
 * Returns all active doctors and specialists.
 * Supports optional ?role=DOCTOR or ?role=SPECIALIST filter.
 */
router.get('/', async (req, res) => {
  try {
    const roleFilter = req.query.role;
    const validRoles = ['DOCTOR', 'SPECIALIST'];

    // Build the where clause — default to both DOCTOR and SPECIALIST.
    const where = {
      isActive: true,
      role: roleFilter && validRoles.includes(roleFilter)
        ? roleFilter
        : { in: validRoles },
    };

    const doctors = await prisma.user.findMany({
      where,
      select: SAFE_FIELDS,
      orderBy: { name: 'asc' },
    });

    return successResponse(res, { doctors }, 'Available doctors and specialists fetched', 200);
  } catch (err) {
    console.error('[TeleconsultDoctors] list error:', err.message);
    return errorResponse(res, 'Could not fetch doctors', 500);
  }
});

// ── GET /api/teleconsult-doctors/:id ─────────────────────────────────────────
/**
 * Returns the profile of a single doctor or specialist by id.
 */
router.get('/:id', authenticate, async (req, res) => {
  try {
    const doctor = await prisma.user.findFirst({
      where: { id: req.params.id, role: { in: ['DOCTOR', 'SPECIALIST'] }, isActive: true },
      select: SAFE_FIELDS,
    });

    if (!doctor) return errorResponse(res, 'Doctor or Specialist not found', 404);

    return successResponse(res, { doctor }, 'Doctor profile fetched', 200);
  } catch (err) {
    console.error('[TeleconsultDoctors] getById error:', err.message);
    return errorResponse(res, 'Could not fetch doctor profile', 500);
  }
});

module.exports = router;
