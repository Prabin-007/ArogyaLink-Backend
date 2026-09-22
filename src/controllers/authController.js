/**
 * src/controllers/authController.js
 * ------------------------------------
 * Handles authentication and user management for the ArogyaLink system.
 *
 * Authentication flow:
 *   1. User sends { identifier, password, role } to POST /api/auth/login
 *   2. Server looks up the user by identifier + role (unique combination)
 *   3. Server compares the password against the bcrypt hash stored in the DB
 *   4. If valid, server signs a JWT and returns it along with safe user info
 *   5. Client stores the JWT and sends it as "Authorization: Bearer <token>"
 *
 * User Creation:
 *   Only SYSTEM_ADMIN can create new user accounts. Passwords are always
 *   hashed with bcrypt before storing — plain text passwords are never saved.
 *
 * ⚠️  IMPORTANT: Verify that this Prisma model name matches your schema exactly:
 *   prisma.user → model User
 *
 * ⚠️  IMPORTANT: Set JWT_SECRET in your .env file. Use a long random string.
 *   Never commit .env to version control.
 */

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const prisma = require('../config/db');
const { successResponse, errorResponse } = require('../utils/responseHelper');

// ─── Valid Roles ──────────────────────────────────────────────────────────────
// Must match the Role enum in the Prisma schema.
const VALID_ROLES = ['ASHA', 'ANM', 'DOCTOR', 'SPECIALIST', 'HOSPITAL_ADMIN', 'SYSTEM_ADMIN'];

// Number of bcrypt salt rounds — 10 is the industry-standard balance of
// security and performance. Higher = slower brute-force, slower server.
const BCRYPT_ROUNDS = 10;

// JWT expiry — tokens are valid for 7 days. Adjust to suit your security policy.
const JWT_EXPIRES_IN = '7d';

// =============================================================================
// login
// =============================================================================
/**
 * POST /api/auth/login
 * Authenticates a healthcare worker using their identifier, password, and role.
 *
 * Why identifier + role?
 * Different roles may share the same identifier format (e.g., "ASHA001" for
 * an ASHA and "ASHA001" for a Doctor at a different org). The combination
 * uniquely identifies the user.
 *
 * @requires Body: { identifier, password, role }
 * @returns { token, user: { id, name, role, identifier, phone } }
 */
const login = async (req, res, next) => {
  try {
    const { identifier, password, role } = req.body;

    // ── Validate required fields ──────────────────────────────────────────────
    if (!identifier || !password) {
      return errorResponse(res, 'identifier and password are required.', 400);
    }

    // ── Validate role value (if provided) ───────────────────────────────────────────────────
    if (role && !VALID_ROLES.includes(role)) {
      return errorResponse(
        res,
        `Invalid role "${role}". Valid roles: ${VALID_ROLES.join(', ')}`,
        400
      );
    }

    // ── Look up the user ─────────────────────────────────
    let user;
    if (role) {
      // If role is provided, search by both fields
      user = await prisma.user.findFirst({
        where: {
          identifier,
          role,
        },
      });
    } else {
      // If role is NOT provided, use findUnique since identifier is unique
      user = await prisma.user.findUnique({
        where: { identifier },
      });
    }

    // ── User not found → generic error (don't reveal whether identifier or password is wrong) ──
    if (!user) {
      return errorResponse(res, 'Invalid credentials. Please check your ID and password.', 401);
    }

    // ── Check if the account is active ───────────────────────────────────────
    if (!user.isActive) {
      return errorResponse(res, 'Your account has been deactivated. Contact the system admin.', 403);
    }

    // ── Compare submitted password with the stored bcrypt hash ────────────────
    const isPasswordValid = await bcrypt.compare(password, user.passwordHash);
    if (!isPasswordValid) {
      return errorResponse(res, 'Invalid credentials. Please check your password.', 401);
    }

    // ── Sign the JWT ──────────────────────────────────────────────────────────
    // The payload is intentionally minimal — only what's needed for auth checks.
    // DO NOT put sensitive data (like passwords or PII) in the JWT payload.
    const token = jwt.sign(
      {
        id: user.id,
        role: user.role,
        identifier: user.identifier,
      },
      process.env.JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );

    // ── Build safe user object (NEVER send passwordHash to the client) ────────
    const safeUser = {
      id: user.id,
      name: user.name,
      phone: user.phone,
      role: user.role,
      identifier: user.identifier,
      isActive: user.isActive,
      createdAt: user.createdAt,
    };

    return successResponse(
      res,
      { token, user: safeUser },
      `Welcome back, ${user.name}!`
    );
  } catch (error) {
    next(error);
  }
};

