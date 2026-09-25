/**
 * src/controllers/syncController.js
 * ------------------------------------
 * Data synchronization between the ASHA worker's offline Android app (Room /
 * SQLite) and the central PostgreSQL server.
 *
 * Why sync?
 * ASHA workers operate in villages with poor internet. They create records
 * offline (patients, home visits, vitals, follow-ups) and sync when
 * connectivity returns.
 *   - Upload   → phone sends locally created / edited records.
 *   - Download → phone fetches what changed on the server (doctor actions,
 *                referral status changes, new follow-ups...).
 *
 * ── Key design decisions (v2) ────────────────────────────────────────────────
 *
 * 1. CLIENT-GENERATED UUIDs ARE THE REAL IDs.
 *    The phone generates a UUID v4 for each new record and that UUID becomes
 *    the primary key on the server. There is no local-id ↔ server-id mapping
 *    table, so records created offline in the same batch can reference each
 *    other (a vitals row can point at the encounter created 5 minutes earlier)
 *    before the server has ever seen either. Records created on the web keep
 *    their cuid ids — an id is just a string.
 *
 * 2. IDEMPOTENT. Re-sending the same batch (network dropped before the phone
 *    saw the response) never creates duplicates and never duplicates timeline
 *    events: a record that already exists is never re-created, and timeline
 *    events are only written when the row is actually created / changed.
 *
 * 3. PER-RECORD RESULTS. Each record is processed in its own database
 *    transaction (row + its timeline events commit or roll back together).
 *    One bad record never blocks the others, and the response says exactly
 *    which records the phone may mark as synced.
 *
 * 4. OPTIMISTIC CONCURRENCY instead of comparing clocks.
 *    Phone clocks drift, so we never compare a phone timestamp with a server
 *    timestamp. Instead, every record the server hands out carries its
 *    `updatedAt`. To edit an EXISTING record the phone sends that value back as
 *    `baseUpdatedAt` ("this is the version I edited"). The server updates only
 *    if the row is still at that version:
 *
 *        UPDATE ... WHERE id = ? AND updatedAt = baseUpdatedAt
 *
 *    0 rows changed → someone else (a doctor on the web, another phone) changed
 *    it in the meantime → status "conflict", nothing overwritten. The phone
 *    re-downloads the record and re-applies the user's change. The check and
 *    the write are one atomic statement, so there is no race window.
 *    Every "ok" result returns the record's new `updatedAt` so the phone can
 *    store it as its next baseUpdatedAt. Creates don't need one.
 *
 *    A "conflict" result also carries `serverRecord` — the server's current
 *    copy of the row — so the phone can replace its local copy immediately.
 *
 *    THE "LOST RESPONSE" CASE. Suppose the phone creates a record, the server
 *    saves it, but the response never arrives. The phone doesn't know the
 *    record's updatedAt, so when the ASHA edits it offline and resyncs, it
 *    sends an existing record WITHOUT baseUpdatedAt. Every row therefore stores
 *    `lastModifiedById` (who last wrote it, web or sync). With no
 *    baseUpdatedAt the server decides like this:
 *        - same content as the server row            → ok (pure retry)
 *        - different, and lastModifiedById == caller → the caller's own last
 *          write is what's on the server, so nobody else has touched it:
 *          apply the edit (still a compare-and-set on the row's current
 *          updatedAt, so a write racing in between is caught)
 *        - different, someone else last modified it  → conflict
 *
 * 5. THE SERVER OWNS THE CLINICAL WORKFLOW. Referrals are created and moved
 *    through their lifecycle only by doctors/specialists/hospital admins on the
 *    web, so they are NOT uploadable from the phone — download only.
 *    Prescriptions are doctor-created too: download only.
 *
 * 6. AUTHORIZATION. An ASHA/ANM may only touch patients assigned to her, and
 *    only follow-ups assigned to her. Ownership is always checked through the
 *    patient, and a record's patientId can never be changed by an update.
 *    SYSTEM_ADMIN bypasses ownership (this is also what the AUTH_ENABLED=false
 *    dev user is).
 *
 * 7. SAME TIMELINE AS THE WEB. Timeline events come from src/utils/timeline.js,
 *    the same helper the regular endpoints use, so synced records show up in
 *    GET /api/patients/:id/timeline exactly like web-created ones. Events are
 *    stamped with the record's own (offline) time, not the sync time.
 *
 *   prisma.patient / encounter / vitals / followUp / prescription / referral /
 *   facility → the matching models in prisma/schema.prisma
 */

const { Prisma } = require('@prisma/client');

