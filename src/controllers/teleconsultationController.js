/**
 * src/controllers/teleconsultationController.js
 * -----------------------------------------------
 * Handles the full lifecycle of a teleconsultation request.
 *
 * Lifecycle (mirrors Referral pattern for team consistency):
 *   CREATED → ACCEPTED (roomId + Encounter created) / REJECTED / CANCELLED → COMPLETED
 *
 * Socket.io notifications:
 *   All real-time pushes use req.app.get("io") so no direct Socket.io import is
 *   needed here. The io instance is set in src/index.js via app.set("io", io).
 *
 * Encounter created on accept:
 *   encounterType: TELECONSULTATION
 *   doctorId:      the accepting doctor
 *   patientId:     from the request
 *   facilityId:    null (optional field on Encounter — teleconsult is virtual)
 *   symptoms:      [] (empty — doctor fills these in during the call)
 *   clinicalNotes: session reason
 *   encounterDate: now()
 */

const prisma = require('../config/db');
const { successResponse, errorResponse } = require('../utils/responseHelper');

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Generates a short, URL-safe room identifier. */
function generateRoomId() {
  return 'teleconsult-' + Math.random().toString(36).slice(2, 10);
}

/**
 * Roles that are allowed to receive (accept/reject) teleconsultation requests.
 * ASHA and ANM can request, but only clinical staff can accept.
 */
const CLINICAL_ROLES = ['DOCTOR', 'SPECIALIST', 'SYSTEM_ADMIN'];

/**
 * Roles that are allowed to create a teleconsultation request on behalf of a patient.
 */
const REQUESTER_ROLES = ['ASHA', 'ANM', 'DOCTOR', 'SPECIALIST', 'SYSTEM_ADMIN'];

/**
 * Same role check as `authorize()` in middleware/auth.js, but usable inline
 * inside a controller. Honors the AUTH_ENABLED=false dev bypass.
 */
function hasRole(req, allowedRoles) {
  if (process.env.AUTH_ENABLED === 'false') return true;
  return allowedRoles.includes(req.user.role);
}

// =============================================================================
// createRequest — POST /api/teleconsultations
// =============================================================================
/**
 * Creates a new teleconsultation request and notifies the target doctor/specialist
 * in real time via Socket.io.
 *
 * @requires Body: { patientId, doctorId, reason }
 * @requires Auth: ASHA | ANM | DOCTOR | SPECIALIST | SYSTEM_ADMIN
 */
const createRequest = async (req, res) => {
  try {
    if (!hasRole(req, REQUESTER_ROLES)) {
      return errorResponse(res, 'Only ASHA, ANM, DOCTOR, or SPECIALIST can create teleconsultation requests', 403);
    }

    const { patientId, doctorId, reason } = req.body;

    if (!patientId || !doctorId || !reason) {
      return errorResponse(res, 'Missing required fields: patientId, doctorId, reason', 400);
    }

    // Verify the patient exists.
    const patient = await prisma.patient.findUnique({ where: { id: patientId } });
    if (!patient) return errorResponse(res, 'Patient not found', 404);

    // Verify the target is a doctor or specialist.
    const doctor = await prisma.user.findFirst({
      where: { id: doctorId, role: { in: CLINICAL_ROLES } },
    });
    if (!doctor) return errorResponse(res, 'Doctor or Specialist not found', 404);

    // Prevent duplicate pending requests to the same doctor for the same patient.
    const existing = await prisma.teleconsultationRequest.findFirst({
      where: { patientId, doctorId, status: 'CREATED' },
      include: {
        patient:   { select: { id: true, name: true, village: true, district: true } },
        doctor:    { select: { id: true, name: true, role: true } },
        requester: { select: { id: true, name: true, role: true } },
      },
    });
    if (existing) {
      return successResponse(
        res,
        { request: existing },
        'A pending teleconsultation request already exists',
        200
      );
    }

    const request = await prisma.teleconsultationRequest.create({
      data: {
        patientId,
        doctorId,
        requesterId: req.user.id,
        reason,
        status: 'CREATED',
      },
      include: {
        patient:   { select: { id: true, name: true, village: true, district: true } },
        doctor:    { select: { id: true, name: true, role: true } },
        requester: { select: { id: true, name: true, role: true } },
      },
    });

    // Notify the doctor/specialist in real time if they're currently online.
    req.app.get('io')?.to(`user_${doctorId}`).emit('new-teleconsultation-request', request);

    return successResponse(res, { request }, 'Teleconsultation request created', 201);
  } catch (err) {
    console.error('[Teleconsult] createRequest error:', err.message);
    return errorResponse(res, 'Could not create teleconsultation request', 500);
  }
};

