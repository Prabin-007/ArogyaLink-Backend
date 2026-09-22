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
 *
 * Person 4 Smart Referral AI integration:
 *   This controller now supports an optional "smart mode" that automatically
 *   selects the best receiving facility using the Smart Referral AI service.
 *   All existing direct-referral clients remain fully backward-compatible.
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
 *
 * Creates a new referral for a patient. Supports TWO modes:
 *
 * MODE 1 – SMART REFERRAL (Person 4 integration):
 *   Provide smart referral parameters (requiredService, patientLatitude, etc.)
 *   The Smart Referral AI will:
 *     a. Find eligible facilities
 *     b. Score and rank them
 *     c. Return the recommended facility as receivingFacilityId
 *     d. Attach the recommendation + alternatives to the referral
 *
 *   Required for smart mode:
 *     patientId, encounterId, referringFacilityId, reason, priority,
 *     patientLatitude, patientLongitude
 *   Optional for smart mode:
 *     requiredService, requiredSpecialist, emergency, requiredDiagnostics
 *
 * MODE 2 – DIRECT REFERRAL (Person 3 original, fully backward-compatible):
 *   Provide receivingFacilityId explicitly.
 *   No AI recommendation is generated.
 *   All existing clients continue to work without any changes.
 *
 *   Required:
 *     patientId, encounterId, referringFacilityId, receivingFacilityId,
 *     reason, priority
 *
 * Integration with Person 5 (Emergency Triage):
 *   Send emergency: true  or  priority: "EMERGENCY"
 *   The AI will switch to the emergency weight profile and only consider
 *   emergency-capable facilities.
 *
 * @requires Auth: DOCTOR or SPECIALIST
 */
const createReferral = async (req, res, next) => {
  try {
    const {
      patientId,
      encounterId,
      referringFacilityId,
      reason,
      priority,
      // Direct referral (Mode 2 – backward compatibility)
      receivingFacilityId,
      // Smart referral params (Mode 1 – Person 4)
      patientLatitude,
      patientLongitude,
      requiredService,
      requiredSpecialist,
      preferredSpecialistGender,
      emergency = false,
      requiredDiagnostics = [],
    } = req.body;

    // ── Validate always-required fields ───────────────────────────────────────
    if (!patientId || !encounterId || !referringFacilityId || !reason || !priority) {
      return errorResponse(
        res,
        'Missing required fields: patientId, encounterId, referringFacilityId, reason, priority',
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

    // ─────────────────────────────────────────────────────────────────────────
    // Determine mode: Smart vs Direct
    // ─────────────────────────────────────────────────────────────────────────
    const isSmartMode =
      patientLatitude != null && patientLongitude != null && !receivingFacilityId;

    let resolvedReceivingFacilityId = receivingFacilityId || null;
    let recommendationData = null;

    if (isSmartMode) {
      // ── MODE 1: Smart Referral AI ────────────────────────────────────────────
      // Lazy-load to avoid circular dependency issues if any future refactoring occurs
      const { getSmartReferralRecommendation } = require('../services/smartReferralService');

      const result = await getSmartReferralRecommendation({
        patientLatitude:   parseFloat(patientLatitude),
        patientLongitude:  parseFloat(patientLongitude),
        requiredService,
        requiredSpecialist,
        preferredSpecialistGender,
        priority,
        emergency: emergency === true || emergency === 'true',
        requiredDiagnostics: Array.isArray(requiredDiagnostics) ? requiredDiagnostics : [],
      });

      if (result.noEligibleFacilities) {
        // Cannot create a referral if no facility can serve the patient.
        // Return 422 Unprocessable Entity with a clear explanation.
        return errorResponse(
          res,
          result.message ||
            'No eligible facilities found. Cannot create smart referral. ' +
            'Please check facility data or specify a receivingFacilityId directly.',
          422
        );
      }

      // Use the top-ranked facility as the receiving facility
      resolvedReceivingFacilityId = result.recommendation.facilityId;
      recommendationData = result;

    } else if (!receivingFacilityId) {
      // Neither smart mode nor direct mode — require one or the other
      return errorResponse(
        res,
        'Provide either (a) receivingFacilityId for a direct referral, or ' +
        '(b) patientLatitude and patientLongitude for a smart referral.',
        400
      );
    }

    // ── Create referral + initial audit event + timeline event in one transaction ──
    // Using $transaction ensures all three records are created atomically.
    // If any step fails, none of the records are saved (data integrity).
    const referral = await prisma.$transaction(async (tx) => {
      // Step 1: Create the referral record
      // Smart Referral extra fields are stored on the referral for traceability.
      const newReferral = await tx.referral.create({
        data: {
          patientId,
          encounterId,
          referringFacilityId,
          receivingFacilityId:   resolvedReceivingFacilityId,
          createdById:           req.user.id, // Set from the authenticated user's JWT payload
          reason,
          priority,
          status: 'CREATED', // Default starting status
          // Smart Referral AI fields (null for direct referrals – backward compatible)
          recommendationScore:   recommendationData
            ? recommendationData.recommendation.score
            : null,
          recommendationReasons: recommendationData
            ? recommendationData.recommendation.reasons
            : [],
          alternativeFacilities: recommendationData
            ? recommendationData.alternatives
            : null,
        },
      });

      // Step 2: Create the first ReferralEvent (audit trail entry)
      // previousStatus is null because this is the very first event.
      await tx.referralEvent.create({
        data: {
          referralId:     newReferral.id,
          previousStatus: null,
          newStatus:      'CREATED',
          updatedById:    req.user.id,
          remarks: isSmartMode
            ? `Smart referral created. AI recommended facility with score ${recommendationData.recommendation.score}.`
            : 'Referral created.',
        },
      });

      // Step 3: Create a TimelineEvent so the patient journey reflects this referral
      await tx.timelineEvent.create({
        data: {
          patientId,
          eventType:   'REFERRAL_CREATED',
          referenceId: newReferral.id, // Link back to the referral so the UI can navigate to it
          description: isSmartMode
            ? `Smart referral created with priority ${priority}. Reason: ${reason}. AI-recommended facility score: ${recommendationData.recommendation.score}.`
            : `Referral created with priority ${priority}. Reason: ${reason}`,
        },
      });

      return newReferral;
    });

    // ── Build response ────────────────────────────────────────────────────────
    // Response is enriched with Smart Referral data when in smart mode.
    // Direct referrals return the same shape as before (backward compatible).
    const responseData = {
      referral: {
        id:                   referral.id,
        patientId:            referral.patientId,
        encounterId:          referral.encounterId,
        referringFacilityId:  referral.referringFacilityId,
        receivingFacilityId:  referral.receivingFacilityId,
        reason:               referral.reason,
        priority:             referral.priority,
        status:               referral.status,
        createdAt:            referral.createdAt,
      },
    };

    if (recommendationData) {
      responseData.recommendation = recommendationData.recommendation;
      responseData.bestOverall    = recommendationData.bestOverall;
      responseData.bestMatchingGender = recommendationData.bestMatchingGender;
      responseData.alternatives   = recommendationData.alternatives;
      responseData.smartReferral  = {
        weightProfile:   recommendationData.weightProfile,
        eligibleCount:   recommendationData.eligibleCount,
        excludedCount:   recommendationData.excludedCount,
        isEmergencyMode: recommendationData.weightProfile === 'EMERGENCY',
      };
    }

    return successResponse(res, responseData, 'Referral created successfully.', 201);
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
