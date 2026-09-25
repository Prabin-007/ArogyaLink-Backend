/**
 * src/controllers/patientController.js
 * -------------------------------------
 * Patient Controller — ArogyaLink Person 3 Backend
 *
 * Handles all patient-related operations:
 *   - Creating and updating patient records
 *   - Fetching a single patient or a paginated list
 *   - Retrieving a patient's timeline, follow-ups, and referrals
 *
 * Every significant action (e.g. patient registration) automatically
 * appends a TimelineEvent so the patient's full journey is always traceable.
 *
 * Prisma model reference (from schema.prisma):
 *   prisma.patient          → "patients" table
 *   prisma.timelineEvent    → "timeline_events" table
 *   prisma.followUp         → "followups" table
 *   prisma.referral         → "referrals" table
 */

const prisma = require('../config/db');
const { successResponse, errorResponse } = require('../utils/responseHelper');
const { logPatientRegistered, logHighRiskFlagged } = require('../utils/timeline');

// ─── ASHA-work fields (added for mobile sync v2, all optional) ────────────────
const VALID_CATEGORIES = ['GENERAL', 'PREGNANT', 'CHILD_UNDER_5', 'NCD', 'ELDERLY'];
const VALID_TRIAGE_LEVELS = ['EMERGENCY', 'REFER_SOON', 'WATCH', 'ROUTINE'];

const CATEGORY_ALIASES = {
  PREGNANT_WOMAN: 'PREGNANT',
  CHRONIC_DISEASE: 'NCD',
  INFANT: 'CHILD_UNDER_5',
};

const normalizeCategory = (cat) => {
  if (!cat || typeof cat !== 'string') return cat;
  const upper = cat.trim().toUpperCase();
  return CATEGORY_ALIASES[upper] || upper;
};

/**
 * Validates the optional ASHA-work fields (category, lmpDate, isHighRisk,
 * riskReasons). Returns an error message string, or null if they are fine.
 * Only fields that are present are checked, so existing callers that never
 * send them are unaffected.
 */
const validateAshaFields = ({ category, lmpDate, isHighRisk, riskReasons }) => {
  if (category !== undefined) {
    const normalized = normalizeCategory(category);
    if (!VALID_CATEGORIES.includes(normalized)) {
      return `Invalid category. Must be one of: ${VALID_CATEGORIES.join(', ')}`;
    }
  }
  if (lmpDate !== undefined && lmpDate !== null && isNaN(new Date(lmpDate).getTime())) {
    return 'Invalid lmpDate. Use an ISO 8601 date string.';
  }
  if (isHighRisk !== undefined && typeof isHighRisk !== 'boolean') {
    return 'isHighRisk must be a boolean.';
  }
  if (
    riskReasons !== undefined &&
    !(Array.isArray(riskReasons) && riskReasons.every((r) => typeof r === 'string'))
  ) {
    return 'riskReasons must be an array of strings.';
  }
  return null;
};

// =============================================================================
// CREATE PATIENT
// =============================================================================

