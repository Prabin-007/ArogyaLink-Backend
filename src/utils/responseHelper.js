/**
 * src/utils/responseHelper.js
 * ----------------------------
 * Standardized API Response Helpers
 *
 * Using these helpers ensures every API response has a consistent
 * structure, making it much easier for frontend developers to handle
 * responses predictably.
 *
 * Standard Success Shape:
 * {
 *   success: true,
 *   message: "...",
 *   data: { ... },
 *   timestamp: "2026-09-19T..."
 * }
 *
 * Standard Error Shape:
 * {
 *   success: false,
 *   message: "...",
 *   error: "...",
 *   timestamp: "2026-09-19T..."
 * }
 */

/**
 * Sends a standardized success JSON response.
 *
 * @param {import('express').Response} res       - Express response object
 * @param {any}                        data       - The payload/data to return
 * @param {string}                     message    - A human-readable success message
 * @param {number}                     statusCode - HTTP status code (default: 200)
 *
 * @example
 * // In a route handler:
 * successResponse(res, { user }, 'User fetched successfully');
 */
const successResponse = (res, data = null, message = 'Success', statusCode = 200) => {
  return res.status(statusCode).json({
    success: true,
    message,
    data,
    timestamp: new Date().toISOString(),
  });
};

/**
 * Sends a standardized error JSON response.
 *
 * @param {import('express').Response} res        - Express response object
 * @param {string}                     message    - A human-readable error message
 * @param {number}                     statusCode - HTTP status code (default: 400)
 *
 * @example
 * // In a route handler:
 * errorResponse(res, 'User not found', 404);
 */
const errorResponse = (res, message = 'Something went wrong', statusCode = 400) => {
  return res.status(statusCode).json({
    success: false,
    message,
    error: message,
    timestamp: new Date().toISOString(),
  });
};

module.exports = { successResponse, errorResponse };
