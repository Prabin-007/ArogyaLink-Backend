/**
 * src/controllers/syncController.js
 * ------------------------------------
 * Handles data synchronization between the ASHA worker's offline SQLite
 * database and the central PostgreSQL server.
 *
 * Why sync?
 * ASHA workers operate in villages with poor internet. They create records
 * offline (patients, encounters, vitals, etc.) and sync when connectivity
 * returns. This controller handles both directions:
 *   - Upload  → ASHA sends locally created / updated records to the server.
 *   - Download → ASHA fetches server updates for their assigned patients.
 *
 * Key Design Decisions:
 *   - Per-record error tolerance: if one record fails, others still sync.
 *   - Deduplication via `syncId` on patients (UUID set by the mobile app).
 *   - `server_id` in uploaded records means "I already have a server ID, update me".
 *   - If no `server_id`, treat as a new record to create.
 *
 * ⚠️  IMPORTANT: Verify that these Prisma model names match your schema exactly:
 *   prisma.patient       → model Patient
 *   prisma.encounter     → model Encounter
 *   prisma.vitals        → model Vitals
 *   prisma.prescription  → model Prescription
 *   prisma.followUp      → model FollowUp
 */

const prisma = require('../config/db');
const { successResponse, errorResponse } = require('../utils/responseHelper');

// =============================================================================
// uploadOfflineData
// =============================================================================
/**
 * POST /api/sync/upload
 * Accepts a batch of offline records from a device and upserts them into the
 * central PostgreSQL database. Processes each record type independently so a
 * failure in one record does not block the rest.
 *
 * @requires Body: {
 *   deviceId: string,                    — Identifies which device is syncing
 *   records: {
 *     patients:      Array<PatientRecord>,
 *     encounters:    Array<EncounterRecord>,
 *     vitals:        Array<VitalsRecord>,
 *     prescriptions: Array<PrescriptionRecord>,
 *     followups:     Array<FollowUpRecord>
 *   }
 * }
 * @requires Auth: ASHA or ANM
 */
