/**
 * src/utils/syncValidation.js
 * ----------------------------
 * zod schemas for the mobile sync upload contract (POST /api/sync/upload).
 *
 * Design notes:
 *
 * • IDs — records created on the phone carry a client-generated UUID that
 *   becomes the server's primary key. But an ASHA will also sync records that
 *   were created on the web (patients, follow-ups) and have server-generated
 *   cuid IDs, so every id / foreign key accepts UUID **or** cuid here.
 *   The stricter "a NEW record must have a UUID" rule is enforced in the
 *   controller, because only it knows whether the row already exists.
 *
 * • Almost everything is optional in the schema. The same shape is used for
 *   creating a record (all required fields must be present — checked in the
 *   controller) and for updating one (partial payload is fine).
 *
 * • Unknown keys (e.g. the Room `syncStatus` column) are silently stripped, so
 *   the app can send its rows with minimal mapping.
 *
 * • `baseUpdatedAt` is the optimistic-concurrency token: the server `updatedAt`
 *   the phone last received for that record. Required to update an existing
 *   record; not needed to create one. See syncController.js.
 */

const { z } = require('zod');

// ─── ID formats ───────────────────────────────────────────────────────────────
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
// cuid v1 — what Prisma's @default(cuid()) generates for records created on the server.
const CUID_RE = /^c[a-z0-9]{24}$/;

const isUuid = (v) => typeof v === 'string' && UUID_RE.test(v);
const isCuid = (v) => typeof v === 'string' && CUID_RE.test(v);

const idSchema = z
  .string({ required_error: 'id is required', invalid_type_error: 'id must be a string' })
  .refine((v) => isUuid(v) || isCuid(v), { message: 'must be a UUID (or an existing server id)' });

// ─── Field building blocks ────────────────────────────────────────────────────
// ISO-8601 string → Date. (Strings only: the app should send ISO, never epoch ints.)
const dateSchema = z
  .string()
  .refine((v) => !isNaN(new Date(v).getTime()), { message: 'must be an ISO 8601 date string' })
  .transform((v) => new Date(v));

const optionalDate = dateSchema.optional();
const nullableDate = dateSchema.nullable().optional();
const optionalString = z.string().nullable().optional();

// ─── Enums (must match prisma/schema.prisma) ──────────────────────────────────
const GenderEnum = z.enum(['MALE', 'FEMALE', 'OTHER']);
const PatientCategoryEnum = z.enum(['GENERAL', 'PREGNANT', 'CHILD_UNDER_5', 'NCD', 'ELDERLY']);
const EncounterTypeEnum = z.enum([
  'PHC_VISIT',
  'TELECONSULTATION',
  'EMERGENCY',
  'FOLLOW_UP_VISIT',
  'HOME_VISIT',
]);
const FollowUpStatusEnum = z.enum([
  'PENDING',
  'IN_PROGRESS',
  'COMPLETED',
  'MISSED',
  'ESCALATED',
  'CANCELLED',
]);

// ─── Record schemas ───────────────────────────────────────────────────────────
const patientSchema = z.object({
  id: idSchema,
  baseUpdatedAt: optionalDate,
  name: z.string().min(1).optional(),
  dateOfBirth: optionalDate,
  gender: GenderEnum.optional(),
  phone: optionalString,
  address: optionalString,
  village: z.string().min(1).optional(),
  district: z.string().min(1).optional(),
  state: z.string().min(1).optional(),
  assignedAshaId: z.string().nullable().optional(),
  category: PatientCategoryEnum.optional(),
  lmpDate: nullableDate,
  isHighRisk: z.boolean().optional(),
  riskReasons: z.array(z.string()).optional(),
  createdAt: optionalDate, // when the ASHA registered the patient (offline time)
});

const encounterSchema = z.object({
  id: idSchema,
  baseUpdatedAt: optionalDate,
  patientId: idSchema.optional(),
  doctorId: z.string().nullable().optional(), // optional: ASHA home visits have no doctor
  facilityId: z.string().nullable().optional(),
  encounterType: EncounterTypeEnum.optional(),
  symptoms: z.array(z.string()).optional(),
  clinicalNotes: optionalString,
  encounterDate: optionalDate,
});

const vitalsSchema = z.object({
  id: idSchema,
  baseUpdatedAt: optionalDate,
  patientId: idSchema.optional(),
  encounterId: idSchema.nullable().optional(),
  temperature: z.number().nullable().optional(),
  heartRate: z.number().int().nullable().optional(),
  bpSystolic: z.number().int().nullable().optional(),
  bpDiastolic: z.number().int().nullable().optional(),
  oxygenSaturation: z.number().nullable().optional(),
  weight: z.number().nullable().optional(),
  recordedAt: optionalDate, // when the ASHA actually took the readings
});

const followupSchema = z.object({
  id: idSchema,
  baseUpdatedAt: optionalDate,
  patientId: idSchema.optional(),
  relatedEncounterId: idSchema.nullable().optional(),
  relatedReferralId: idSchema.nullable().optional(),
  assignedToId: z.string().nullable().optional(),
  dueDate: optionalDate,
  status: FollowUpStatusEnum.optional(),
  outcome: optionalString,
  notes: optionalString,
  completedAt: nullableDate,
  createdAt: optionalDate,
});

// ─── Request envelope ─────────────────────────────────────────────────────────
// Only the outer shape is validated here; each record is validated on its own
// inside the controller so one malformed row cannot reject the whole batch.
const uploadEnvelopeSchema = z.object({
  deviceId: z.string({ required_error: 'deviceId is required' }).min(1, 'deviceId is required'),
  records: z.object(
    {
      patients: z.array(z.unknown()).optional(),
      encounters: z.array(z.unknown()).optional(),
      vitals: z.array(z.unknown()).optional(),
      followups: z.array(z.unknown()).optional(),
      // Accepted only so we can reject them with a clear per-record message.
      referrals: z.array(z.unknown()).optional(),
      prescriptions: z.array(z.unknown()).optional(),
    },
    { required_error: 'records object is required', invalid_type_error: 'records must be an object' }
  ),
});

/** Turns a ZodError into one readable line: "name: Required; dateOfBirth: must be ..." */
const formatZodError = (error) =>
  error.issues.map((i) => (i.path.length ? `${i.path.join('.')}: ${i.message}` : i.message)).join('; ');

module.exports = {
  isUuid,
  isCuid,
  patientSchema,
  encounterSchema,
  vitalsSchema,
  followupSchema,
  uploadEnvelopeSchema,
  formatZodError,
};