const prisma = require('../config/db');
const { successResponse, errorResponse } = require('../utils/responseHelper');
const {
  isUuid,
  patientSchema,
  encounterSchema,
  vitalsSchema,
  assessmentSchema,
  followupSchema,
  uploadEnvelopeSchema,
  formatZodError,
} = require('../utils/syncValidation');
// The existing server-side rule engine (Person 5). Called, never modified — see computeServerTriage.
const { assessTriage } = require('../services/triageService');
const {
  logPatientRegistered,
  logHighRiskFlagged,
  logEncounterCreated,
  buildVitalsSummary,
  logVitalsRecorded,
  logAssessmentCompleted,
  logFollowUpScheduled,
  logFollowUpStatusChange,
} = require('../utils/timeline');

// =============================================================================
// Small helpers
// =============================================================================

/**
 * An EXPECTED, user-facing failure for one record (bad input, not your patient,
 * missing parent...). Its message goes straight back to the phone in the
 * per-record result. Anything else that is thrown is treated as an internal
 * error and its details are logged, not returned.
 */
class RecordError extends Error {}

/** Same message for "doesn't exist" and "isn't yours" so ids can't be probed. */
const NOT_YOURS = (what, id) => `${what} "${id}" was not found or is not assigned to you.`;

/** Normalises a value so Dates, arrays and null/undefined compare by content. */
const normalise = (v) => {
  if (v instanceof Date) return v.getTime();
  if (Array.isArray(v)) return JSON.stringify(v);
  // Json columns (assessment answers). Postgres jsonb does not keep key order, so
  // compare with the keys sorted, or an identical retry would look like a change.
  if (v !== null && typeof v === 'object') return canonicalJson(v);
  return v === undefined ? null : v;
};
const canonicalJson = (v) => {
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`;
  if (v !== null && typeof v === 'object') {
    return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(v[k])}`).join(',')}}`;
  }
  return JSON.stringify(v);
};

/**
 * True if every field the phone sent already has that exact value on the
 * server row. This is what makes retries safe: re-sending a record the server
 * already holds is "unchanged" (→ ok), not a conflict and not a duplicate.
 */
const sameContent = (row, incoming) =>
  Object.entries(incoming).every(([k, v]) => v === undefined || normalise(row[k]) === normalise(v));

/** Throws if any of the listed fields are missing from a record being CREATED. */
const requireForCreate = (rec, fields) => {
  const missing = fields.filter((f) => rec[f] === undefined || rec[f] === null);
  if (missing.length) {
    throw new RecordError(`Missing required fields for a new record: ${missing.join(', ')}`);
  }
};

/** New records must carry a client-generated UUID (cuids are server-minted). */
const requireUuidForCreate = (id) => {
  if (!isUuid(id)) {
    throw new RecordError(
      `Record "${id}" does not exist on the server, so it must be created with a UUID id. ` +
        'Server-generated ids can only be used to update records the server already has.'
    );
  }
};

/**
 * Loads a patient and enforces "this ASHA/ANM may only touch her own patients".
 * Runs inside the record's transaction, so the check and the write see the same data.
 */
const getAccessiblePatient = async (tx, ctx, patientId) => {
  const patient = await tx.patient.findUnique({ where: { id: patientId } });
  if (!patient || (!ctx.isAdmin && patient.assignedAshaId !== ctx.user.id)) {
    throw new RecordError(NOT_YOURS('Patient', patientId));
  }
  return patient;
};

/**
 * Optimistic-concurrency update (see design note 4 at the top of the file).
 *
 * @param {string} model       Prisma model delegate name, e.g. 'patient'
 * @param {object} existing    The row as currently stored
 * @param {Date|undefined} baseUpdatedAt  The version the phone edited (may be absent)
 * @param {object} comparable  Fields the phone is asking to set (compared + written)
 * @param {object} derived     Extra server-computed fields written but NOT compared
 *                             (e.g. completedAt = now), so retries stay idempotent
 * @param {string} userId      The authenticated user; recorded as lastModifiedById
 * @returns {{kind: 'unchanged'|'updated'|'conflict', row: object, message?: string}}
 */
const applyOptimisticUpdate = async (tx, model, existing, baseUpdatedAt, comparable, derived, userId) => {
  // Nothing to change → the phone's copy already matches the server's.
  if (sameContent(existing, comparable)) {
    return { kind: 'unchanged', row: existing };
  }

  // Which server version is the phone's edit based on?
  let expectedUpdatedAt = baseUpdatedAt;
  let requireSameModifier = false;

  if (!expectedUpdatedAt) {
    if (existing.lastModifiedById === userId) {
      // Lost-response case: the last write on this row is the caller's own, so
      // nobody else has touched it. Base the edit on the version we hold now.
      expectedUpdatedAt = existing.updatedAt;
      requireSameModifier = true;
    } else {
      return {
        kind: 'conflict',
        row: existing,
        message:
          'This record was changed on the server by someone else and no baseUpdatedAt was sent. ' +
          'Nothing was overwritten. Replace your local copy with serverRecord and re-apply your change.',
      };
    }
  }

  // Atomic compare-and-set: only writes if nobody changed the row since the expected version.
  const { count } = await tx[model].updateMany({
    where: {
      id: existing.id,
      updatedAt: expectedUpdatedAt,
      ...(requireSameModifier ? { lastModifiedById: userId } : {}),
    },
    data: { ...comparable, ...derived, lastModifiedById: userId },
  });

  const row = await tx[model].findUnique({ where: { id: existing.id } });
  if (count === 0) {
    return {
      kind: 'conflict',
      row,
      message:
        'The server copy changed after the version you edited (baseUpdatedAt no longer matches). ' +
        'Nothing was overwritten. Replace your local copy with serverRecord and re-apply your change.',
    };
  }
  return { kind: 'updated', row };
};

/**
 * Maps the outcome of a handler to the per-record result body.
 * A conflict includes `serverRecord` (the server's current row, same shape as
 * the download endpoint returns) so the phone can overwrite its local copy.
 */
const toOutcome = ({ kind, row, message }) =>
  kind === 'conflict'
    ? { status: 'conflict', updatedAt: row.updatedAt.toISOString(), message, serverRecord: row }
    : { status: 'ok', updatedAt: row.updatedAt.toISOString() };

// =============================================================================
// Record handlers — one per record type.
// Each runs INSIDE the record's own $transaction and returns an outcome object.
// A thrown RecordError becomes { status: 'error' } for that record only.
// =============================================================================

// ── PATIENT ──────────────────────────────────────────────────────────────────
const handlePatient = async (tx, rec, ctx) => {
  const existing = await tx.patient.findUnique({ where: { id: rec.id } });

  // ── Update an existing patient ─────────────────────────────────────────────
  if (existing) {
    if (!ctx.isAdmin && existing.assignedAshaId !== ctx.user.id) {
      throw new RecordError(NOT_YOURS('Patient', rec.id));
    }
    // Reassigning a patient is a coordinator decision, not something a phone can do.
    if (
      !ctx.isAdmin &&
      rec.assignedAshaId !== undefined &&
      rec.assignedAshaId !== existing.assignedAshaId
    ) {
      throw new RecordError('assignedAshaId cannot be changed from the mobile app.');
    }

    const result = await applyOptimisticUpdate(tx, 'patient', existing, rec.baseUpdatedAt, {
      name: rec.name,
      dateOfBirth: rec.dateOfBirth,
      gender: rec.gender,
      phone: rec.phone,
      address: rec.address,
      village: rec.village,
      district: rec.district,
      state: rec.state,
      category: rec.category,
      lmpDate: rec.lmpDate,
      isHighRisk: rec.isHighRisk,
      riskReasons: rec.riskReasons,
    }, {}, ctx.user.id);

    // Doctors are told about a patient only on the false → true transition.
    if (result.kind === 'updated' && !existing.isHighRisk && result.row.isHighRisk) {
      await logHighRiskFlagged(tx, result.row);
    }
    return toOutcome(result);
  }

  // ── Create a new patient ───────────────────────────────────────────────────
  requireUuidForCreate(rec.id);
  requireForCreate(rec, ['name', 'dateOfBirth', 'gender', 'village', 'district', 'state']);

  // Default the owner to the syncing ASHA; refuse to create patients for someone else.
  const assignedAshaId = rec.assignedAshaId ?? ctx.user.id;
  if (!ctx.isAdmin && assignedAshaId !== ctx.user.id) {
    throw new RecordError('You can only create patients assigned to yourself.');
  }

  const patient = await tx.patient.create({
    data: {
      id: rec.id,
      syncId: rec.id, // legacy column kept for backward compat; sync no longer depends on it
      name: rec.name,
      dateOfBirth: rec.dateOfBirth,
      gender: rec.gender,
      phone: rec.phone ?? null,
      address: rec.address ?? null,
      village: rec.village,
      district: rec.district,
      state: rec.state,
      assignedAshaId,
      category: rec.category, // undefined → DB default GENERAL
      lmpDate: rec.lmpDate ?? null,
      isHighRisk: rec.isHighRisk ?? false,
      riskReasons: rec.riskReasons ?? [],
      createdAt: rec.createdAt, // undefined → now()
      lastModifiedById: ctx.user.id,
    },
  });

  await logPatientRegistered(tx, patient, rec.createdAt);
  if (patient.isHighRisk) {
    await logHighRiskFlagged(tx, patient, rec.createdAt);
  }
  return toOutcome({ kind: 'created', row: patient });
};

// ── ENCOUNTER ────────────────────────────────────────────────────────────────
const handleEncounter = async (tx, rec, ctx) => {
  const existing = await tx.encounter.findUnique({ where: { id: rec.id } });

  // ── Update an existing encounter ───────────────────────────────────────────
  if (existing) {
    await getAccessiblePatient(tx, ctx, existing.patientId);
    if (rec.patientId !== undefined && rec.patientId !== existing.patientId) {
      throw new RecordError('patientId cannot be changed on an existing encounter.');
    }

    const result = await applyOptimisticUpdate(tx, 'encounter', existing, rec.baseUpdatedAt, {
      facilityId: rec.facilityId,
      encounterType: rec.encounterType,
      symptoms: rec.symptoms,
      clinicalNotes: rec.clinicalNotes,
      encounterDate: rec.encounterDate,
    }, {}, ctx.user.id);
    return toOutcome(result);
  }

  // ── Create a new encounter ─────────────────────────────────────────────────
  requireUuidForCreate(rec.id);
  requireForCreate(rec, ['patientId', 'encounterType']); // doctorId / facilityId are optional
  await getAccessiblePatient(tx, ctx, rec.patientId);

  const encounter = await tx.encounter.create({
    data: {
      id: rec.id,
      patientId: rec.patientId,
      doctorId: rec.doctorId ?? null,
      facilityId: rec.facilityId ?? null,
      encounterType: rec.encounterType,
      symptoms: rec.symptoms ?? [],
      clinicalNotes: rec.clinicalNotes ?? null,
      encounterDate: rec.encounterDate ?? new Date(), // honour the phone's visit time
      lastModifiedById: ctx.user.id,
    },
  });

  await logEncounterCreated(tx, encounter, encounter.encounterDate);
  return toOutcome({ kind: 'created', row: encounter });
};

// ── VITALS ───────────────────────────────────────────────────────────────────
const MEASUREMENT_FIELDS = ['temperature', 'heartRate', 'bpSystolic', 'bpDiastolic', 'oxygenSaturation', 'weight'];

const handleVitals = async (tx, rec, ctx) => {
  const existing = await tx.vitals.findUnique({ where: { id: rec.id } });

  // ── Update existing vitals ─────────────────────────────────────────────────
  if (existing) {
    await getAccessiblePatient(tx, ctx, existing.patientId);
    if (rec.patientId !== undefined && rec.patientId !== existing.patientId) {
      throw new RecordError('patientId cannot be changed on existing vitals.');
    }

    const result = await applyOptimisticUpdate(tx, 'vitals', existing, rec.baseUpdatedAt, {
      temperature: rec.temperature,
      heartRate: rec.heartRate,
      bpSystolic: rec.bpSystolic,
      bpDiastolic: rec.bpDiastolic,
      oxygenSaturation: rec.oxygenSaturation,
      weight: rec.weight,
      recordedAt: rec.recordedAt,
    }, {}, ctx.user.id);
    return toOutcome(result);
  }

  // ── Create new vitals ──────────────────────────────────────────────────────
  requireUuidForCreate(rec.id);
  requireForCreate(rec, ['patientId']);
  if (!MEASUREMENT_FIELDS.some((f) => rec[f] !== undefined && rec[f] !== null)) {
    throw new RecordError(`At least one measurement is required (${MEASUREMENT_FIELDS.join(', ')}).`);
  }
  await getAccessiblePatient(tx, ctx, rec.patientId);

  // Same integrity rule as the web endpoint: the encounter must exist and belong to this patient.
  if (rec.encounterId) {
    const encounter = await tx.encounter.findUnique({ where: { id: rec.encounterId } });
    if (!encounter || encounter.patientId !== rec.patientId) {
      throw new RecordError(`Encounter "${rec.encounterId}" does not exist for this patient.`);
    }
  }

  const vitals = await tx.vitals.create({
    data: {
      id: rec.id,
      patientId: rec.patientId,
      encounterId: rec.encounterId ?? null,
      temperature: rec.temperature ?? null,
      heartRate: rec.heartRate ?? null,
      bpSystolic: rec.bpSystolic ?? null,
      bpDiastolic: rec.bpDiastolic ?? null,
      oxygenSaturation: rec.oxygenSaturation ?? null,
      weight: rec.weight ?? null,
      recordedById: ctx.user.id, // always the authenticated user — never trusted from the payload
      recordedAt: rec.recordedAt, // undefined → now(); the phone's time when it sent one
      lastModifiedById: ctx.user.id,
    },
  });

  await logVitalsRecorded(tx, vitals, buildVitalsSummary(vitals), vitals.recordedAt);
  return toOutcome({ kind: 'created', row: vitals });
};

// ── ASSESSMENT ───────────────────────────────────────────────────────────────
// Same rules as vitals: ownership through the patient, UUID for new records,
// idempotent, baseUpdatedAt concurrency. patientId, encounterId, formId and
// formVersion identify WHAT was assessed and with which form, so they are fixed
// once created (an edit may change the answers and the phone's triage result).

/**
 * The server's own triage (existing rule engine, src/services/triageService.js),
 * run on the patient's latest vitals and — when the assessment is linked to an
 * encounter — that encounter's symptoms. Stored in serverTriage* and kept apart
 * from the phone's own triageLevel so the two are never confused.
 *
 * Returns nulls (not a made-up "LOW") when there is nothing to assess: the engine
 * reads vitals and symptoms only, and reports LOW for an empty input.
 * Never throws because of the engine: an assessment must sync even if triage can't run.
 */
const NO_SERVER_TRIAGE = { serverTriageLevel: null, serverTriageScore: null, serverTriageReasons: [] };

const computeServerTriage = async (tx, patientId, encounterId) => {
  const vitals = await tx.vitals.findFirst({ where: { patientId }, orderBy: { recordedAt: 'desc' } });
  const encounter = encounterId
    ? await tx.encounter.findUnique({ where: { id: encounterId }, select: { symptoms: true } })
    : null;
  const symptoms = encounter?.symptoms ?? [];
  if (!vitals && symptoms.length === 0) return NO_SERVER_TRIAGE;

  try {
    const result = assessTriage({
      vitals: vitals
        ? {
            temperature: vitals.temperature,
            heartRate: vitals.heartRate,
            bpSystolic: vitals.bpSystolic,
            bpDiastolic: vitals.bpDiastolic,
            oxygenSaturation: vitals.oxygenSaturation,
          }
        : {},
      symptoms,
    });
    return {
      serverTriageLevel: result.triageLevel,
      serverTriageScore: result.score,
      serverTriageReasons: [...result.reasons, ...result.redFlags.map((f) => `Red flag: ${f}`)],
    };
  } catch (err) {
    console.error('[Sync] Server-side triage failed; saving the assessment without it:', err);
    return NO_SERVER_TRIAGE;
  }
};

const handleAssessment = async (tx, rec, ctx) => {
  const existing = await tx.assessment.findUnique({ where: { id: rec.id } });

  // ── Update an existing assessment ──────────────────────────────────────────
  if (existing) {
    await getAccessiblePatient(tx, ctx, existing.patientId);
    if (rec.patientId !== undefined && rec.patientId !== existing.patientId) {
      throw new RecordError('patientId cannot be changed on an existing assessment.');
    }
    if (rec.encounterId !== undefined && rec.encounterId !== existing.encounterId) {
      throw new RecordError('encounterId cannot be changed on an existing assessment.');
    }
    if (rec.formId !== undefined && rec.formId !== existing.formId) {
      throw new RecordError('formId cannot be changed on an existing assessment.');
    }
    if (rec.formVersion !== undefined && rec.formVersion !== existing.formVersion) {
      throw new RecordError('formVersion cannot be changed on an existing assessment.');
    }

    // Server triage is derived (written, not compared), so an identical retry stays "unchanged".
    const serverTriage = await computeServerTriage(tx, existing.patientId, existing.encounterId);
    const result = await applyOptimisticUpdate(tx, 'assessment', existing, rec.baseUpdatedAt, {
      answers: rec.answers,
      score: rec.score,
      triageLevel: rec.triageLevel,
      triageReasons: rec.triageReasons,
      completedAt: rec.completedAt,
    }, serverTriage, ctx.user.id);
    return toOutcome(result);
  }

  // ── Create a new assessment ────────────────────────────────────────────────
  requireUuidForCreate(rec.id);
  requireForCreate(rec, ['patientId', 'formId', 'formVersion', 'answers', 'triageLevel', 'completedAt']);
  await getAccessiblePatient(tx, ctx, rec.patientId);

  // Same integrity rule as vitals: the encounter must exist and belong to this patient.
  if (rec.encounterId) {
    const encounter = await tx.encounter.findUnique({ where: { id: rec.encounterId } });
    if (!encounter || encounter.patientId !== rec.patientId) {
      throw new RecordError(`Encounter "${rec.encounterId}" does not exist for this patient.`);
    }
  }

  const serverTriage = await computeServerTriage(tx, rec.patientId, rec.encounterId ?? null);
  const assessment = await tx.assessment.create({
    data: {
      id: rec.id,
      patientId: rec.patientId,
      encounterId: rec.encounterId ?? null,
      formId: rec.formId,
      formVersion: rec.formVersion,
      answers: rec.answers,
      score: rec.score ?? null,
      triageLevel: rec.triageLevel,
      triageReasons: rec.triageReasons ?? [],
      completedAt: rec.completedAt, // the phone's time
      ...serverTriage,
      recordedById: ctx.user.id, // always the authenticated user — never trusted from the payload
      lastModifiedById: ctx.user.id,
    },
  });

  await logAssessmentCompleted(tx, assessment, assessment.completedAt);
  return toOutcome({ kind: 'created', row: assessment });
};

// ── FOLLOW-UP ────────────────────────────────────────────────────────────────
const handleFollowup = async (tx, rec, ctx) => {
  const existing = await tx.followUp.findUnique({ where: { id: rec.id } });

  // ── Update an existing follow-up ───────────────────────────────────────────
  // An ASHA may update status / outcome / notes on follow-ups ASSIGNED TO HER
  // (typically ones a doctor created on the web). Nothing else is editable.
  if (existing) {
    if (!ctx.isAdmin && existing.assignedToId !== ctx.user.id) {
      throw new RecordError(NOT_YOURS('Follow-up', rec.id));
    }
    if (rec.patientId !== undefined && rec.patientId !== existing.patientId) {
      throw new RecordError('patientId cannot be changed on an existing follow-up.');
    }

    // Marking COMPLETED without a completion time → the server records "now".
    // Kept out of the comparison so a retry of the same update stays idempotent.
    const derived = {};
    if (rec.status === 'COMPLETED' && existing.status !== 'COMPLETED' && rec.completedAt === undefined) {
      derived.completedAt = new Date();
    }

    const result = await applyOptimisticUpdate(
      tx,
      'followUp',
      existing,
      rec.baseUpdatedAt,
      {
        status: rec.status,
        outcome: rec.outcome,
        notes: rec.notes,
        completedAt: rec.completedAt,
      },
      derived,
      ctx.user.id
    );

    // Status moved to COMPLETED / MISSED / ESCALATED → same timeline event as the web PATCH.
    if (result.kind === 'updated' && result.row.status !== existing.status) {
      await logFollowUpStatusChange(
        tx,
        result.row,
        result.row.status,
        { outcome: result.row.outcome, notes: result.row.notes },
        result.row.status === 'COMPLETED' ? result.row.completedAt : undefined
      );
    }
    return toOutcome(result);
  }

  // ── Create a new follow-up ─────────────────────────────────────────────────
  requireUuidForCreate(rec.id);
  requireForCreate(rec, ['patientId', 'dueDate']);
  await getAccessiblePatient(tx, ctx, rec.patientId);

  const assignedToId = rec.assignedToId ?? ctx.user.id;
  if (!ctx.isAdmin && assignedToId !== ctx.user.id) {
    throw new RecordError('You can only create follow-ups assigned to yourself.');
  }

  // Linked records must exist and belong to the same patient.
  if (rec.relatedEncounterId) {
    const enc = await tx.encounter.findUnique({ where: { id: rec.relatedEncounterId } });
    if (!enc || enc.patientId !== rec.patientId) {
      throw new RecordError(`Encounter "${rec.relatedEncounterId}" does not exist for this patient.`);
    }
  }
  if (rec.relatedReferralId) {
    const ref = await tx.referral.findUnique({ where: { id: rec.relatedReferralId } });
    if (!ref || ref.patientId !== rec.patientId) {
      throw new RecordError(`Referral "${rec.relatedReferralId}" does not exist for this patient.`);
    }
  }

  // NOTE: unlike POST /api/followups we do NOT require dueDate to be in the
  // future — a follow-up scheduled offline may already be overdue by sync time.
  const status = rec.status ?? 'PENDING';
  const followUp = await tx.followUp.create({
    data: {
      id: rec.id,
      patientId: rec.patientId,
      relatedEncounterId: rec.relatedEncounterId ?? null,
      relatedReferralId: rec.relatedReferralId ?? null,
      assignedToId,
      dueDate: rec.dueDate,
      status,
      outcome: rec.outcome ?? null,
      notes: rec.notes ?? null,
      completedAt: rec.completedAt ?? (status === 'COMPLETED' ? new Date() : null),
      createdAt: rec.createdAt,
      lastModifiedById: ctx.user.id,
    },
  });

  await logFollowUpScheduled(tx, followUp, followUp.dueDate, followUp.assignedToId, rec.createdAt);
  // Already resolved offline (e.g. visited and completed before ever syncing)? Record that too.
  await logFollowUpStatusChange(
    tx,
    followUp,
    followUp.status,
    { outcome: followUp.outcome, notes: followUp.notes },
    followUp.completedAt ?? undefined
  );
  return toOutcome({ kind: 'created', row: followUp });
};

// =============================================================================
// Upload plumbing
// =============================================================================

/**
 * Processing order matters: parents must exist before children reference them.
 * patients → encounters → vitals → assessments → followups
 * (referrals/prescriptions are not uploadable). Assessments come after vitals so the
 * server-side triage that runs when one is saved can see vitals from the same batch.
 */
const UPLOAD_PIPELINE = [
  { key: 'patients', type: 'patient', schema: patientSchema, handler: handlePatient },
  { key: 'encounters', type: 'encounter', schema: encounterSchema, handler: handleEncounter },
  { key: 'vitals', type: 'vitals', schema: vitalsSchema, handler: handleVitals },
  { key: 'assessments', type: 'assessment', schema: assessmentSchema, handler: handleAssessment },
  { key: 'followups', type: 'followup', schema: followupSchema, handler: handleFollowup },
];

/** Record types the phone must not upload, with the reason returned per record. */
const REJECTED_UPLOAD_TYPES = [
  {
    key: 'referrals',
    type: 'referral',
    message:
      'Referrals cannot be uploaded from the mobile app. They are created and managed by ' +
      'doctors on the web portal and arrive on the phone through GET /api/sync/download.',
  },
  {
    key: 'prescriptions',
    type: 'prescription',
    message:
      'Prescriptions cannot be uploaded from the mobile app. They are issued by doctors and ' +
      'arrive on the phone through GET /api/sync/download.',
  },
];

/** Turns an unexpected exception into a safe, useful per-record message. */
const describeError = (err) => {
  if (err instanceof RecordError) return err.message;
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2003') {
      return 'A referenced record does not exist (check patientId, encounterId, doctorId or assigned user).';
    }
    if (err.code === 'P2002') {
      return 'A record with this id or unique key already exists.';
    }
  }
  // Don't leak database internals to the client — log them for us instead.
  console.error('[Sync] Unexpected error while saving a record:', err);
  return 'Internal error while saving this record.';
};

/**
 * Runs one record end-to-end: validate → transaction (write + timeline) → result.
 * Never throws — every failure becomes a { status: 'error' } result.
 */
const processRecord = async ({ type, schema, handler }, raw, ctx) => {
  const rawId = raw && typeof raw === 'object' ? raw.id : undefined;

  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return { type, id: rawId ?? null, status: 'error', message: formatZodError(parsed.error) };
  }
  const rec = parsed.data;

  // Two uploads racing on the same brand-new id: the loser gets a unique-violation.
  // Retrying once lets it see the winner's row and finish as an idempotent no-op.
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const outcome = await prisma.$transaction((tx) => handler(tx, rec, ctx), { timeout: 15000 });
      return { type, id: rec.id, ...outcome };
    } catch (err) {
      const isUniqueRace =
        err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002' && attempt === 1;
      if (isUniqueRace) continue;
      return { type, id: rec.id, status: 'error', message: describeError(err) };
    }
  }
};

// =============================================================================
// uploadOfflineData
// =============================================================================
/**
 * POST /api/sync/upload
 *
 * @requires Body: {
 *   deviceId: string,
 *   records: {
 *     patients?:   PatientRecord[],
 *     encounters?: EncounterRecord[],
 *     vitals?:     VitalsRecord[],
 *     assessments?: AssessmentRecord[],
 *     followups?:  FollowUpRecord[]
 *   }
 * }
 * @returns data: {
 *   results: [{ type, id, status: 'ok'|'conflict'|'error', updatedAt?, message? }],
 *   serverTimestamp: ISO string
 * }
 *   ok       → saved (or already identical on the server). Store `updatedAt` as the
 *              record's baseUpdatedAt and mark it synced.
 *   conflict → NOT saved; the server copy changed. `updatedAt` is the server's current
 *              version and `serverRecord` is the server's full current row. Replace the
 *              local copy with it, re-apply the user's edit, resend.
 *   error    → NOT saved; `message` says why (validation, ownership, missing parent...).
 *
 * @requires Auth: ASHA or ANM
 */
const uploadOfflineData = async (req, res, next) => {
  try {
    // Captured first so it reflects when this upload began.
    const serverTimestamp = new Date().toISOString();

    // ── Validate the envelope only (individual records are validated one by one) ──
    const envelope = uploadEnvelopeSchema.safeParse(req.body);
    if (!envelope.success) {
      return errorResponse(res, formatZodError(envelope.error), 400);
    }
    const { deviceId, records } = envelope.data;

    const ctx = { user: req.user, isAdmin: req.user.role === 'SYSTEM_ADMIN' };
    const results = [];

    // ── Process in dependency order, one transaction per record ───────────────
    for (const step of UPLOAD_PIPELINE) {
      for (const raw of records[step.key] || []) {
        results.push(await processRecord(step, raw, ctx));
      }
    }

    // ── Tell the phone loudly about record types it is not allowed to send ────
    for (const rejected of REJECTED_UPLOAD_TYPES) {
      for (const raw of records[rejected.key] || []) {
        results.push({
          type: rejected.type,
          id: raw && typeof raw === 'object' && raw.id ? raw.id : null,
          status: 'error',
          message: rejected.message,
        });
      }
    }

    const failed = results.filter((r) => r.status !== 'ok').length;
    return successResponse(
      res,
      { deviceId, results, serverTimestamp },
      failed === 0
        ? 'All records synced successfully.'
        : `Sync processed ${results.length} record(s); ${failed} need attention. Check each result's status.`
    );
  } catch (error) {
    // Total failure (e.g. database is down) — the phone keeps everything pending and retries.
    next(error);
  }
};