const uploadOfflineData = async (req, res, next) => {
  try {
    const { deviceId, records } = req.body;

    // ── Validate request body ─────────────────────────────────────────────────
    if (!deviceId) {
      return errorResponse(res, 'deviceId is required.', 400);
    }
    if (!records || typeof records !== 'object') {
      return errorResponse(res, 'records object is required.', 400);
    }

    // Destructure with safe defaults so we never crash if a type is missing
    const {
      patients = [],
      encounters = [],
      vitals = [],
      prescriptions = [],
      followups = [],
    } = records;

    // ── Tracking counters and error collector ─────────────────────────────────
    const synced = {
      patients: 0,
      encounters: 0,
      vitals: 0,
      prescriptions: 0,
      followups: 0,
    };
    const errors = []; // Collects per-record errors without halting the batch

    // ── Helper: add a structured error to the errors list ─────────────────────
    const recordError = (type, index, identifier, message) => {
      errors.push({ type, index, identifier, message });
    };

    // =========================================================================
    // Process PATIENTS
    // =========================================================================
    for (let i = 0; i < patients.length; i++) {
      const record = patients[i];
      try {
        if (!record.name || !record.assignedAshaId) {
          recordError('patient', i, record.syncId || record.server_id, 'Missing required fields: name, assignedAshaId');
          continue;
        }

        if (record.server_id) {
          // Record already exists on the server — update it
          await prisma.patient.update({
            where: { id: record.server_id },
            data: {
              name: record.name,
              phone: record.phone,
              address: record.address,
              village: record.village,
              district: record.district,
              state: record.state,
              // Note: dateOfBirth and gender are typically not changed after registration
            },
          });
        } else {
          // Check for duplicate via syncId (the UUID the mobile app generates)
          // syncId prevents creating the same patient twice if the upload is retried.
          if (record.syncId) {
            const existing = await prisma.patient.findUnique({
              where: { syncId: record.syncId },
            });
            if (existing) {
              // Already synced — skip silently (not an error, just a duplicate upload)
              synced.patients++;
              continue;
            }
          }

          // Create a brand-new patient record
          await prisma.patient.create({
            data: {
              name: record.name,
              dateOfBirth: new Date(record.dateOfBirth),
              gender: record.gender,
              phone: record.phone || null,
              address: record.address || null,
              village: record.village,
              district: record.district,
              state: record.state,
              assignedAshaId: record.assignedAshaId,
              syncId: record.syncId || null,
            },
          });
        }
        synced.patients++;
      } catch (err) {
        // One patient failing should NOT block others from being processed
        recordError('patient', i, record.syncId || record.server_id, err.message);
      }
    }

    // =========================================================================
    // Process ENCOUNTERS
    // =========================================================================
    for (let i = 0; i < encounters.length; i++) {
      const record = encounters[i];
      try {
        if (!record.patientId || !record.doctorId || !record.encounterType) {
          recordError('encounter', i, record.server_id, 'Missing required fields: patientId, doctorId, encounterType');
          continue;
        }

        if (record.server_id) {
          // Update existing encounter — only safe fields (notes, symptoms)
          await prisma.encounter.update({
            where: { id: record.server_id },
            data: {
              clinicalNotes: record.clinicalNotes,
              symptoms: record.symptoms || [],
            },
          });
        } else {
          await prisma.encounter.create({
            data: {
              patientId: record.patientId,
              doctorId: record.doctorId,
              facilityId: record.facilityId,
              encounterType: record.encounterType,
              symptoms: record.symptoms || [],
              clinicalNotes: record.clinicalNotes || null,
              encounterDate: new Date(record.encounterDate || Date.now()),
            },
          });
        }
        synced.encounters++;
      } catch (err) {
        recordError('encounter', i, record.server_id, err.message);
      }
    }

    // =========================================================================
    // Process VITALS
    // =========================================================================
    for (let i = 0; i < vitals.length; i++) {
      const record = vitals[i];
      try {
        if (!record.patientId || !record.recordedById) {
          recordError('vitals', i, record.server_id, 'Missing required fields: patientId, recordedById');
          continue;
        }

        if (record.server_id) {
          await prisma.vitals.update({
            where: { id: record.server_id },
            data: {
              temperature: record.temperature,
              heartRate: record.heartRate,
              bpSystolic: record.bpSystolic,
              bpDiastolic: record.bpDiastolic,
              oxygenSaturation: record.oxygenSaturation,
              weight: record.weight,
            },
          });
        } else {
          await prisma.vitals.create({
            data: {
              patientId: record.patientId,
              encounterId: record.encounterId || null,
              temperature: record.temperature || null,
              heartRate: record.heartRate || null,
              bpSystolic: record.bpSystolic || null,
              bpDiastolic: record.bpDiastolic || null,
              oxygenSaturation: record.oxygenSaturation || null,
              weight: record.weight || null,
              recordedById: record.recordedById,
            },
          });
        }
        synced.vitals++;
      } catch (err) {
        recordError('vitals', i, record.server_id, err.message);
      }
    }

    // =========================================================================
    // Process PRESCRIPTIONS
    // =========================================================================
    for (let i = 0; i < prescriptions.length; i++) {
      const record = prescriptions[i];
      try {
        if (!record.patientId || !record.encounterId || !record.doctorId || !record.medicineDetails) {
          recordError('prescription', i, record.server_id, 'Missing required fields: patientId, encounterId, doctorId, medicineDetails');
          continue;
        }

        if (record.server_id) {
          await prisma.prescription.update({
            where: { id: record.server_id },
            data: {
              medicineDetails: record.medicineDetails,
              instructions: record.instructions,
            },
          });
        } else {
          await prisma.prescription.create({
            data: {
              patientId: record.patientId,
              encounterId: record.encounterId,
              doctorId: record.doctorId,
              medicineDetails: record.medicineDetails,
              instructions: record.instructions || null,
            },
          });
        }
        synced.prescriptions++;
      } catch (err) {
        recordError('prescription', i, record.server_id, err.message);
      }
    }

    // =========================================================================
    // Process FOLLOW-UPS
    // =========================================================================
    for (let i = 0; i < followups.length; i++) {
      const record = followups[i];
      try {
        if (!record.patientId || !record.assignedToId || !record.dueDate) {
          recordError('followup', i, record.server_id, 'Missing required fields: patientId, assignedToId, dueDate');
          continue;
        }

        if (record.server_id) {
          // ASHA is updating the outcome of a follow-up recorded offline
          await prisma.followUp.update({
            where: { id: record.server_id },
            data: {
              status: record.status,
              outcome: record.outcome,
              notes: record.notes,
              completedAt: record.status === 'COMPLETED' ? new Date() : undefined,
            },
          });
        } else {
          await prisma.followUp.create({
            data: {
              patientId: record.patientId,
              relatedEncounterId: record.relatedEncounterId || null,
              relatedReferralId: record.relatedReferralId || null,
              assignedToId: record.assignedToId,
              dueDate: new Date(record.dueDate),
              status: record.status || 'PENDING',
              notes: record.notes || null,
            },
          });
        }
        synced.followups++;
      } catch (err) {
        recordError('followup', i, record.server_id, err.message);
      }
    }

    // ── Build and return the sync result ──────────────────────────────────────
    return successResponse(
      res,
      {
        success: true,
        deviceId,
        synced,
        errorCount: errors.length,
        errors, // Empty array if everything succeeded
      },
      errors.length === 0
        ? 'All records synced successfully.'
        : `Sync completed with ${errors.length} error(s). Check the errors array.`,
      errors.length === 0 ? 200 : 207 // 207 Multi-Status: some succeeded, some failed
    );
  } catch (error) {
    // This catches a total failure (e.g., database is down)
    next(error);
  }
};

