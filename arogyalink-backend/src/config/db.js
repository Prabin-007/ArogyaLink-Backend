/**
 * src/config/db.js
 * ----------------
 * Prisma Client Singleton
 *
 * Why a singleton?
 * In development, Node.js module hot-reloading (via nodemon) can cause
 * multiple Prisma Client instances to be created, which exhausts the
 * database connection pool. By storing the client on the global object,
 * we ensure only ONE instance exists at any time.
 *
 * In production, a fresh instance is created once and reused throughout
 * the app's lifetime.
 */

const { PrismaClient } = require('@prisma/client');

// Declare a variable to hold our single Prisma instance.
let prisma;

if (process.env.NODE_ENV === 'production') {
  // In production, simply create a new client.
  prisma = new PrismaClient();
} else {
  // In development, check if a client already exists on the global object.
  // `global` persists across hot-reloads, so this prevents duplicate instances.
  if (!global.__prisma) {
    global.__prisma = new PrismaClient({
      // Optional: log Prisma queries to the console for debugging.
      // Remove or change to ['error'] in production.
      log: ['query', 'info', 'warn', 'error'],
    });
  }
  prisma = global.__prisma;
}

module.exports = prisma;
