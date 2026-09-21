/**
 * src/controllers/followupController.js
 * ----------------------------------------
 * Handles all operations for follow-up management.
 *
 * A follow-up is a task assigned (usually to an ASHA/ANM worker) to check
 * on a patient after a consultation or referral. The worker visits or calls
 * the patient and records the outcome.
 *
 * Follow-up Lifecycle:
 *   PENDING → IN_PROGRESS → COMPLETED
 *                        ↘ MISSED
 *                        ↘ ESCALATED (worsening condition — route for clinical review)
 *
 * ⚠️  IMPORTANT: Verify that these Prisma model names match your schema exactly:
 *   prisma.followUp        → model FollowUp
 *   prisma.timelineEvent   → model TimelineEvent
 *   prisma.patient         → model Patient
 */

const prisma = require('../config/db');
const { successResponse, errorResponse } = require('../utils/responseHelper');

// ─── Valid Follow-up Statuses ─────────────────────────────────────────────────
// Must match the FollowUpStatus enum in your Prisma schema.
const VALID_FOLLOWUP_STATUSES = [
  'PENDING',
  'IN_PROGRESS',
  'COMPLETED',
  'MISSED',
  'ESCALATED',
  'CANCELLED',
];

// ─── Status → Timeline Event Type Mapping ────────────────────────────────────
// Maps a follow-up status to the correct TimelineEventType for the patient journey.
// Only statuses that have a meaningful timeline entry are mapped.
const STATUS_TO_TIMELINE_EVENT = {
  COMPLETED: 'FOLLOWUP_COMPLETED',
  MISSED: 'FOLLOWUP_MISSED',
  ESCALATED: 'FOLLOWUP_ESCALATED',
};

// =============================================================================
// createFollowUp
// =============================================================================
/**
 * POST /api/followups
 * Creates a new follow-up task and records a FOLLOWUP_SCHEDULED timeline event.
 *
 * @requires Body: { patientId, assignedToId, dueDate }
 * @optional Body: { relatedEncounterId, relatedReferralId, notes }
 * @requires Auth: DOCTOR or SPECIALIST
 */
const createFollowUp = async (req, res, next) => {
  try {
    const {
      patientId,
      relatedEncounterId,
      relatedReferralId,
      assignedToId,
      dueDate,
      notes,
    } = req.body;

    const effectiveAssignedToId = assignedToId || (req.user && req.user.id ? req.user.id : null);

    // ── Validate required fields ──────────────────────────────────────────────
    if (!patientId || !effectiveAssignedToId || !dueDate) {
      return errorResponse(
        res,
        'Missing required fields: patientId, dueDate',
        400
      );
    }

    // ── Validate dueDate is a valid date and is in the future ─────────────────
    const dueDateObj = new Date(dueDate);
    if (isNaN(dueDateObj.getTime())) {
      return errorResponse(res, 'Invalid dueDate format. Use an ISO 8601 date string.', 400);
    }
    if (dueDateObj <= new Date()) {
      return errorResponse(res, 'dueDate must be in the future.', 400);
    }

    // ── Verify the patient exists ─────────────────────────────────────────────
    const patient = await prisma.patient.findUnique({ where: { id: patientId } });
    if (!patient) {
      return errorResponse(res, `Patient with ID "${patientId}" not found.`, 404);
    }

    // ── Create follow-up + timeline event atomically ──────────────────────────
    const followUp = await prisma.$transaction(async (tx) => {
      // Step 1: Create the follow-up task
      const newFollowUp = await tx.followUp.create({
        data: {
          patientId,
          relatedEncounterId: relatedEncounterId || null,
          relatedReferralId: relatedReferralId || null,
          assignedToId:      effectiveAssignedToId,
          dueDate:           dueDateObj,
          status: 'PENDING', // Default status when a follow-up is first created
          notes: notes || null,
        },
      });

      // Step 2: Record this on the patient's timeline
      await tx.timelineEvent.create({
        data: {
          patientId,
          eventType: 'FOLLOWUP_SCHEDULED',
          referenceId: newFollowUp.id,
          description: `Follow-up scheduled. Due: ${dueDateObj.toDateString()}.${effectiveAssignedToId ? ` Assigned to worker ID: ${effectiveAssignedToId}` : ''}`,
        },
      });

      return newFollowUp;
    });

    return successResponse(res, { followUp }, 'Follow-up created successfully.', 201);
  } catch (error) {
    next(error);
  }
};