/**
 * POST /api/patients
 *
 * Creates a new patient record and immediately logs a PATIENT_REGISTERED
 * timeline event so the registration appears in the patient's history.
 *
 * Required body fields:
 *   name, dateOfBirth, gender, village, district, state, assignedAshaId
 *
 * Optional body fields:
 *   phone, address, category, lmpDate, isHighRisk, riskReasons
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
const createPatient = async (req, res, next) => {
  try {
    const {
      name,
      dateOfBirth,
      gender,
      phone,
      address,
      village,
      district,
      state,
      assignedAshaId,
      category,
      lmpDate,
      isHighRisk,
      riskReasons,
    } = req.body;

    // ── Validation ────────────────────────────────────────────────────────────
    // These fields are required by the schema (non-nullable without defaults).
    const missingFields = [];
    if (!name)        missingFields.push('name');
    if (!dateOfBirth) missingFields.push('dateOfBirth');
    if (!gender)      missingFields.push('gender');
    if (!village)     missingFields.push('village');
    if (!district)    missingFields.push('district');
    if (!state)       missingFields.push('state');
    // assignedAshaId is optional — can be assigned later

    if (missingFields.length > 0) {
      return errorResponse(
        res,
        `Missing required fields: ${missingFields.join(', ')}`,
        400
      );
    }

    // Validate that 'gender' is one of the allowed enum values from the schema.
    const validGenders = ['MALE', 'FEMALE', 'OTHER'];
    if (!validGenders.includes(gender)) {
      return errorResponse(
        res,
        `Invalid gender. Must be one of: ${validGenders.join(', ')}`,
        400
      );
    }

    const ashaFieldError = validateAshaFields({ category, lmpDate, isHighRisk, riskReasons });
    if (ashaFieldError) {
      return errorResponse(res, ashaFieldError, 400);
    }

    // ── Create Patient (inside a Prisma transaction) ──────────────────────────
    // We use $transaction to ensure that if the TimelineEvent creation fails,
    // the patient creation is also rolled back. Atomicity = data integrity.
    const result = await prisma.$transaction(async (tx) => {
      // 1. Create the patient record
      const patient = await tx.patient.create({
        data: {
          name,
          dateOfBirth: new Date(dateOfBirth), // Convert string → Date object
          gender,
          phone:   phone   || null,
          address: address || null,
          village,
          district,
          state,
          // Only include assignedAshaId if it was actually provided.
          // Passing `undefined` to a Prisma relation field causes a validation error.
          ...(assignedAshaId ? { assignedAshaId } : {}),
          // ASHA-work fields (optional; DB defaults apply when omitted)
          ...(category   !== undefined ? { category: normalizeCategory(category) } : {}),
          ...(lmpDate    ? { lmpDate: new Date(lmpDate) } : {}),
          ...(isHighRisk !== undefined ? { isHighRisk } : {}),
          riskReasons: riskReasons || [],
          lastModifiedById: req.user.id, // who wrote this row (sync uses it for conflict detection)
        },
      });

      // 2. Log the registration as a timeline event (shared helper)
      await logPatientRegistered(tx, patient);

      // 3. Registered straight into high-risk → also flag it for doctors
      if (patient.isHighRisk) {
        await logHighRiskFlagged(tx, patient);
      }

      return patient;
    });

    return successResponse(res, { patient: result }, 'Patient created successfully', 201);
  } catch (error) {
    // Pass any unexpected error to the global error handler
    next(error);
  }
};

// =============================================================================
// GET SINGLE PATIENT
// =============================================================================

/**
 * GET /api/patients/:id
 *
 * Fetches a single patient by their database ID.
 * Includes the assigned ASHA worker's name, identifier (ASHA ID), and role
 * so the frontend can display who is responsible for this patient.
 *
 * @param {import('express').Request}  req - req.params.id = patient ID
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
const getPatient = async (req, res, next) => {
  try {
    const { id } = req.params;

    const patient = await prisma.patient.findUnique({
      where: { id },
      include: {
        // Include the assigned ASHA worker with selected fields only
        assignedAsha: {
          select: {
            name:       true,
            identifier: true,
            role:       true,
          },
        },
      },
    });

    if (!patient) {
      return errorResponse(res, `Patient with ID "${id}" not found`, 404);
    }

    return successResponse(res, { patient }, 'Patient fetched successfully');
  } catch (error) {
    next(error);
  }
};

// =============================================================================
// UPDATE PATIENT
// =============================================================================

/**
 * PUT /api/patients/:id
 *
 * Partially updates a patient record. Only the fields provided in the request
 * body will be updated — all others remain unchanged (partial update / PATCH
 * semantics via Prisma's update()).
 *
 * Allowed fields: name, dateOfBirth, gender, phone, address,
 *                 village, district, state, assignedAshaId,
 *                 category, lmpDate, isHighRisk, riskReasons
 *
 * @param {import('express').Request}  req - req.params.id = patient ID
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
const updatePatient = async (req, res, next) => {
  try {
    const { id } = req.params;
    const {
      name,
      dateOfBirth,
      gender,
      phone,
      address,
      village,
      district,
      state,
      assignedAshaId,
      category,
      lmpDate,
      isHighRisk,
      riskReasons,
    } = req.body;

    // Make sure the patient exists before attempting an update
    const existing = await prisma.patient.findUnique({ where: { id } });
    if (!existing) {
      return errorResponse(res, `Patient with ID "${id}" not found`, 404);
    }

    // Validate gender only if it's being updated
    if (gender) {
      const validGenders = ['MALE', 'FEMALE', 'OTHER'];
      if (!validGenders.includes(gender)) {
        return errorResponse(
          res,
          `Invalid gender. Must be one of: ${validGenders.join(', ')}`,
          400
        );
      }
    }

    const ashaFieldError = validateAshaFields({ category, lmpDate, isHighRisk, riskReasons });
    if (ashaFieldError) {
      return errorResponse(res, ashaFieldError, 400);
    }

    // Build the update payload — only include fields that were actually sent.
    // This prevents accidentally overwriting fields with undefined/null.
    const updateData = {};
    if (name           !== undefined) updateData.name           = name;
    if (dateOfBirth    !== undefined) updateData.dateOfBirth    = new Date(dateOfBirth);
    if (gender         !== undefined) updateData.gender         = gender;
    if (phone          !== undefined) updateData.phone          = phone;
    if (address        !== undefined) updateData.address        = address;
    if (village        !== undefined) updateData.village        = village;
    if (district       !== undefined) updateData.district       = district;
    if (state          !== undefined) updateData.state          = state;
    if (assignedAshaId !== undefined) updateData.assignedAshaId = assignedAshaId;
    if (category       !== undefined) updateData.category       = normalizeCategory(category);
    if (lmpDate        !== undefined) updateData.lmpDate        = lmpDate === null ? null : new Date(lmpDate);
    if (isHighRisk     !== undefined) updateData.isHighRisk     = isHighRisk;
    if (riskReasons    !== undefined) updateData.riskReasons    = riskReasons;
    updateData.lastModifiedById = req.user.id; // who wrote this row (sync uses it for conflict detection)

    // Update + (if the patient just became high-risk) the timeline event, atomically.
    const updatedPatient = await prisma.$transaction(async (tx) => {
      const updated = await tx.patient.update({
        where: { id },
        data:  updateData,
      });

      // Only the false → true transition raises the flag; re-saving an
      // already-high-risk patient must not spam the timeline.
      if (!existing.isHighRisk && updated.isHighRisk) {
        await logHighRiskFlagged(tx, updated);
      }

      return updated;
    });

    return successResponse(res, { patient: updatedPatient }, 'Patient updated successfully');
  } catch (error) {
    next(error);
  }
};

// =============================================================================
// GET PATIENT TIMELINE
// =============================================================================

/**
 * GET /api/patients/:id/timeline
 *
 * Returns the full chronological history of events for a patient,
 * ordered newest-first. Each event includes what happened, when it happened,
 * and a referenceId to deep-link into the related record.
 *
 * @param {import('express').Request}  req - req.params.id = patient ID
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
const getPatientTimeline = async (req, res, next) => {
  try {
    const { id } = req.params;

    // Verify the patient exists first
    const patient = await prisma.patient.findUnique({ where: { id } });
    if (!patient) {
      return errorResponse(res, `Patient with ID "${id}" not found`, 404);
    }

    const timeline = await prisma.timelineEvent.findMany({
      where:   { patientId: id },
      select: {
        // Only return fields the frontend needs — keeps the payload lean
        eventType:   true,
        description: true,
        referenceId: true,
        createdAt:   true,
      },
      orderBy: { createdAt: 'desc' }, // Most recent events first
    });

    return successResponse(
      res,
      { patientId: id, timeline },
      'Patient timeline fetched successfully'
    );
  } catch (error) {
    next(error);
  }
};

// =============================================================================
// GET PATIENT ASSESSMENTS
// =============================================================================

/**
 * GET /api/patients/:id/assessments
 *
 * Every assessment (structured form) completed for a patient, newest first
 * (by completedAt — the phone's time — then createdAt). For the doctor dashboard.
 *
 * `triageLevel` / `triageReasons` are the phone's rule-based result;
 * `serverTriageLevel` / `serverTriageReasons` (EMERGENCY|HIGH|MEDIUM|LOW) come from
 * the server's own triage engine and may be null.
 */