// =============================================================================
// acceptRequest — PATCH /api/teleconsultations/:id/accept
// =============================================================================
/**
 * Doctor/Specialist accepts the request:
 *   1. Sets status → ACCEPTED
 *   2. Generates a roomId
 *   3. Creates an Encounter record (encounterType: TELECONSULTATION)
 *   4. Logs an ENCOUNTER_CREATED timeline event
 *   5. Notifies the requester over Socket.io with the roomId
 *
 * @requires Auth: DOCTOR | SPECIALIST | SYSTEM_ADMIN
 */
const acceptRequest = async (req, res) => {
  try {
    if (!hasRole(req, CLINICAL_ROLES)) {
      return errorResponse(res, 'Only DOCTOR or SPECIALIST can accept requests', 403);
    }

    const where = process.env.AUTH_ENABLED === 'false' || req.user.role === 'SYSTEM_ADMIN'
      ? { id: req.params.id }
      : { id: req.params.id, doctorId: req.user.id };

    const request = await prisma.teleconsultationRequest.findFirst({
      where,
    });

    if (!request) return errorResponse(res, 'Teleconsultation request not found', 404);
    if (request.status !== 'CREATED') {
      return errorResponse(res, `Request is already ${request.status}`, 409);
    }

    const roomId = generateRoomId();

    // Create the clinical Encounter record.
    const encounter = await prisma.encounter.create({
      data: {
        patientId:     request.patientId,
        doctorId:      req.user.id,
        encounterType: 'TELECONSULTATION',
        symptoms:      [],
        clinicalNotes: `Teleconsultation session: ${request.reason}`,
        encounterDate: new Date(),
      },
    });

    const updated = await prisma.teleconsultationRequest.update({
      where: { id: request.id },
      data: {
        status:      'ACCEPTED',
        roomId,
        encounterId: encounter.id,
      },
      include: {
        patient:   { select: { id: true, name: true } },
        doctor:    { select: { id: true, name: true, role: true } },
        requester: { select: { id: true, name: true, role: true } },
      },
    });

    // Append ENCOUNTER_CREATED timeline event
    try {
      const { logEncounterCreated } = require('../utils/timeline');
      await logEncounterCreated(encounter);
    } catch (e) {
      console.warn('[Timeline] logEncounterCreated warning:', e.message);
    }

    // Push real-time notification to the requester's personal Socket.io room.
    const notificationPayload = {
      requestId:   updated.id,
      roomId,
      encounterId: encounter.id,
      doctor:      updated.doctor,
    };
    req.app.get('io')
      ?.to(`user_${request.requesterId}`)
      .emit('teleconsultation-accepted', notificationPayload);

    // Dispatch Person 6 notification
    try {
      const { createNotification } = require('../utils/notificationService');
      await createNotification({
        patientId: request.patientId,
        userId: request.requesterId,
        type: 'SYSTEM_ALERT',
        priority: 'HIGH',
        title: 'Teleconsultation Accepted',
        message: `Doctor ${req.user.name || 'Specialist'} accepted your teleconsultation request. Room ID: ${roomId}`,
        actionUrl: `/teleconsult?room=${roomId}`,
      });
    } catch (notifErr) {
      console.warn('⚠️ Notification warning:', notifErr.message);
    }

    return successResponse(res, { request: updated, encounter }, 'Teleconsultation accepted', 200);
  } catch (err) {
    console.error('[Teleconsult] acceptRequest error:', err.message);
    return errorResponse(res, 'Could not accept teleconsultation request', 500);
  }
};

// =============================================================================
// rejectRequest — PATCH /api/teleconsultations/:id/reject
// =============================================================================
const rejectRequest = async (req, res) => {
  try {
    if (!hasRole(req, CLINICAL_ROLES)) {
      return errorResponse(res, 'Only DOCTOR or SPECIALIST can reject requests', 403);
    }

    const where = process.env.AUTH_ENABLED === 'false' || req.user.role === 'SYSTEM_ADMIN'
      ? { id: req.params.id }
      : { id: req.params.id, doctorId: req.user.id };

    const request = await prisma.teleconsultationRequest.findFirst({
      where,
    });

    if (!request) return errorResponse(res, 'Teleconsultation request not found', 404);
    if (request.status !== 'CREATED') {
      return errorResponse(res, `Request is already ${request.status}`, 409);
    }

    const updated = await prisma.teleconsultationRequest.update({
      where: { id: request.id },
      data:  { status: 'REJECTED' },
    });

    req.app.get('io')
      ?.to(`user_${request.requesterId}`)
      .emit('teleconsultation-rejected', { requestId: updated.id, doctorId: req.user.id });

    return successResponse(res, { request: updated }, 'Teleconsultation request rejected', 200);
  } catch (err) {
    console.error('[Teleconsult] rejectRequest error:', err.message);
    return errorResponse(res, 'Could not reject teleconsultation request', 500);
  }
};

