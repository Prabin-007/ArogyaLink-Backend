/**
 * src/middleware/errorHandler.js
 * -------------------------------
 * Global Error Handler Middleware
 *
 * This middleware catches any errors that are passed to next(err) from
 * route handlers or other middleware. It sits at the END of the middleware
 * chain in src/index.js.
 *
 * How it works:
 * - Express recognizes a middleware as an error handler because it has
 *   FOUR parameters: (err, req, res, next).
 * - In development: returns the full error stack trace to help with debugging.
 * - In production: hides internal stack traces for security.
 *
 * Usage in route handlers:
 *   try {
 *     // ... your code
 *   } catch (error) {
 *     next(error); // <-- passes error to this handler
 *   }
 */

const errorHandler = (err, req, res, next) => {
  // Log the error to the server console for debugging.
  // In production, you'd replace this with a proper logger (e.g., Winston).
  console.error('❌ Error:', err.message);
  console.error(err.stack);

  // Determine the HTTP status code.
  // If the error object has a statusCode property (e.g., set manually),
  // use it. Otherwise, fall back to 500 (Internal Server Error).
  const statusCode = err.statusCode || err.status || 500;

  // Build the base response object.
  const response = {
    success: false,
    message: err.message || 'Internal Server Error',
    error: err.message || 'Internal Server Error',
    timestamp: new Date().toISOString(),
  };

  // In development, attach the stack trace so developers can debug faster.
  // NEVER expose stack traces in production — it's a security risk.
  if (process.env.NODE_ENV === 'development') {
    response.stack = err.stack;
  }

  res.status(statusCode).json(response);
};

module.exports = errorHandler;