const getPatientAssessments = async (req, res, next) => {
  try {
    const { id } = req.params;

    const patient = await prisma.patient.findUnique({ where: { id } });
    if (!patient) {
      return errorResponse(res, `Patient with ID "${id}" not found`, 404);
    }

    const assessments = await prisma.assessment.findMany({
      where: { patientId: id },
      include: { recordedBy: { select: { id: true, name: true, role: true } } },
      orderBy: [{ completedAt: 'desc' }, { createdAt: 'desc' }],
    });

    return successResponse(
      res,
      { patientId: id, assessments },
      'Patient assessments fetched successfully'
    );
  } catch (error) {
    next(error);
  }
};

// =============================================================================
// GET PATIENT FOLLOW-UPS
// =============================================================================

/**
 * GET /api/patients/:id/followups
 *
 * Returns all follow-up tasks for a patient.
 * Supports an optional ?status= query parameter to filter by follow-up status
 * (e.g., ?status=PENDING or ?status=COMPLETED).
 *
 * Valid status values: PENDING | IN_PROGRESS | COMPLETED | MISSED | ESCALATED | CANCELLED
 *
 * @param {import('express').Request}  req - req.params.id = patient ID, req.query.status
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
const getPatientFollowUps = async (req, res, next) => {
  try {
    const { id }     = req.params;
    const { status } = req.query;

    // Verify the patient exists
    const patient = await prisma.patient.findUnique({ where: { id } });
    if (!patient) {
      return errorResponse(res, `Patient with ID "${id}" not found`, 404);
    }

    // Validate optional status filter
    if (status) {
      const validStatuses = ['PENDING', 'IN_PROGRESS', 'COMPLETED', 'MISSED', 'ESCALATED', 'CANCELLED'];
      if (!validStatuses.includes(status)) {
        return errorResponse(
          res,
          `Invalid status filter. Must be one of: ${validStatuses.join(', ')}`,
          400
        );
      }
    }

    // Build the where clause — conditionally include status filter
    const whereClause = {
      patientId: id,
      ...(status && { status }), // Only add status to query if it was provided
    };

    const followUps = await prisma.followUp.findMany({
      where: whereClause,
      include: {
        // Include the ASHA/ANM worker assigned to this follow-up task
        assignedTo: {
          select: {
            name:       true,
            identifier: true,
          },
        },
      },
      orderBy: { dueDate: 'asc' }, // Nearest due date first
    });

    return successResponse(
      res,
      { patientId: id, followUps },
      'Patient follow-ups fetched successfully'
    );
  } catch (error) {
    next(error);
  }
};

// =============================================================================
// GET PATIENT REFERRALS
// =============================================================================

/**
 * GET /api/patients/:id/referrals
 *
 * Returns all referrals for a patient, ordered newest-first.
 * Includes the full audit trail of status changes (referral events)
 * so the frontend can render the referral lifecycle visually.
 *
 * @param {import('express').Request}  req - req.params.id = patient ID
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
const getPatientReferrals = async (req, res, next) => {
  try {
    const { id } = req.params;

    // Verify the patient exists
    const patient = await prisma.patient.findUnique({ where: { id } });
    if (!patient) {
      return errorResponse(res, `Patient with ID "${id}" not found`, 404);
    }

    const referrals = await prisma.referral.findMany({
      where:   { patientId: id },
      include: {
        // Include the full audit log of every status change on each referral
        events: {
          orderBy: { createdAt: 'asc' }, // Chronological order for lifecycle view
        },
      },
      orderBy: { createdAt: 'desc' }, // Most recently created referrals first
    });

    return successResponse(
      res,
      { patientId: id, referrals },
      'Patient referrals fetched successfully'
    );
  } catch (error) {
    next(error);
  }
};

// =============================================================================
// LIST PATIENTS (PAGINATED)
// =============================================================================

/**
 * GET /api/patients
 *
 * Returns a paginated list of patients with optional filters.
 *
 * Query parameters:
 *   ?village=        — Filter patients by village name (case-insensitive)
 *   ?assignedAshaId= — Filter patients by their assigned ASHA worker ID
 *   ?search=         — Search by patient name OR phone number (case-insensitive)
 *   ?triageLevel=    — Only patients whose latest assessment has this level:
 *                      EMERGENCY | REFER_SOON | WATCH | ROUTINE (else 400)
 *   ?page=1         — Page number (default: 1)
 *   ?limit=20        — Results per page (default: 20, max: 100)
 *
 * Response includes pagination metadata (total count, current page, total pages)
 * so the frontend can render pagination controls.
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
const listPatients = async (req, res, next) => {
  try {
    const { village, assignedAshaId, search, triageLevel } = req.query;

    // ── Pagination ────────────────────────────────────────────────────────────
    const page  = Math.max(1, parseInt(req.query.page,  10) || 1);    // min page = 1
    const limit = Math.min(100, parseInt(req.query.limit, 10) || 20); // max limit = 100
    const skip  = (page - 1) * limit; // How many records to skip

    // ── Build Filters ─────────────────────────────────────────────────────────
    // Prisma's 'where' clause supports AND logic by default.
    // We only add conditions that were actually provided in the query string.
    const where = {};

    if (village) {
      // Case-insensitive village filter using Prisma's mode: 'insensitive'
      where.village = { contains: village, mode: 'insensitive' };
    }

    if (assignedAshaId) {
      where.assignedAshaId = assignedAshaId;
    }

    if (search) {
      // Full-text search across name and phone fields (OR logic)
      where.OR = [
        { name:  { contains: search, mode: 'insensitive' } },
        { phone: { contains: search, mode: 'insensitive' } },
      ];
    }

    // ?triageLevel= → patients whose LATEST assessment has that (phone-computed) level.
    // "Latest" = most recent completedAt (the phone's time), newest createdAt breaking ties.
    // Prisma cannot filter on "the latest related row", so one raw query finds the ids.
    if (triageLevel !== undefined) {
      if (!VALID_TRIAGE_LEVELS.includes(triageLevel)) {
        return errorResponse(
          res,
          `Invalid triageLevel. Valid values: ${VALID_TRIAGE_LEVELS.join(', ')}`,
          400
        );
      }
      const latest = await prisma.$queryRaw`
        SELECT "patientId" FROM (
          SELECT DISTINCT ON ("patientId") "patientId", "triageLevel"
          FROM "assessments"
          ORDER BY "patientId", "completedAt" DESC, "createdAt" DESC, "id" DESC
        ) AS latest
        WHERE "triageLevel" = ${triageLevel}::"AssessmentTriageLevel"`;
      where.id = { in: latest.map((row) => row.patientId) };
    }

    // ── Execute Query + Count ─────────────────────────────────────────────────
    // Run both queries in parallel for better performance
    const [patients, totalCount] = await prisma.$transaction([
      prisma.patient.findMany({
        where,
        skip,
        take: limit,
        include: {
          assignedAsha: {
            select: { name: true, identifier: true, role: true },
          },
        },
        orderBy: { createdAt: 'desc' }, // Most recently registered first
      }),
      prisma.patient.count({ where }),
    ]);

    const totalPages = Math.ceil(totalCount / limit);

    return successResponse(
      res,
      {
        patients,
        pagination: {
          total:       totalCount,
          page,
          limit,
          totalPages,
          hasNextPage: page < totalPages,
          hasPrevPage: page > 1,
        },
      },
      'Patients fetched successfully'
    );
  } catch (error) {
    next(error);
  }
};

// =============================================================================
// EXPORTS
// =============================================================================

module.exports = {
  createPatient,
  getPatient,
  updatePatient,
  getPatientTimeline,
  getPatientAssessments,
  getPatientFollowUps,
  getPatientReferrals,
  listPatients,
};
