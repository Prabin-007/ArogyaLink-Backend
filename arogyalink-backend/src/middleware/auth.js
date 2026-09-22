// /**
//  * src/middleware/auth.js
//  * ----------------------
//  * JWT Authentication & Role-Based Authorization Middleware
//  *
//  * This file exports two middleware functions:
//  *
//  * 1. `authenticate` - Verifies the JWT token from the Authorization header.
//  *    - If AUTH_ENABLED=false (dev mode), it skips verification and sets a
//  *      fake admin user so you can test routes without a real token.
//  *    - If AUTH_ENABLED=true, it reads "Authorization: Bearer <token>",
//  *      verifies it against JWT_SECRET, and attaches the decoded user
//  *      payload to `req.user`.
//  *
//  * 2. `authorize(...roles)` - A factory function that returns middleware
//  *    checking if `req.user.role` is one of the allowed roles.
//  *    Must be used AFTER `authenticate`.
//  *
//  * Available Roles in ArogyaLink:
//  *   ASHA | ANM | DOCTOR | SPECIALIST | HOSPITAL_ADMIN | SYSTEM_ADMIN
//  *
//  * Usage in a route file:
//  *   const { authenticate, authorize } = require('../middleware/auth');
//  *
//  *   // Only authenticated users:
//  *   router.get('/profile', authenticate, profileController.getProfile);
//  *
//  *   // Only doctors and specialists:
//  *   router.post('/prescribe', authenticate, authorize('DOCTOR', 'SPECIALIST'), ...);
//  */

// const jwt = require('jsonwebtoken');

// // ─── Role Constants ───────────────────────────────────────────────────────────
// // All valid roles in the ArogyaLink system.
// const ROLES = {
//   ASHA: 'ASHA',
//   ANM: 'ANM',
//   DOCTOR: 'DOCTOR',
//   SPECIALIST: 'SPECIALIST',
//   HOSPITAL_ADMIN: 'HOSPITAL_ADMIN',
//   SYSTEM_ADMIN: 'SYSTEM_ADMIN',
// };

// // ─── authenticate ─────────────────────────────────────────────────────────────
// /**
//  * Middleware: Verifies the JWT token and attaches user info to req.user.
//  *
//  * req.user shape after successful authentication:
//  * {
//  *   id:         string  — The user's unique database ID
//  *   role:       string  — One of the ROLES constants above
//  *   identifier: string  — Username, phone number, or email (depends on role)
//  * }
//  */
// const authenticate = (req, res, next) => {
//   // ── Dev Bypass ──────────────────────────────────────────────────────────────
//   // If AUTH_ENABLED is 'false' (string), skip JWT check entirely.
//   // This makes local development and API testing much faster.
//   if (process.env.AUTH_ENABLED === 'false') {
//     console.warn(
//       '⚠️  [Auth] AUTH_ENABLED=false — Skipping JWT verification. Using dev admin user.'
//     );
//     // Attach a fake "dev" user with SYSTEM_ADMIN role so all route guards pass.
//     req.user = {
//       id: 'dev-user',
//       role: ROLES.SYSTEM_ADMIN,
//       identifier: 'dev@arogyalink.local',
//     };
//     return next(); // Skip the rest of this middleware.
//   }

//   // ── Production / Staging Auth ────────────────────────────────────────────────
//   // Read the Authorization header. Expected format: "Bearer <token>"
//   const authHeader = req.headers['authorization'];

//   // Check that the header exists and starts with "Bearer ".
//   if (!authHeader || !authHeader.startsWith('Bearer ')) {
//     return res.status(401).json({
//       success: false,
//       message: 'Access denied. No token provided. Use "Authorization: Bearer <token>".',
//       timestamp: new Date().toISOString(),
//     });
//   }

//   // Extract just the token part (everything after "Bearer ").
//   const token = authHeader.split(' ')[1];

//   try {
//     // Verify the token using our secret key.
//     // If it's invalid or expired, jwt.verify() will throw an error.
//     const decoded = jwt.verify(token, process.env.JWT_SECRET);

//     // Attach the decoded payload to the request object.
//     // The payload should have been set when the token was created during login.
//     req.user = {
//       id: decoded.id,
//       role: decoded.role,
//       identifier: decoded.identifier,
//     };

