/**
 * src/controllers/referralController.js
 * ---------------------------------------
 * Handles all operations related to patient referrals.
 *
 * A referral tracks a patient being sent from one facility (e.g., PHC) to
 * another (e.g., District Hospital). Every status change is recorded as an
 * immutable ReferralEvent for a full audit trail.
 *
 * Referral Lifecycle:
 *   CREATED → ACCEPTED → PATIENT_ARRIVED → TREATED → COMPLETED
 *             (or REJECTED / CANCELLED at any point)
 *
 * ⚠️  IMPORTANT: Verify that these Prisma model names match your schema exactly:
 *   prisma.referral        → model Referral
 *   prisma.referralEvent   → model ReferralEvent
 *   prisma.timelineEvent   → model TimelineEvent
 *   prisma.patient         → model Patient
 */

const prisma = require('../config/db');
const { successResponse, errorResponse } = require('../utils/responseHelper');

// ─── Valid Referral Statuses ───────────────────────────────────────────────────
// These must exactly match the ReferralStatus enum in your Prisma schema.
const VALID_REFERRAL_STATUSES = [
  'CREATED',
  'ACCEPTED',
  'REJECTED',
  'PATIENT_ARRIVED',
  'TREATED',
  'FOLLOW_UP_REQUIRED',
  'COMPLETED',
  'CANCELLED',
];

// ─── Status → Timeline Event Type Mapping ─────────────────────────────────────
// Maps a new referral status to the correct TimelineEventType enum value.
// These must match the TimelineEventType enum in your Prisma schema.
const STATUS_TO_TIMELINE_EVENT = {
  ACCEPTED: 'REFERRAL_ACCEPTED',
  REJECTED: 'REFERRAL_REJECTED',
  PATIENT_ARRIVED: 'PATIENT_ARRIVED_AT_HOSPITAL',
  TREATED: 'TREATMENT_COMPLETED',
  COMPLETED: 'TREATMENT_COMPLETED',
};

// =============================================================================
// createReferral
// =============================================================================
/**
 * POST /api/referrals
 * Creates a new referral for a patient from a referring facility to a receiving
 * facility. Also creates the initial ReferralEvent (audit log) and a
 * TimelineEvent (patient journey record).
 *
 * @requires Body: { patientId, encounterId, referringFacilityId, receivingFacilityId, reason, priority }
 * @requires Auth: DOCTOR or SPECIALIST
 */
const createReferral = async (req, res, next) => {
  try {
    const {
      patientId,
      encounterId,
      referringFacilityId,
      receivingFacilityId,
      reason,
      priority,
    } = req.body;

    // ── Validate required fields ──────────────────────────────────────────────
    if (
      !patientId ||
      !encounterId ||
      !referringFacilityId ||
      !receivingFacilityId ||
      !reason ||
      !priority
    ) {
      return errorResponse(
        res,
        'Missing required fields: patientId, encounterId, referringFacilityId, receivingFacilityId, reason, priority',
        400
      );
    }

    // ── Validate priority value ───────────────────────────────────────────────
    const VALID_PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'EMERGENCY'];
    if (!VALID_PRIORITIES.includes(priority)) {
      return errorResponse(
        res,
        `Invalid priority. Must be one of: ${VALID_PRIORITIES.join(', ')}`,
        400
      );
    }

    // ── Verify the patient exists ─────────────────────────────────────────────
    const patient = await prisma.patient.findUnique({ where: { id: patientId } });
    if (!patient) {
      return errorResponse(res, `Patient with ID "${patientId}" not found.`, 404);
    }

    // ── Create referral + initial audit event + timeline event in one transaction ──
    // Using $transaction ensures all three records are created atomically.
    // If any step fails, none of the records are saved (data integrity).
    const referral = await prisma.$transaction(async (tx) => {
      // Step 1: Create the referral record
      const newReferral = await tx.referral.create({
        data: {
          patientId,
          encounterId,
          referringFacilityId,
          receivingFacilityId,
          createdById: req.user.id, // Set from the authenticated user's JWT payload
          reason,
          priority,
          status: 'CREATED', // Default starting status
        },
      });

      // Step 2: Create the first ReferralEvent (audit trail entry)
      // previousStatus is null because this is the very first event.
      await tx.referralEvent.create({
        data: {
          referralId: newReferral.id,
          previousStatus: null,
          newStatus: 'CREATED',
          updatedById: req.user.id,
          remarks: 'Referral created.',
        },
      });

      // Step 3: Create a TimelineEvent so the patient journey reflects this referral
      await tx.timelineEvent.create({
        data: {
          patientId,
          eventType: 'REFERRAL_CREATED',
          referenceId: newReferral.id, // Link back to the referral so the UI can navigate to it
          description: `Referral created with priority ${priority}. Reason: ${reason}`,
        },
      });

      return newReferral;
    });

    return successResponse(res, { referral }, 'Referral created successfully.', 201);
  } catch (error) {
    // Pass unexpected errors to the global error handler (src/middleware/errorHandler.js)
    next(error);
  }
};