// =============================================================================
// getFollowUp
// =============================================================================
/**
 * GET /api/followups/:id
 * Fetches a single follow-up by ID with full related data:
 * patient info, assigned worker, and related encounter.
 *
 * @requires Param: id (follow-up ID)
 * @requires Auth: Any authenticated role
 */
const getFollowUp = async (req, res, next) => {
  try {
    const { id } = req.params;

    const followUp = await prisma.followUp.findUnique({
      where: { id },
      include: {
        // Patient's basic info for display
        patient: {
          select: {
            id: true,
            name: true,
            phone: true,
            village: true,
            gender: true,
          },
        },
        // The ASHA/ANM worker assigned to do this follow-up
        assignedTo: {
          select: { id: true, name: true, role: true, phone: true, identifier: true },
        },
        // The consultation that triggered this follow-up (if any)
        relatedEncounter: {
          select: {
            id: true,
            encounterType: true,
            encounterDate: true,
            clinicalNotes: true,
          },
        },
        // The referral this follow-up is linked to (if any)
        relatedReferral: {
          select: {
            id: true,
            status: true,
            reason: true,
            priority: true,
          },
        },
      },
    });

    if (!followUp) {
      return errorResponse(res, `Follow-up with ID "${id}" not found.`, 404);
    }

    return successResponse(res, { followUp }, 'Follow-up fetched successfully.');
  } catch (error) {
    next(error);
  }
};

// =============================================================================
// updateFollowUp
// =============================================================================
/**
 * PATCH /api/followups/:id
 * Updates the status, outcome, or notes of a follow-up.
 * - COMPLETED → sets completedAt to now and creates a FOLLOWUP_COMPLETED timeline event.
 * - MISSED    → creates a FOLLOWUP_MISSED timeline event.
 * - ESCALATED → creates a FOLLOWUP_ESCALATED timeline event for clinical review.
 *
 * @requires Param: id (follow-up ID)
 * @optional Body: { status, outcome, notes }
 * @requires Auth: ASHA, ANM, or DOCTOR
 */
const updateFollowUp = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status, outcome, notes } = req.body;

    // At least one field must be provided
    if (!status && !outcome && !notes) {
      return errorResponse(
        res,
        'Provide at least one field to update: status, outcome, or notes.',
        400
      );
    }

    // ── Validate status if provided ───────────────────────────────────────────
    if (status && !VALID_FOLLOWUP_STATUSES.includes(status)) {
      return errorResponse(
        res,
        `Invalid status "${status}". Valid values: ${VALID_FOLLOWUP_STATUSES.join(', ')}`,
        400
      );
    }

    // ── Find the existing follow-up ───────────────────────────────────────────
    const existingFollowUp = await prisma.followUp.findUnique({ where: { id } });
    if (!existingFollowUp) {
      return errorResponse(res, `Follow-up with ID "${id}" not found.`, 404);
    }

    // ── Build the update data object ──────────────────────────────────────────
    const updateData = {};
    if (status) updateData.status = status;
    if (outcome) updateData.outcome = outcome;
    if (notes) updateData.notes = notes;

    // If marking as COMPLETED, record the exact completion timestamp
    if (status === 'COMPLETED') {
      updateData.completedAt = new Date();
    }

    // ── Update follow-up and (optionally) add a timeline event ───────────────
    const updatedFollowUp = await prisma.$transaction(async (tx) => {
      // Step 1: Apply the updates
      const updated = await tx.followUp.update({
        where: { id },
        data: updateData,
      });

      // Step 2: Create a timeline event if the new status warrants one
      const timelineEventType = STATUS_TO_TIMELINE_EVENT[status];
      if (timelineEventType) {
        const descriptionMap = {
          COMPLETED: `Follow-up completed. Outcome: ${outcome || 'Not recorded.'}`,
          MISSED: `Follow-up was missed. Notes: ${notes || 'No notes.'}`,
          ESCALATED: `Follow-up escalated — patient may be worsening. Needs clinical review. Notes: ${notes || 'No notes.'}`,
        };

        await tx.timelineEvent.create({
          data: {
            patientId: existingFollowUp.patientId,
            eventType: timelineEventType,
            referenceId: id,
            description: descriptionMap[status],
          },
        });
      }

      return updated;
    });

    return successResponse(
      res,
      { followUp: updatedFollowUp },
      'Follow-up updated successfully.'
    );
  } catch (error) {
    next(error);
  }
};