//     next(); // Token is valid — continue to the route handler.
//   } catch (error) {
//     // Handle specific JWT errors with friendly messages.
//     if (error.name === 'TokenExpiredError') {
//       return res.status(401).json({
//         success: false,
//         message: 'Token has expired. Please log in again.',
//         timestamp: new Date().toISOString(),
//       });
//     }

//     // For any other JWT error (malformed, invalid signature, etc.)
//     return res.status(401).json({
//       success: false,
//       message: 'Invalid token. Authentication failed.',
//       timestamp: new Date().toISOString(),
//     });
//   }
// };

// // ─── authorize ────────────────────────────────────────────────────────────────
// /**
//  * Middleware Factory: Checks that the authenticated user has one of the
//  * allowed roles. Must be placed AFTER the `authenticate` middleware.
//  *
//  * @param {...string} roles - One or more role strings from the ROLES constant.
//  * @returns {Function} Express middleware function.
//  *
//  * @example
//  * // Allow only DOCTOR and SPECIALIST:
//  * router.post('/prescriptions', authenticate, authorize('DOCTOR', 'SPECIALIST'), handler);
//  */
// const authorize = (...roles) => {
//   return (req, res, next) => {
//     // ── Dev Bypass ──────────────────────────────────────────────────────────
//     // When AUTH_ENABLED=false, skip role checks entirely.
//     // This lets you test any endpoint during development without worrying about roles.
//     if (process.env.AUTH_ENABLED === 'false') {
//       return next();
//     }

//     // req.user must exist — authenticate should have been called first.
//     if (!req.user) {
//       return res.status(401).json({
//         success: false,
//         message: 'Not authenticated. Please use the authenticate middleware first.',
//         timestamp: new Date().toISOString(),
//       });
//     }

//     // Check if the user's role is in the list of allowed roles.
//     if (!roles.includes(req.user.role)) {
//       return res.status(403).json({
//         success: false,
//         message: `Access forbidden. Required role(s): ${roles.join(', ')}. Your role: ${req.user.role}.`,
//         timestamp: new Date().toISOString(),
//       });
//     }

//     // Role is allowed — continue.
//     next();
//   };
// };

// module.exports = { authenticate, authorize, ROLES };





/**
 * src/middleware/auth.js
 * ----------------------
 * JWT Authentication & Role-Based Authorization Middleware
 *
 * This file exports two middleware functions:
 *
 * 1. `authenticate` - Verifies the JWT token from the Authorization header.
 *    - If AUTH_ENABLED=false (dev mode), it skips verification and sets a
 *      fake admin user so you can test routes without a real token.
 *    - If AUTH_ENABLED=true, it reads "Authorization: Bearer <token>",
 *      verifies it against JWT_SECRET, and attaches the decoded user
 *      payload to `req.user`.
 *
 * 2. `authorize(...roles)` - A factory function that returns middleware
 *    checking if `req.user.role` is one of the allowed roles.
 *    Must be used AFTER `authenticate`.
 *
 * Available Roles in ArogyaLink:
 *   ASHA | ANM | DOCTOR | SPECIALIST | HOSPITAL_ADMIN | SYSTEM_ADMIN
 *
 * Usage in a route file:
 *   const { authenticate, authorize } = require('../middleware/auth');
 *
 *   // Only authenticated users:
 *   router.get('/profile', authenticate, profileController.getProfile);
 *
 *   // Only doctors and specialists:
 *   router.post('/prescribe', authenticate, authorize('DOCTOR', 'SPECIALIST'), ...);
 */

const jwt = require('jsonwebtoken');

// ─── Role Constants ───────────────────────────────────────────────────────────
// All valid roles in the ArogyaLink system.
const ROLES = {
  ASHA: 'ASHA',
  ANM: 'ANM',
  DOCTOR: 'DOCTOR',
  SPECIALIST: 'SPECIALIST',
  HOSPITAL_ADMIN: 'HOSPITAL_ADMIN',
  SYSTEM_ADMIN: 'SYSTEM_ADMIN',
};

// ─── authenticate ─────────────────────────────────────────────────────────────
/**
 * Middleware: Verifies the JWT token and attaches user info to req.user.
 *
 * req.user shape after successful authentication:
 * {
 *   id:         string  — The user's unique database ID
 *   role:       string  — One of the ROLES constants above
 *   identifier: string  — Username, phone number, or email (depends on role)
 * }
 */