// =============================================================================
// cancelRequest — PATCH /api/teleconsultations/:id/cancel
// =============================================================================
const cancelRequest = async (req, res) => {
  try {
    const where = process.env.AUTH_ENABLED === 'false' || req.user.role === 'SYSTEM_ADMIN'
      ? { id: req.params.id }
      : { id: req.params.id, requesterId: req.user.id };

    const request = await prisma.teleconsultationRequest.findFirst({
      where,
    });

    if (!request) return errorResponse(res, 'Teleconsultation request not found', 404);
    if (request.status !== 'CREATED') {
      return errorResponse(res, `Cannot cancel a request that is already ${request.status}`, 409);
    }

    const updated = await prisma.teleconsultationRequest.update({
      where: { id: request.id },
      data:  { status: 'CANCELLED' },
    });

    req.app.get('io')
      ?.to(`user_${request.doctorId}`)
      .emit('teleconsultation-cancelled', { requestId: updated.id });

    return successResponse(res, { request: updated }, 'Teleconsultation request cancelled', 200);
  } catch (err) {
    console.error('[Teleconsult] cancelRequest error:', err.message);
    return errorResponse(res, 'Could not cancel teleconsultation request', 500);
  }
};

// =============================================================================
// completeRequest — PATCH /api/teleconsultations/:id/complete
// =============================================================================
const completeRequest = async (req, res) => {
  try {
    const where = process.env.AUTH_ENABLED === 'false' || req.user.role === 'SYSTEM_ADMIN'
      ? { id: req.params.id }
      : { id: req.params.id, doctorId: req.user.id };

    const request = await prisma.teleconsultationRequest.findFirst({
      where,
    });

    if (!request) return errorResponse(res, 'Teleconsultation request not found', 404);
    if (request.status !== 'ACCEPTED') {
      return errorResponse(res, 'Only ACCEPTED consultations can be marked complete', 409);
    }

    const updated = await prisma.teleconsultationRequest.update({
      where: { id: request.id },
      data:  { status: 'COMPLETED' },
    });

    return successResponse(res, { request: updated }, 'Teleconsultation marked as completed', 200);
  } catch (err) {
    console.error('[Teleconsult] completeRequest error:', err.message);
    return errorResponse(res, 'Could not complete teleconsultation request', 500);
  }
};

// =============================================================================
// getRequestById — GET /api/teleconsultations/:id
// =============================================================================
const getRequestById = async (req, res) => {
  try {
    const request = await prisma.teleconsultationRequest.findUnique({
      where: { id: req.params.id },
      include: {
        patient:   { select: { id: true, name: true, village: true, district: true, gender: true } },
        doctor:    { select: { id: true, name: true, role: true, phone: true } },
        requester: { select: { id: true, name: true, role: true } },
      },
    });

    if (!request) return errorResponse(res, 'Teleconsultation request not found', 404);

    return successResponse(res, { request }, 'Teleconsultation request fetched', 200);
  } catch (err) {
    console.error('[Teleconsult] getRequestById error:', err.message);
    return errorResponse(res, 'Could not fetch teleconsultation request', 500);
  }
};

// =============================================================================
// listIncoming — GET /api/teleconsultations/incoming
// =============================================================================
const listIncoming = async (req, res) => {
  try {
    if (!hasRole(req, CLINICAL_ROLES)) {
      return errorResponse(res, 'Only DOCTOR or SPECIALIST can view incoming requests', 403);
    }

    const where = process.env.AUTH_ENABLED === 'false' || req.user.role === 'SYSTEM_ADMIN'
      ? {}
      : { doctorId: req.user.id };

    if (req.query.status !== 'all') where.status = 'CREATED';

    const requests = await prisma.teleconsultationRequest.findMany({
      where,
      include: {
        patient:   { select: { id: true, name: true, village: true, district: true, gender: true, dateOfBirth: true } },
        requester: { select: { id: true, name: true, role: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    return successResponse(res, { requests }, 'Incoming teleconsultation requests fetched', 200);
  } catch (err) {
    console.error('[Teleconsult] listIncoming error:', err.message);
    return errorResponse(res, 'Could not fetch incoming requests', 500);
  }
};

// =============================================================================
// listMine — GET /api/teleconsultations/mine
// =============================================================================
const listMine = async (req, res) => {
  try {
    const where = process.env.AUTH_ENABLED === 'false' || req.user.role === 'SYSTEM_ADMIN'
      ? {}
      : { requesterId: req.user.id };

    const requests = await prisma.teleconsultationRequest.findMany({
      where,
      include: {
        patient: { select: { id: true, name: true } },
        doctor:  { select: { id: true, name: true, role: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    return successResponse(res, { requests }, 'Your teleconsultation requests fetched', 200);
  } catch (err) {
    console.error('[Teleconsult] listMine error:', err.message);
    return errorResponse(res, 'Could not fetch your requests', 500);
  }
};

module.exports = {
  createRequest,
  acceptRequest,
  rejectRequest,
  cancelRequest,
  completeRequest,
  getRequestById,
  listIncoming,
  listMine,
};
