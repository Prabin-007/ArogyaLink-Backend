/**
 * src/routes/teleconsultDoctorsRoutes.js
 * ----------------------------------------
 * Provides directory of doctors and specialists for teleconsultation requests.
 */

const express = require('express');
const { authenticate } = require('../middleware/auth');
const prisma = require('../config/db');
const { successResponse, errorResponse } = require('../utils/responseHelper');

const router = express.Router();

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
router.get('/', authenticate, async (req, res) => {
  try {
    const roleFilter = req.query.role;
    const validRoles = ['DOCTOR', 'SPECIALIST'];

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