const authenticate = (req, res, next) => {
  // ── Dev Bypass ──────────────────────────────────────────────────────────────
  // If AUTH_ENABLED is 'false' (string), we don't *require* a valid token —
  // but if the client already sent one (the frontend always does, once a user
  // has logged in via POST /api/auth/login), we still decode it and use the
  // real user. This matters because business logic elsewhere (e.g. matching
  // a doctor's incoming teleconsultation queue by doctorId) depends on
  // req.user.id being the *real* logged-in user, not a shared placeholder.
  // Only requests with no token at all (quick curl/Postman testing) fall back
  // to the fake admin user.
  if (process.env.AUTH_ENABLED === 'false') {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.startsWith('Bearer ')
      ? authHeader.split(' ')[1]
      : null;

    if (token) {
      try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.user = {
          id: decoded.id,
          role: decoded.role,
          identifier: decoded.identifier,
        };
        return next();
      } catch (error) {
        // Invalid/expired token even in dev mode — fall through to the fake
        // admin below rather than blocking the request, since AUTH_ENABLED=false
        // means we still don't want to hard-fail here.
        console.warn('⚠️  [Auth] AUTH_ENABLED=false — token present but invalid, using dev admin user.');
      }
    } else {
      console.warn(
        '⚠️  [Auth] AUTH_ENABLED=false — no token provided, using dev admin user.'
      );
    }

    // Attach a fake "dev" user with SYSTEM_ADMIN role so all route guards pass.
    req.user = {
      id: 'dev-user',
      role: ROLES.SYSTEM_ADMIN,
      identifier: 'dev@arogyalink.local',
    };
    return next(); // Skip the rest of this middleware.
  }

  // ── Production / Staging Auth ────────────────────────────────────────────────
  // Read the Authorization header. Expected format: "Bearer <token>"
  const authHeader = req.headers['authorization'];

  // Check that the header exists and starts with "Bearer ".
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      success: false,
      message: 'Access denied. No token provided. Use "Authorization: Bearer <token>".',
      timestamp: new Date().toISOString(),
    });
  }

  // Extract just the token part (everything after "Bearer ").
  const token = authHeader.split(' ')[1];

  try {
    // Verify the token using our secret key.
    // If it's invalid or expired, jwt.verify() will throw an error.
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Attach the decoded payload to the request object.
    // The payload should have been set when the token was created during login.
    req.user = {
      id: decoded.id,
      role: decoded.role,
      identifier: decoded.identifier,
    };

    next(); // Token is valid — continue to the route handler.
  } catch (error) {
    // Handle specific JWT errors with friendly messages.
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        message: 'Token has expired. Please log in again.',
        timestamp: new Date().toISOString(),
      });
    }

    // For any other JWT error (malformed, invalid signature, etc.)
    return res.status(401).json({
      success: false,
      message: 'Invalid token. Authentication failed.',
      timestamp: new Date().toISOString(),
    });
  }
};

// ─── authorize ────────────────────────────────────────────────────────────────
/**
 * Middleware Factory: Checks that the authenticated user has one of the
 * allowed roles. Must be placed AFTER the `authenticate` middleware.
 *
 * @param {...string} roles - One or more role strings from the ROLES constant.
 * @returns {Function} Express middleware function.
 *
 * @example
 * // Allow only DOCTOR and SPECIALIST:
 * router.post('/prescriptions', authenticate, authorize('DOCTOR', 'SPECIALIST'), handler);
 */
const authorize = (...roles) => {
  return (req, res, next) => {
    // ── Dev Bypass ──────────────────────────────────────────────────────────
    // When AUTH_ENABLED=false, skip role checks entirely.
    // This lets you test any endpoint during development without worrying about roles.
    if (process.env.AUTH_ENABLED === 'false') {
      return next();
    }

    // req.user must exist — authenticate should have been called first.
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Not authenticated. Please use the authenticate middleware first.',
        timestamp: new Date().toISOString(),
      });
    }

    // Check if the user's role is in the list of allowed roles.
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: `Access forbidden. Required role(s): ${roles.join(', ')}. Your role: ${req.user.role}.`,
        timestamp: new Date().toISOString(),
      });
    }

    // Role is allowed — continue.
    next();
  };
};

module.exports = { authenticate, authorize, ROLES };