// =============================================================================
// getMe
// =============================================================================
/**
 * GET /api/auth/me
 * Returns the currently authenticated user's profile information.
 * The authenticate middleware has already verified the JWT and populated
 * req.user with { id, role, identifier }.
 *
 * This endpoint fetches the full user record from the database so the client
 * always gets fresh data (not just what's in the JWT, which may be stale).
 *
 * @requires Auth: Any authenticated user (authenticate middleware)
 */
const getMe = async (req, res, next) => {
  try {
    // req.user is set by the authenticate middleware
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      // Explicitly select fields — passwordHash must NEVER be returned
      select: {
        id: true,
        name: true,
        phone: true,
        role: true,
        identifier: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!user) {
      // This should rarely happen (user deleted after JWT was issued)
      return errorResponse(res, 'User account not found. Please log in again.', 404);
    }

    return successResponse(res, { user }, 'User profile fetched successfully.');
  } catch (error) {
    next(error);
  }
};

// =============================================================================
// createUser
// =============================================================================
/**
 * POST /api/auth/register
 * Admin-only endpoint to onboard a new healthcare worker into the system.
 * Only SYSTEM_ADMIN can call this — the authorization check is enforced
 * by the authorize('SYSTEM_ADMIN') middleware on the route.
 *
 * Why admin-only?
 * Healthcare workers cannot self-register. Accounts must be provisioned by
 * an admin to ensure proper role assignment and identifier verification.
 *
 * @requires Auth: authenticate + authorize('SYSTEM_ADMIN')
 * @requires Body: { name, phone, role, identifier, password }
 */
const createUser = async (req, res, next) => {
  try {
    const { name, phone, role, identifier, password } = req.body;

    // ── Validate required fields ──────────────────────────────────────────────
    if (!name || !phone || !role || !identifier || !password) {
      return errorResponse(
        res,
        'Missing required fields: name, phone, role, identifier, password',
        400
      );
    }

    // ── Validate role ─────────────────────────────────────────────────────────
    if (!VALID_ROLES.includes(role)) {
      return errorResponse(
        res,
        `Invalid role "${role}". Valid roles: ${VALID_ROLES.join(', ')}`,
        400
      );
    }

    // ── Validate password strength (basic) ───────────────────────────────────
    if (password.length < 8) {
      return errorResponse(res, 'Password must be at least 8 characters long.', 400);
    }

    // ── Check that the identifier is unique (across the entire users table) ───
    // identifier has a @unique constraint in the schema, but a friendly check
    // here gives the admin a clearer error message than a Prisma constraint error.
    const existing = await prisma.user.findUnique({ where: { identifier } });
    if (existing) {
      return errorResponse(
        res,
        `A user with identifier "${identifier}" already exists.`,
        409 // 409 Conflict
      );
    }

    // ── Hash the password ─────────────────────────────────────────────────────
    // NEVER store plain text passwords. bcrypt automatically adds a salt.
    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

    // ── Create the new user ───────────────────────────────────────────────────
    const newUser = await prisma.user.create({
      data: {
        name,
        phone,
        role,
        identifier,
        passwordHash, // Store the hash, not the plain text password
        isActive: true,
      },
      // Return only safe fields — passwordHash must never leave the server
      select: {
        id: true,
        name: true,
        phone: true,
        role: true,
        identifier: true,
        isActive: true,
        createdAt: true,
      },
    });

    return successResponse(
      res,
      { user: newUser },
      `User "${name}" created successfully with role ${role}.`,
      201
    );
  } catch (error) {
    next(error);
  }
};

module.exports = {
  login,
  getMe,
  createUser,
};