// =============================================================================
// downloadUpdates
// =============================================================================
/**
 * GET /api/sync/download?deviceId=X&lastSyncedAt=2026-09-01T00:00:00Z
 * Returns all records updated after `lastSyncedAt` for patients assigned to
 * the authenticated ASHA worker. This allows the mobile app to stay up-to-date
 * with changes made by doctors on the web portal.
 *
 * @requires Query: deviceId, lastSyncedAt (ISO 8601 date string)
 * @requires Auth: ASHA or ANM
 */
const downloadUpdates = async (req, res, next) => {
  try {
    const { deviceId, lastSyncedAt } = req.query;

    // ── Validate query parameters ─────────────────────────────────────────────
    if (!deviceId) {
      return errorResponse(res, 'deviceId is required as a query parameter.', 400);
    }
    if (!lastSyncedAt) {
      return errorResponse(
        res,
        'lastSyncedAt is required as a query parameter (ISO 8601 format, e.g. 2026-09-01T00:00:00Z).',
        400
      );
    }

    const sinceDate = new Date(lastSyncedAt);
    if (isNaN(sinceDate.getTime())) {
      return errorResponse(res, 'Invalid lastSyncedAt date format. Use ISO 8601.', 400);
    }

    // ── Find all patients assigned to this ASHA worker ────────────────────────
    // We only return data for the patients this ASHA is responsible for.
    const assignedPatients = await prisma.patient.findMany({
      where: {
        assignedAshaId: req.user.id,
        updatedAt: { gt: sinceDate }, // Only patients updated after last sync
      },
      select: { id: true, name: true, phone: true, village: true, updatedAt: true, syncId: true },
    });

    // Collect IDs for efficient related-record queries
    const assignedPatientIds = await prisma.patient
      .findMany({
        where: { assignedAshaId: req.user.id },
        select: { id: true },
      })
      .then((rows) => rows.map((r) => r.id));

    if (assignedPatientIds.length === 0) {
      // No patients assigned — return empty payload
      return successResponse(
        res,
        { patients: [], encounters: [], vitals: [], prescriptions: [], followUps: [], referrals: [] },
        'No assigned patients found.'
      );
    }

    // ── Fetch all updated records for assigned patients in parallel ───────────
    // Using Promise.all for efficiency — all queries run concurrently.
    const [encounters, vitals, prescriptions, followUps, referrals] = await Promise.all([
      prisma.encounter.findMany({
        where: {
          patientId: { in: assignedPatientIds },
          createdAt: { gt: sinceDate },
        },
        orderBy: { createdAt: 'desc' },
      }),

      prisma.vitals.findMany({
        where: {
          patientId: { in: assignedPatientIds },
          recordedAt: { gt: sinceDate },
        },
        orderBy: { recordedAt: 'desc' },
      }),

      prisma.prescription.findMany({
        where: {
          patientId: { in: assignedPatientIds },
          createdAt: { gt: sinceDate },
        },
        orderBy: { createdAt: 'desc' },
      }),

      // Include follow-ups assigned directly to this ASHA worker
      prisma.followUp.findMany({
        where: {
          assignedToId: req.user.id,
          updatedAt: { gt: sinceDate },
        },
        orderBy: { dueDate: 'asc' },
      }),

      prisma.referral.findMany({
        where: {
          patientId: { in: assignedPatientIds },
          updatedAt: { gt: sinceDate },
        },
        orderBy: { updatedAt: 'desc' },
      }),
    ]);

    return successResponse(
      res,
      {
        serverTimestamp: new Date().toISOString(), // ASHA saves this as the new lastSyncedAt
        deviceId,
        patients: assignedPatients,
        encounters,
        vitals,
        prescriptions,
        followUps,
        referrals,
      },
      'Updates downloaded successfully.'
    );
  } catch (error) {
    next(error);
  }
};

module.exports = {
  uploadOfflineData,
  downloadUpdates,
};
