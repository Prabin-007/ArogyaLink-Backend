/**
 * src/index.js
 * -------------
 * ArogyaLink Backend — Express Application Entry Point
 *
 * This file:
 *   1. Loads environment variables from .env
 *   2. Sets up all Express middleware (CORS, JSON parsing, HTTP logging)
 *   3. Mounts all API route files under the /api prefix
 *   4. Provides a health check endpoint
 *   5. Registers the global error handler
 *   6. Starts the HTTP server on the configured PORT
 */

// Load environment variables FIRST, before anything else.
// This makes process.env.DATABASE_URL, process.env.PORT, etc. available.
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const morgan = require('morgan');

// Internal imports
const errorHandler = require('./middleware/errorHandler');

// ─── App Initialization ────────────────────────────────────────────────────────
const app = express();
const PORT = process.env.PORT || 3001;

// ─── Core Middleware ───────────────────────────────────────────────────────────

/**
 * CORS (Cross-Origin Resource Sharing)
 * Allows the frontend (running on a different port/domain) to make API calls.
 * In production, replace the origin with your actual frontend domain.
 */
app.use(
  cors({
    origin: '*', // TODO: Lock this down to specific origins in production
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
);

/**
 * JSON Body Parser
 * Parses incoming requests with JSON payloads so we can access req.body.
 * The limit prevents large payload attacks.
 */
app.use(express.json({ limit: '10mb' }));

/**
 * Morgan HTTP Logger
 * Logs every incoming request to the console.
 * 'dev' format: "GET /api/users 200 12.34 ms - 512"
 * Only log in non-test environments to keep test output clean.
 */
if (process.env.NODE_ENV !== 'test') {
  app.use(morgan('dev'));
}

// ─── Health Check Endpoint ─────────────────────────────────────────────────────
/**
 * GET /health
 * A simple endpoint to verify the server is running.
 * Used by load balancers, Docker health checks, and monitoring tools.
 */
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    timestamp: new Date(),
    environment: process.env.NODE_ENV || 'development',
    version: require('../package.json').version,
  });
});

// ─── API Routes ────────────────────────────────────────────────────────────────
/**
 * All application routes are mounted under /api.
 * Add new route files here as you build out features.
 *
 * Example:
 *   const userRoutes = require('./routes/users');
 *   app.use('/api/users', userRoutes);
 *
 * Current routes: (add as you build them)
 */
// ── Authentication & User Management ──────────────────────────────────────────
const authRoutes = require('./routes/auth');
app.use('/api/auth', authRoutes);
app.use('/auth',     authRoutes);

// ── Patient Records, Encounters, Vitals, Prescriptions ────────────────────────
const patientRoutes = require('./routes/patients');
const encounterRoutes = require('./routes/encounters');
const vitalsRoutes = require('./routes/vitals');
const prescriptionRoutes = require('./routes/prescriptions');

app.use('/api/patients',      patientRoutes);
app.use('/patients',          patientRoutes);
app.use('/api/encounters',    encounterRoutes);
app.use('/encounters',        encounterRoutes);
app.use('/api/vitals',        vitalsRoutes);
app.use('/vitals',            vitalsRoutes);
app.use('/api/prescriptions', prescriptionRoutes);
app.use('/prescriptions',     prescriptionRoutes);

// ── Referral Tracking ──────────────────────────────────────────────────────────
const referralRoutes = require('./routes/referrals');
app.use('/api/referrals',     referralRoutes);
app.use('/referrals',         referralRoutes);

// ── Follow-Up Management ───────────────────────────────────────────────────────
const followupRoutes = require('./routes/followups');
app.use('/api/followups',     followupRoutes);
app.use('/followups',         followupRoutes);

// ── Facility Reference List ────────────────────────────────────────────────────
const facilityRoutes = require('./routes/facilities');
app.use('/api/facilities',   facilityRoutes);
app.use('/facilities',       facilityRoutes);

// ── Medicines & Medicine Availability ─────────────────────────────────────────
app.use('/api/medicines',    require('./routes/medicines'));
app.use('/api/services',     require('./routes/services'));

// ── Diagnostic Availability ─────────────────────────────────────────
app.use('/api/diagnostics', require('./routes/diagnostics'));

// ── Notification followup ─────────────────────────────────────────
app.use('/api/notifications', require('./routes/notifications'));

// ── Resource Availability ─────────────────────────────────────────
app.use('/api/resources', require('./routes/resources'));


// ── Offline Data Synchronization ───────────────────────────────────────────────
const syncRoutes = require('./routes/sync');
app.use('/api/sync',          syncRoutes);
app.use('/sync',              syncRoutes);

// ─── 404 Handler ──────────────────────────────────────────────────────────────
/**
 * Catches any request to a route that doesn't exist.
 * This must come AFTER all route definitions.
 */
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: `Route not found: ${req.method} ${req.originalUrl}`,
    timestamp: new Date().toISOString(),
  });
});

// ─── Global Error Handler ─────────────────────────────────────────────────────
/**
 * Catches any errors thrown by route handlers via next(err).
 * IMPORTANT: This MUST be the LAST middleware registered.
 * Express identifies error handlers by their 4-parameter signature.
 */
app.use(errorHandler);

// ─── Start Server ─────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log('');
  console.log('🚀 ArogyaLink Backend Server is running!');
  console.log(`📡 URL:         http://localhost:${PORT}`);
  console.log(`❤️  Health:      http://localhost:${PORT}/health`);
  console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🔐 Auth:        ${process.env.AUTH_ENABLED === 'true' ? 'ENABLED' : 'DISABLED (dev mode)'}`);
  console.log('');

  // In dev mode, ensure a dev-user exists in the database so foreign key relations succeed
  if (process.env.AUTH_ENABLED === 'false') {
    const prisma = require('./config/db');
    prisma.user.upsert({
      where: { identifier: 'dev@arogyalink.local' },
      update: {},
      create: {
        id: 'dev-user',
        name: 'Dev Administrator',
        phone: '9999999999',
        role: 'SYSTEM_ADMIN',
        identifier: 'dev@arogyalink.local',
        passwordHash: 'dummy',
        isActive: true,
      },
    }).catch(err => console.warn('[Dev Seed] Warning:', err.message));
  }
});

// Export app for testing (e.g., with Jest + Supertest)
module.exports = app;