// =============================================================================
// getReferral
// =============================================================================
/**
 * GET /api/referrals/:id
 * Fetches a single referral by its ID, including the patient's basic info,
 * the full audit trail of status changes, and related follow-ups.
 *
 * @requires Param: id (referral ID)
 * @requires Auth: Any authenticated role
 */
const getReferral = async (req, res, next) => {
  try {
    const { id } = req.params;

    const referral = await prisma.referral.findUnique({
      where: { id },
      include: {
        // Include patient with only the fields needed for display
        patient: {
          select: {
            id: true,
            name: true,
            phone: true,
            village: true,
            gender: true,
          },
        },
        // Include who created the referral
        createdBy: {
          select: { id: true, name: true, role: true, identifier: true },
        },
        // Ordered audit log of every status change (oldest first)
        events: {
          orderBy: { createdAt: 'asc' },
          include: {
            updatedBy: {
              select: { id: true, name: true, role: true },
            },
          },
        },
        // Follow-ups that were created as a result of this referral
        followUps: {
          select: {
            id: true,
            status: true,
            dueDate: true,
            completedAt: true,
            assignedTo: {
              select: { id: true, name: true, role: true },
            },
          },
        },
      },
    });

    if (!referral) {
      return errorResponse(res, `Referral with ID "${id}" not found.`, 404);
    }

    return successResponse(res, { referral }, 'Referral fetched successfully.');
  } catch (error) {
    next(error);
  }
};

// =============================================================================
// updateReferralStatus
// =============================================================================
/**
 * PATCH /api/referrals/:id/status
 * Updates the status of a referral and records an audit trail entry.
 * Also appends a relevant TimelineEvent to the patient's journey.
 *
 * @requires Param: id (referral ID)
 * @requires Body: { newStatus, remarks (optional) }
 * @requires Auth: DOCTOR, SPECIALIST, or HOSPITAL_ADMIN
 */