// =============================================================================
// downloadUpdates
// =============================================================================
/**
 * GET /api/sync/download?deviceId=X&lastSyncedAt=2026-09-01T00:00:00Z
 *
 * Returns FULL objects (every column the app needs to fill its local database)
 * for everything that changed since `lastSyncedAt`:
 *   patients assigned to this ASHA, and those patients' encounters, vitals,
 *   assessments, prescriptions and referrals (with their current status); follow-ups
 *   assigned to this ASHA; and the facilities list.
 *
 * "Changed" means `updatedAt > lastSyncedAt` on every table.
 * `lastSyncedAt` missing or "0" → everything (first sync after login).
 *
 * `serverTimestamp` is captured at the START of the request and the phone
 * should store it as its next `lastSyncedAt`. If we took it at the end, a row
 * written while the queries were running would be older than the timestamp yet
 * absent from the response, and the next sync would silently skip it.
 *
 * Every record's `updatedAt` is what the phone sends back as `baseUpdatedAt`
 * when it edits that record.
 *
 * @requires Query: deviceId; optional lastSyncedAt (ISO 8601, or "0")
 * @requires Auth: ASHA or ANM
 */
const downloadUpdates = async (req, res, next) => {
  try {
    // ⏱ Captured BEFORE any query runs (see note above).
    const serverTimestamp = new Date();

    const { deviceId, lastSyncedAt } = req.query;
    if (!deviceId) {
      return errorResponse(res, 'deviceId is required as a query parameter.', 400);
    }

    // Missing / "0" → epoch → "everything".
    const since =
      !lastSyncedAt || lastSyncedAt === '0' ? new Date(0) : new Date(lastSyncedAt);
    if (isNaN(since.getTime())) {
      return errorResponse(
        res,
        'Invalid lastSyncedAt. Use an ISO 8601 date (e.g. 2026-09-01T00:00:00Z) or "0" for a full sync.',
        400
      );
    }

    const changed = { updatedAt: { gt: since } };
    // Only this ASHA's patients (relation filter — no giant id list needed).
    const myPatient = { patient: { assignedAshaId: req.user.id } };

    const [patients, encounters, vitals, assessments, prescriptions, referrals, followups, facilities] =
      await Promise.all([
        prisma.patient.findMany({
          where: { assignedAshaId: req.user.id, ...changed },
          orderBy: { updatedAt: 'asc' },
        }),
        prisma.encounter.findMany({ where: { ...myPatient, ...changed }, orderBy: { updatedAt: 'asc' } }),
        prisma.vitals.findMany({ where: { ...myPatient, ...changed }, orderBy: { updatedAt: 'asc' } }),
        prisma.assessment.findMany({ where: { ...myPatient, ...changed }, orderBy: { updatedAt: 'asc' } }),
        prisma.prescription.findMany({ where: { ...myPatient, ...changed }, orderBy: { updatedAt: 'asc' } }),
        // Referral status is set by doctors/hospitals — the ASHA only ever reads it.
        prisma.referral.findMany({ where: { ...myPatient, ...changed }, orderBy: { updatedAt: 'asc' } }),
        prisma.followUp.findMany({
          where: { assignedToId: req.user.id, ...changed },
          orderBy: { updatedAt: 'asc' },
        }),
        prisma.facility.findMany({ where: changed, orderBy: { name: 'asc' } }),
      ]);

    return successResponse(
      res,
      {
        serverTimestamp: serverTimestamp.toISOString(), // phone stores this as its next lastSyncedAt
        deviceId,
        patients,
        encounters,
        vitals,
        assessments,
        prescriptions,
        referrals,
        followups,
        facilities,
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