// =============================================================================
// getAssignedFollowUps
// =============================================================================
/**
 * GET /api/followups/assigned
 * Returns all follow-ups assigned to the currently authenticated user (ASHA/ANM).
 * Optionally filter by ?status=PENDING to show only actionable tasks.
 *
 * @optional Query: status
 * @requires Auth: ASHA or ANM
 */
const getAssignedFollowUps = async (req, res, next) => {
  try {
    const { status } = req.query;

    // ── Build where clause ────────────────────────────────────────────────────
    // Always filter by the currently logged-in worker's ID
    const where = {
      assignedToId: req.user.id,
    };

    // Optionally further filter by status
    if (status) {
      if (!VALID_FOLLOWUP_STATUSES.includes(status)) {
        return errorResponse(
          res,
          `Invalid status filter "${status}". Valid values: ${VALID_FOLLOWUP_STATUSES.join(', ')}`,
          400
        );
      }
      where.status = status;
    }

    const followUps = await prisma.followUp.findMany({
      where,
      orderBy: { dueDate: 'asc' }, // Soonest due first — most urgent at the top
      include: {
        patient: {
          select: { id: true, name: true, phone: true, village: true },
        },
      },
    });

    return successResponse(
      res,
      { count: followUps.length, followUps },
      'Assigned follow-ups fetched successfully.'
    );
  } catch (error) {
    next(error);
  }
};

// =============================================================================
// getOverdueFollowUps
// =============================================================================
/**
 * GET /api/followups/overdue
 * Returns all follow-ups that are past their due date and still not completed.
 * Useful for doctors and admins to identify missed care.
 *
 * An overdue follow-up is one where:
 *   - dueDate is in the past (before right now)
 *   - status is still PENDING or IN_PROGRESS (i.e., not yet resolved)
 *
 * @requires Auth: DOCTOR, SPECIALIST, or SYSTEM_ADMIN
 */
const getOverdueFollowUps = async (req, res, next) => {
  try {
    const now = new Date();

    const followUps = await prisma.followUp.findMany({
      where: {
        dueDate: { lt: now }, // lt = "less than", meaning dueDate is in the past
        status: {
          in: ['PENDING', 'IN_PROGRESS'], // Only those that haven't been resolved
        },
      },
      orderBy: { dueDate: 'asc' }, // Most overdue (oldest due date) first
      include: {
        patient: {
          select: { id: true, name: true, phone: true, village: true },
        },
        assignedTo: {
          select: { id: true, name: true, phone: true, role: true },
        },
      },
    });

    return successResponse(
      res,
      { count: followUps.length, followUps },
      'Overdue follow-ups fetched successfully.'
    );
  } catch (error) {
    next(error);
  }
};

module.exports = {
  createFollowUp,
  getFollowUp,
  updateFollowUp,
  getAssignedFollowUps,
  getOverdueFollowUps,
};
