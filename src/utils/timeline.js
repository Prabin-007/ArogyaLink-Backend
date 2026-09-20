/**
 * src/utils/timeline.js
 * ----------------------
 * Shared TimelineEvent helpers.
 *
 * Why this file exists:
 * A patient's timeline (GET /api/patients/:id/timeline) must look the same no
 * matter HOW a record got into the system — through a regular REST endpoint
 * (web portal) or through the mobile sync upload. Previously the event type and
 * the human-readable description were written inline in each controller. They
 * now live here so both paths call the exact same code and can never drift.
 *
 * Every function that writes takes a Prisma client/transaction `tx` as its first
 * argument so the timeline row is created in the SAME transaction as the record
 * it describes (all-or-nothing).
 *
 * `occurredAt` (optional) stamps the event with when the thing actually
 * happened. Web endpoints omit it (event = now). Sync passes the phone's
 * timestamp so a record created offline on Monday and synced on Thursday still
 * sits in the right place on the timeline.
 *
 * ⚠️  The description strings below are copied verbatim from the original
 * controllers. Do not reword them — web clients render them as-is.
 */

// ─── Follow-up status → Timeline Event Type ───────────────────────────────────
// Only statuses that have a meaningful timeline entry are mapped.
const FOLLOWUP_STATUS_TO_TIMELINE_EVENT = {
  COMPLETED: 'FOLLOWUP_COMPLETED',
  MISSED: 'FOLLOWUP_MISSED',
  ESCALATED: 'FOLLOWUP_ESCALATED',
};

// ─── Core writer ──────────────────────────────────────────────────────────────
/**
 * Creates one TimelineEvent row.
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {{ patientId: string, eventType: string, referenceId?: string|null,
 *           description: string, occurredAt?: Date }} event
 */
const createTimelineEvent = (tx, { patientId, eventType, referenceId, description, occurredAt }) =>
  tx.timelineEvent.create({
    data: {
      patientId,
      eventType,
      referenceId,
      description,
      // Only override createdAt when the caller knows the real event time.
      ...(occurredAt ? { createdAt: occurredAt } : {}),
    },
  });

// ─── Patient ──────────────────────────────────────────────────────────────────
const logPatientRegistered = (tx, patient, occurredAt) =>
  createTimelineEvent(tx, {
    patientId: patient.id,
    eventType: 'PATIENT_REGISTERED',
    referenceId: patient.id, // The patient record IS the reference
    description: `Patient "${patient.name}" was registered in the ArogyaLink system.`,
    occurredAt,
  });

/**
 * HIGH_RISK_FLAGGED — call this only when isHighRisk goes false → true
 * (on create with isHighRisk=true, or on an update that flips it).
 * The risk reasons go in the description so a doctor reading the timeline
 * (or a dashboard built on it) sees WHY the patient was flagged.
 */
const logHighRiskFlagged = (tx, patient, occurredAt) => {
  const reasons = Array.isArray(patient.riskReasons) ? patient.riskReasons : [];
  return createTimelineEvent(tx, {
    patientId: patient.id,
    eventType: 'HIGH_RISK_FLAGGED',
    referenceId: patient.id,
    description: `Patient flagged as high risk.${reasons.length ? ` Reasons: ${reasons.join('; ')}` : ' No reasons recorded.'}`,
    occurredAt,
  });
};

// ─── Encounter ────────────────────────────────────────────────────────────────
const logEncounterCreated = (tx, encounter, occurredAt) =>
  createTimelineEvent(tx, {
    patientId: encounter.patientId,
    eventType: 'ENCOUNTER_CREATED',
    referenceId: encounter.id, // Link back to this specific encounter
    description: `A ${encounter.encounterType.replace(/_/g, ' ')} encounter was recorded.`,
    occurredAt,
  });

// ─── Vitals ───────────────────────────────────────────────────────────────────
/**
 * Builds the "Temp: 37°C, HR: 80 bpm, ..." summary.
 * Takes whatever values the caller has (raw request values on the web path,
 * stored values on the sync path) and keeps the original truthy-check logic.
 */
const buildVitalsSummary = ({ temperature, heartRate, bpSystolic, bpDiastolic, oxygenSaturation, weight }) =>
  [
    temperature && `Temp: ${temperature}°C`,
    heartRate && `HR: ${heartRate} bpm`,
    bpSystolic && bpDiastolic && `BP: ${bpSystolic}/${bpDiastolic} mmHg`,
    oxygenSaturation && `SpO2: ${oxygenSaturation}%`,
    weight && `Weight: ${weight} kg`,
  ]
    .filter(Boolean)
    .join(', ');

const logVitalsRecorded = (tx, vitals, measurementSummary, occurredAt) =>
  createTimelineEvent(tx, {
    patientId: vitals.patientId,
    eventType: 'VITALS_RECORDED',
    referenceId: vitals.id, // Link to the specific vitals record
    description: `Vitals recorded${measurementSummary ? ': ' + measurementSummary : ''}.`,
    occurredAt,
  });

// ─── Follow-up ────────────────────────────────────────────────────────────────
const logFollowUpScheduled = (tx, followUp, dueDate, assignedToId, occurredAt) =>
  createTimelineEvent(tx, {
    patientId: followUp.patientId,
    eventType: 'FOLLOWUP_SCHEDULED',
    referenceId: followUp.id,
    description: `Follow-up scheduled. Due: ${dueDate.toDateString()}.${assignedToId ? ` Assigned to worker ID: ${assignedToId}` : ''}`,
    occurredAt,
  });

/**
 * Writes the timeline event for a follow-up moving to COMPLETED / MISSED /
 * ESCALATED. Does nothing for other statuses (PENDING, IN_PROGRESS, CANCELLED
 * have no timeline entry).
 */
const logFollowUpStatusChange = async (tx, followUp, status, { outcome, notes }, occurredAt) => {
  const eventType = FOLLOWUP_STATUS_TO_TIMELINE_EVENT[status];
  if (!eventType) return null;

  const descriptionMap = {
    COMPLETED: `Follow-up completed. Outcome: ${outcome || 'Not recorded.'}`,
    MISSED: `Follow-up was missed. Notes: ${notes || 'No notes.'}`,
    ESCALATED: `Follow-up escalated — patient may be worsening. Needs clinical review. Notes: ${notes || 'No notes.'}`,
  };

  return createTimelineEvent(tx, {
    patientId: followUp.patientId,
    eventType,
    referenceId: followUp.id,
    description: descriptionMap[status],
    occurredAt,
  });
};

module.exports = {
  FOLLOWUP_STATUS_TO_TIMELINE_EVENT,
  createTimelineEvent,
  logPatientRegistered,
  logHighRiskFlagged,
  logEncounterCreated,
  buildVitalsSummary,
  logVitalsRecorded,
  logFollowUpScheduled,
  logFollowUpStatusChange,
};