const updateReferralStatus = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { newStatus, remarks } = req.body;

    // ── Validate the new status ───────────────────────────────────────────────
    if (!newStatus) {
      return errorResponse(res, 'newStatus is required.', 400);
    }
    if (!VALID_REFERRAL_STATUSES.includes(newStatus)) {
      return errorResponse(
        res,
        `Invalid status "${newStatus}". Valid values: ${VALID_REFERRAL_STATUSES.join(', ')}`,
        400
      );
    }

    // ── Find the existing referral ────────────────────────────────────────────
    const existingReferral = await prisma.referral.findUnique({ where: { id } });
    if (!existingReferral) {
      return errorResponse(res, `Referral with ID "${id}" not found.`, 404);
    }

    // ── Save the previous status before overwriting ───────────────────────────
    const previousStatus = existingReferral.status;

    // ── Build optional timestamp updates based on the new status ─────────────
    // These fields track when specific milestones occurred.
    const timestampUpdates = {};
    if (newStatus === 'ACCEPTED') {
      timestampUpdates.acceptedAt = new Date();
    } else if (newStatus === 'PATIENT_ARRIVED') {
      timestampUpdates.patientArrivedAt = new Date();
    } else if (newStatus === 'TREATED' || newStatus === 'COMPLETED') {
      timestampUpdates.treatmentCompletedAt = new Date();
    } else if (newStatus === 'FOLLOW_UP_REQUIRED') {
      timestampUpdates.requiresFollowUp = true;
    }

    // ── Run update + audit log + timeline in one atomic transaction ───────────
    const updatedReferral = await prisma.$transaction(async (tx) => {
      // Step 1: Update the referral's status
      const updated = await tx.referral.update({
        where: { id },
        data: {
          status: newStatus,
          ...timestampUpdates,
        },
      });

      // Step 2: Append a ReferralEvent to the audit log
      await tx.referralEvent.create({
        data: {
          referralId: id,
          previousStatus,       // The status before this change
          newStatus,            // The status after this change
          updatedById: req.user.id,
          remarks: remarks || null,
        },
      });

      // Step 3: Create a TimelineEvent if this status has a mapped event type
      const timelineEventType = STATUS_TO_TIMELINE_EVENT[newStatus];
      if (timelineEventType) {
        await tx.timelineEvent.create({
          data: {
            patientId: existingReferral.patientId,
            eventType: timelineEventType,
            referenceId: id,
            description: `Referral status updated: ${previousStatus} → ${newStatus}.${remarks ? ` Remarks: ${remarks}` : ''}`,
          },
        });
      }

      return updated;
    });

    return successResponse(
      res,
      { referral: updatedReferral },
      `Referral status updated to ${newStatus}.`
    );
  } catch (error) {
    next(error);
  }
};

// =============================================================================
// getFacilityReferrals
// =============================================================================
/**
 * GET /api/referrals
 * Returns all referrals for a given receiving facility.
 * Used by hospital staff to see incoming referrals.
 *
 * Also supports querying referrals by patientId (standalone alternative to
 * GET /api/patients/:patientId/referrals).
 *
 * @requires Query: receivingFacilityId OR patientId
 * @optional Query: status, priority
 * @requires Auth: DOCTOR, SPECIALIST, HOSPITAL_ADMIN
 */
const getFacilityReferrals = async (req, res, next) => {
  try {
    const { receivingFacilityId, patientId, status, priority } = req.query;

    // Require at least one filter to prevent returning ALL referrals in the system
    if (!receivingFacilityId && !patientId) {
      return errorResponse(
        res,
        'Please provide either receivingFacilityId or patientId as a query parameter.',
        400
      );
    }

    // ── Build the Prisma where clause dynamically ─────────────────────────────
    const where = {};

    if (receivingFacilityId) {
      where.receivingFacilityId = receivingFacilityId;
    }
    if (patientId) {
      where.patientId = patientId;
    }

    // Optional filters — only apply if provided
    if (status) {
      if (!VALID_REFERRAL_STATUSES.includes(status)) {
        return errorResponse(
          res,
          `Invalid status filter "${status}". Valid values: ${VALID_REFERRAL_STATUSES.join(', ')}`,
          400
        );
      }
      where.status = status;
    }
    if (priority) {
      const VALID_PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'EMERGENCY'];
      if (!VALID_PRIORITIES.includes(priority)) {
        return errorResponse(
          res,
          `Invalid priority filter "${priority}". Valid values: ${VALID_PRIORITIES.join(', ')}`,
          400
        );
      }
      where.priority = priority;
    }

    const referrals = await prisma.referral.findMany({
      where,
      orderBy: { createdAt: 'desc' }, // Most recent referrals first
      include: {
        patient: {
          select: { id: true, name: true, phone: true, village: true },
        },
        createdBy: {
          select: { id: true, name: true, role: true },
        },
        // Include just the latest event for a quick status summary
        events: {
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    });

    return successResponse(
      res,
      { count: referrals.length, referrals },
      'Referrals fetched successfully.'
    );
  } catch (error) {
    next(error);
  }
};

module.exports = {
  createReferral,
  getReferral,
  updateReferralStatus,
  getFacilityReferrals,
};
