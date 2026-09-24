# ArogyaLink Backend — Person 3 Module
## Patient Records, Continuity & Follow-up Management

This is the central backend service for ArogyaLink. It manages the complete patient healthcare journey — from registration to follow-up completion.

---

## Quick Start (for all teammates)

### Prerequisites
- Node.js 18+
- PostgreSQL 15+ installed and running
- A database named `arogyalink` created in PostgreSQL

### Setup

```bash
# 1. Clone / pull the repo and go into the folder
cd ArogyaLink-Backend

# 2. Install dependencies
npm install

# 3. Copy the env template and fill in your PostgreSQL password
copy .env.example .env
# Open .env in VS Code and set your DATABASE_URL password

# 4. Generate Prisma client + run database migrations
npm run db:generate
npm run db:migrate        # local dev (creates migrations). On a shared/cloud DB use: npm run db:deploy

# 5. (Optional but recommended) load demo facilities + demo users
npm run db:seed

# 6. Start the development server
npm run dev
```

Server runs at: **http://localhost:3001**
Health check: **http://localhost:3001/health**

### Demo data & credentials (`npm run db:seed`)

The seed script is idempotent and loads **fictional** demo data only. Never run it against real data.

| Role | Login `identifier` | Password | Name |
|------|--------------------|----------|------|
| ASHA (main demo user) | `ASHA-DEMO-001` | `Demo@123` / `Demo@1234` | Sunita Patil |
| ASHA (second, access control) | `ASHA-DEMO-002` | `Demo@123` / `Demo@1234` | Rekha Jadhav |
| ASHA (third, field consultation) | `ASHA-DEMO-003` | `Demo@123` / `Demo@1234` | Kavita More |
| DOCTOR (primary PHC doctor) | `DOC-DEMO-001` | `Demo@123` / `Demo@1234` | Dr. Demo Kulkarni |
| DOCTOR (teleconsult doctor) | `DOC-DEMO-002` | `Demo@123` / `Demo@1234` | Dr. Sneha Deshmukh |

Login: `POST /api/auth/login` with `{ "identifier": "ASHA-DEMO-001", "password": "Demo@123", "role": "ASHA" }`.

It also creates 10 fictional health facilities in **Pune district, Maharashtra** with IDs like `PHC-DEMO-001`, `SC-DEMO-001`, `CHC-DEMO-001`, `DH-DEMO-001`, `MC-DEMO-001`.

### Automated sync test

```bash
npm run db:deploy && npm run db:seed   # once, against a THROWAWAY database
npm test                                # starts the server with AUTH_ENABLED=true and runs test/sync.test.js
```

> **Note:** `AUTH_ENABLED=false` in `.env` by default. All APIs work without a token during development. Set `AUTH_ENABLED=true` before the demo.

---

## Project Structure

```
ArogyaLink-Backend/
├── prisma/
│   ├── schema.prisma          ← Database schema (source of truth)
│   ├── migrations/            ← Prisma migrations (never edit old ones)
│   └── seed.js                ← Demo facilities + demo users
├── sqlite/
│   └── schema.sql             ← Note only: the Android app defines its schema in Room
├── test/
│   └── sync.test.js           ← End-to-end sync test (AUTH_ENABLED=true)
├── src/
│   ├── index.js               ← Express app entry point
│   ├── config/db.js           ← Prisma client
│   ├── middleware/
│   │   ├── auth.js            ← JWT verification + role-based access
│   │   └── errorHandler.js    ← Global error handler
│   ├── controllers/           ← Business logic
│   ├── routes/                ← API route definitions
│   └── utils/
│       ├── responseHelper.js  ← Standard response format
│       ├── timeline.js        ← Shared TimelineEvent helpers (web + sync use the same ones)
│       └── syncValidation.js  ← zod schemas for the sync upload contract
├── .env.example               ← Environment variable template
└── package.json
```

---

## API Reference

> **Base URL:** `http://localhost:3001/api`
> **Auth header (when AUTH_ENABLED=true):** `Authorization: Bearer <token>`

All responses follow this format:
```json
{
  "success": true,
  "message": "Description",
  "data": { ... },
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

---

### 🔐 Auth Routes

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/api/auth/login` | None | Login with role-specific ID |
| GET | `/api/auth/me` | Required | Get current logged-in user |
| POST | `/api/auth/register` | SYSTEM_ADMIN | Create a new user (healthcare worker) |

#### POST `/api/auth/login`
```json
Request:
{
  "identifier": "ASHA-MH-2024-001",
  "password": "securepassword",
  "role": "ASHA"
}

Response:
{
  "success": true,
  "data": {
    "token": "eyJhbGci...",
    "user": { "id": "...", "name": "Sunita Devi", "role": "ASHA", "identifier": "ASHA-MH-2024-001" }
  }
}
```

#### POST `/api/auth/register` (SYSTEM_ADMIN only)
```json
Request:
{
  "name": "Dr. Ramesh Kumar",
  "phone": "9876543210",
  "role": "DOCTOR",
  "identifier": "DOC-PHC-0091",
  "password": "securepassword"
}
```

---

### 👤 Patient Routes

| Method | Endpoint | Roles | Description |
|--------|----------|-------|-------------|
| POST | `/api/patients` | ASHA, ANM, DOCTOR | Register new patient |
| GET | `/api/patients` | DOCTOR, ADMIN, SPECIALIST | List patients (paginated) |
| GET | `/api/patients/:id` | All | Get patient details |
| PUT | `/api/patients/:id` | ASHA, ANM, DOCTOR | Update patient |
| GET | `/api/patients/:id/timeline` | All | Full chronological journey |
| GET | `/api/patients/:id/followups` | All | Patient's follow-ups |
| GET | `/api/patients/:id/referrals` | All | Patient's referrals |

#### POST `/api/patients`
```json
Request:
{
  "name": "Meena Sharma",
  "dateOfBirth": "1990-05-15",
  "gender": "FEMALE",
  "phone": "9876543210",
  "address": "House No 12, Near Temple",
  "village": "Rampur",
  "district": "Jaipur",
  "state": "Rajasthan",
  "assignedAshaId": "user_cuid_here"
}
```

**Optional ASHA-work fields** (accepted by `POST` and `PUT /api/patients`; purely additive):
`category` (`GENERAL` default, `PREGNANT`, `CHILD_UNDER_5`, `NCD`, `ELDERLY`), `lmpDate` (last menstrual period, ISO date), `isHighRisk` (boolean, default `false`), `riskReasons` (string array, e.g. `["BP >= 140/90"]`).
Risk is computed on the phone; the server only stores it. When `isHighRisk` goes false → true a `HIGH_RISK_FLAGGED` timeline event is created.

#### GET `/api/patients/:id/timeline`
```json
Response data (array of timeline events):
[
  {
    "id": "...",
    "eventType": "PATIENT_REGISTERED",
    "description": "Patient registered in the system",
    "referenceId": null,
    "createdAt": "2024-01-01T09:00:00Z"
  },
  {
    "eventType": "ENCOUNTER_CREATED",
    "description": "PHC consultation recorded",
    "referenceId": "encounter_id_here",
    "createdAt": "2024-01-02T10:30:00Z"
  },
  ...
]
```

#### GET `/api/patients?village=Rampur&search=Meena&page=1&limit=20`

---

### 🏥 Encounter Routes

| Method | Endpoint | Roles | Description |
|--------|----------|-------|-------------|
| POST | `/api/encounters` | ASHA, ANM, DOCTOR | Create encounter |
| GET | `/api/encounters/:id` | All | Get encounter with vitals & prescriptions |

#### POST `/api/encounters`
```json
Request:
{
  "patientId": "patient_cuid",
  "doctorId": "user_cuid",
  "facilityId": "facility_id_string",
  "encounterType": "PHC_VISIT",
  "symptoms": ["fever", "cough", "headache"],
  "clinicalNotes": "Patient presenting with mild fever for 3 days",
  "encounterDate": "2024-01-02T10:00:00Z"
}
```

Encounter types: `PHC_VISIT` | `TELECONSULTATION` | `EMERGENCY` | `FOLLOW_UP_VISIT`

---

### 📊 Vitals Routes

| Method | Endpoint | Roles | Description |
|--------|----------|-------|-------------|
| POST | `/api/vitals` | ASHA, ANM, DOCTOR | Record vitals |
| GET | `/api/vitals/encounter/:encounterId` | All | Get vitals for encounter |

#### POST `/api/vitals`
```json
Request:
{
  "patientId": "patient_cuid",
  "encounterId": "encounter_cuid",
  "temperature": 38.5,
  "heartRate": 88,
  "bloodPressureSystolic": 120,
  "bloodPressureDiastolic": 80,
  "oxygenSaturation": 97.5,
  "weight": 55.0
}
```

---

### 💊 Prescription Routes

| Method | Endpoint | Roles | Description |
|--------|----------|-------|-------------|
| POST | `/api/prescriptions` | DOCTOR, SPECIALIST | Create prescription |
| GET | `/api/prescriptions/:id` | All | Get prescription |
| GET | `/api/prescriptions/patient/:patientId` | All | All prescriptions for patient |

#### POST `/api/prescriptions`
```json
Request:
{
  "patientId": "patient_cuid",
  "encounterId": "encounter_cuid",
  "medicineDetails": [
    {
      "name": "Paracetamol",
      "dosage": "500mg",
      "frequency": "3 times a day",
      "duration": "5 days",
      "instructions": "After meals"
    }
  ],
  "instructions": "Rest for 3 days. Drink plenty of water."
}
```

---

### 🏨 Referral Routes

| Method | Endpoint | Roles | Description |
|--------|----------|-------|-------------|
| POST | `/api/referrals` | DOCTOR, SPECIALIST | Create referral |
| GET | `/api/referrals/:id` | All | Get referral + full event history |
| PATCH | `/api/referrals/:id/status` | DOCTOR, SPECIALIST, HOSPITAL_ADMIN | Update referral status |
| GET | `/api/referrals` | DOCTOR, SPECIALIST, HOSPITAL_ADMIN | List referrals for facility |

**Referral Lifecycle:**
```
CREATED → ACCEPTED → PATIENT_ARRIVED → TREATED → FOLLOW_UP_REQUIRED → COMPLETED
                  ↘ REJECTED
                                                                      ↘ CANCELLED
```

#### POST `/api/referrals`
```json
Request:
{
  "patientId": "patient_cuid",
  "encounterId": "encounter_cuid",
  "referringFacilityId": "PHC-RAMPUR-001",
  "receivingFacilityId": "HOSP-AIIMS-001",
  "reason": "Patient requires specialist cardiac evaluation",
  "priority": "HIGH"
}
```
Priorities: `LOW` | `MEDIUM` | `HIGH` | `EMERGENCY`

#### PATCH `/api/referrals/:id/status`
```json
Request:
{
  "newStatus": "ACCEPTED",
  "remarks": "Appointment scheduled for 5th Jan at 10am"
}
```

---

### 📅 Follow-up Routes

| Method | Endpoint | Roles | Description |
|--------|----------|-------|-------------|
| POST | `/api/followups` | DOCTOR, SPECIALIST | Schedule follow-up |
| GET | `/api/followups/assigned` | ASHA, ANM | My assigned follow-ups |
| GET | `/api/followups/overdue` | DOCTOR, SPECIALIST, ADMIN | Overdue/missed follow-ups |
| GET | `/api/followups/:id` | All | Get follow-up details |
| PATCH | `/api/followups/:id` | ASHA, ANM, DOCTOR | Update follow-up outcome |

#### POST `/api/followups`
```json
Request:
{
  "patientId": "patient_cuid",
  "relatedEncounterId": "encounter_cuid",
  "relatedReferralId": "referral_cuid",
  "assignedToId": "asha_user_cuid",
  "dueDate": "2024-01-15T09:00:00Z",
  "notes": "Check blood pressure and fever. Bring previous prescription."
}
```

#### PATCH `/api/followups/:id`
```json
Request:
{
  "status": "COMPLETED",
  "outcome": "Patient has recovered. Blood pressure normal.",
  "notes": "Advised to continue medicines for 2 more days."
}
```
Statuses: `IN_PROGRESS` | `COMPLETED` | `MISSED` | `ESCALATED` | `CANCELLED`

---

### 🏢 Facility Routes

| Method | Endpoint | Roles | Description |
|--------|----------|-------|-------------|
| GET | `/api/facilities` | Any authenticated role | List health facilities. Optional `?district=Pune` (case-insensitive) |

Response: `{ count, facilities: [{ id, name, type, district, state, latitude, longitude, phone }] }`
`type` is one of `SUB_CENTRE | PHC | CHC | DISTRICT_HOSPITAL | MEDICAL_COLLEGE`.
Referral / encounter facility fields are still **plain strings**, not foreign keys to this table.

---

### 📡 Sync Routes (Native Android app — Kotlin, Room, WorkManager)

| Method | Endpoint | Roles | Description |
|--------|----------|-------|-------------|
| POST | `/api/sync/upload` | ASHA, ANM | Upload records created/edited offline |
| GET | `/api/sync/download` | ASHA, ANM | Download everything that changed on the server |

All responses use the standard envelope `{ success, message, data, timestamp }`. Everything below describes `data`.

#### The rules in one page

1. **The phone's UUID is the record's id.** The app generates a UUID v4 for every new patient, encounter, vitals and follow-up. That UUID is the primary key on the server — there is no local-id ↔ server-id mapping. Records created in the same batch can therefore reference each other (`vitals.encounterId` → `encounter.id`) before the server has seen either.
2. **Existing records keep their ids.** Records created on the web have server-generated ids (cuid-style, e.g. `cmfx…`). Those are valid as `id` / foreign keys when *updating* or *referencing* something the server already has. A **new** record must have a UUID.
3. **Idempotent.** Re-sending a batch (e.g. the response was lost) never creates duplicates — not rows, not timeline events.
4. **Per-record results.** One bad record never blocks the others. Mark exactly the records whose result is `ok` as synced.
5. **Processing order** (fixed by the server): patients → encounters → vitals → follow-ups. Array order inside the request does not matter.
6. **What the phone can and cannot write**

| Record | Phone can create | Phone can update | Notes |
|--------|------------------|------------------|-------|
| Patient | ✅ (assigned to herself) | ✅ her own patients | `assignedAshaId` defaults to you; cannot be changed from the phone |
| Encounter | ✅ (incl. `HOME_VISIT`) | ✅ | `doctorId`, `facilityId` optional; `encounterDate` honoured |
| Vitals | ✅ | ✅ | `recordedAt` honoured; `recordedById` is always the logged-in user |
| Follow-up | ✅ (for her patients, assigned to herself) | ✅ **status / outcome / notes only**, on follow-ups assigned to her | past `dueDate` is fine offline |
| **Referral** | ❌ **doctors / specialists only (web)** | ❌ | **Download only.** Uploading one returns a per-record `error` |
| **Prescription** | ❌ doctors only | ❌ | **Download only** |

7. **Authorization.** An ASHA/ANM can only upload records for patients assigned to her (`assignedAshaId` = her user id). Anything else is a per-record `error`. `patientId` can never be changed by an update.

#### Conflict handling: `baseUpdatedAt` (optimistic concurrency)

Phone clocks drift, so the server **never compares a phone timestamp to a server timestamp**. Instead:

* Every record the server sends (download, or the `updatedAt` in an `ok` upload result) carries a server `updatedAt`. **Store it next to the record** in Room.
* To **edit an existing record**, send it back as `baseUpdatedAt` — "this is the version I edited".
* The server applies the edit only if the row is still at that version (`UPDATE … WHERE id = ? AND updatedAt = baseUpdatedAt` — one atomic statement, no race). If someone else (a doctor on the web, another phone) changed it meanwhile, nothing is overwritten and the result is `"conflict"`.
* **Creates don't need `baseUpdatedAt`.**
* On `conflict`: the result carries **`serverRecord`** — the server's current copy of the row (same fields as the download endpoint). Replace your local copy with it, re-apply the user's change on top, and resend with `baseUpdatedAt` = `serverRecord.updatedAt`.
* **Lost responses.** If a create succeeded but the response never arrived, the phone has no `updatedAt` for that record, so a later offline edit is sent **without** `baseUpdatedAt`. Every row stores `lastModifiedById` (who last wrote it, from the web or from sync), and for an existing record with no `baseUpdatedAt` the server decides:

| Situation | Result |
|-----------|--------|
| Same content as the server row (a plain retry) | `ok`, nothing rewritten |
| Different content, and `lastModifiedById` is **you** (nobody else has touched it since your own write) | the edit is **applied**, `ok` (still a compare-and-set on the row's current `updatedAt`, so a write racing in between is caught) |
| Different content, and **someone else** last modified it | `conflict` (+ `serverRecord`) |

Rules that stay server-authoritative: **referral status** (only doctors/hospitals move it), and any field an ASHA is not allowed to edit is simply ignored.

#### POST `/api/sync/upload`

Request (all four arrays optional; unknown fields are ignored):

```json
{
  "deviceId": "pixel-7-asha-001",
  "records": {
    "patients": [
      {
        "id": "3f2b8c1e-5d7a-4e9b-8a1c-2b6d4f7e9a10",
        "name": "Meena Sharma",
        "dateOfBirth": "1996-05-15",
        "gender": "FEMALE",
        "phone": "9876543210",
        "village": "Velhe", "district": "Pune", "state": "Maharashtra",
        "category": "PREGNANT",
        "lmpDate": "2026-06-01T00:00:00.000Z",
        "isHighRisk": true,
        "riskReasons": ["BP >= 140/90"],
        "createdAt": "2026-09-17T09:12:00.000Z"
      }
    ],
    "encounters": [
      {
        "id": "a1b2c3d4-0000-4000-8000-000000000001",
        "patientId": "3f2b8c1e-5d7a-4e9b-8a1c-2b6d4f7e9a10",
        "encounterType": "HOME_VISIT",
        "symptoms": ["headache", "blurred vision"],
        "clinicalNotes": "Routine ANC home visit",
        "encounterDate": "2026-09-18T10:30:00.000Z"
      }
    ],
    "vitals": [
      {
        "id": "a1b2c3d4-0000-4000-8000-000000000002",
        "patientId": "3f2b8c1e-5d7a-4e9b-8a1c-2b6d4f7e9a10",
        "encounterId": "a1b2c3d4-0000-4000-8000-000000000001",
        "bpSystolic": 150, "bpDiastolic": 95,
        "temperature": 37.2, "heartRate": 88, "oxygenSaturation": 97.5, "weight": 61.5,
        "recordedAt": "2026-09-18T10:41:00.000Z"
      }
    ],
    "followups": [
      {
        "id": "a1b2c3d4-0000-4000-8000-000000000003",
        "patientId": "3f2b8c1e-5d7a-4e9b-8a1c-2b6d4f7e9a10",
        "relatedEncounterId": "a1b2c3d4-0000-4000-8000-000000000001",
        "dueDate": "2026-09-20T00:00:00.000Z",
        "notes": "Recheck BP"
      }
    ]
  }
}
```

Field reference (creating):

* **Required** — patient: `id, name, dateOfBirth, gender, village, district, state`; encounter: `id, patientId, encounterType`; vitals: `id, patientId` + at least one measurement; follow-up: `id, patientId, dueDate`.
* **Optional** — patient: `phone, address, category (GENERAL|PREGNANT|CHILD_UNDER_5|NCD|ELDERLY), lmpDate, isHighRisk, riskReasons, createdAt`; encounter: `doctorId, facilityId, symptoms, clinicalNotes, encounterDate`; vitals: `encounterId, temperature, heartRate, bpSystolic, bpDiastolic, oxygenSaturation, weight, recordedAt`; follow-up: `relatedEncounterId, relatedReferralId, assignedToId (must be you), status, outcome, notes, completedAt, createdAt`.
* All timestamps are ISO-8601 strings.

Response:

```json
{
  "success": true,
  "message": "Sync processed 4 record(s); 1 need attention. Check each result's status.",
  "data": {
    "deviceId": "pixel-7-asha-001",
    "results": [
      { "type": "patient",   "id": "3f2b8c1e-…", "status": "ok", "updatedAt": "2026-09-20T08:15:02.114Z" },
      { "type": "encounter", "id": "a1b2c3d4-…01", "status": "ok", "updatedAt": "2026-09-20T08:15:02.131Z" },
      { "type": "vitals",    "id": "a1b2c3d4-…02", "status": "error", "message": "At least one measurement is required (temperature, heartRate, ...)." },
      { "type": "followup",  "id": "a1b2c3d4-…03", "status": "ok", "updatedAt": "2026-09-20T08:15:02.160Z" }
    ],
    "serverTimestamp": "2026-09-20T08:15:02.050Z"
  }
}
```

| `status` | Meaning | What the app does |
|----------|---------|-------------------|
| `ok` | Saved, **or** the server already had exactly this content. `updatedAt` = the record's current server version | Mark synced; store `updatedAt` as `baseUpdatedAt` |
| `conflict` | **Not saved** — the server copy changed after the version you edited. `updatedAt` = the server's current version, `serverRecord` = the server's full current row | Replace the local copy with `serverRecord`, re-apply the edit, resend with `baseUpdatedAt = serverRecord.updatedAt` |
| `error` | **Not saved** — `message` says why (validation, not your patient, missing parent, uploading a referral…) | Fix the data or surface it; don't retry unchanged |

The HTTP status is `200` whenever the request itself was valid, even if individual records failed — read `results`. It is `400` for a malformed envelope (no `deviceId`, `records` not an object), `401` for no/invalid token, `403` for the wrong role.

Editing an existing record (a follow-up the doctor created, downloaded earlier with `updatedAt: "2026-09-19T11:00:00.000Z"`):

```json
{ "deviceId": "pixel-7-asha-001",
  "records": { "followups": [
    { "id": "cmfx8k2p40001abcd1234efgh", "status": "COMPLETED", "outcome": "BP normal, patient well",
      "baseUpdatedAt": "2026-09-19T11:00:00.000Z" } ] } }
```

#### GET `/api/sync/download?deviceId=X&lastSyncedAt=ISO`

* `lastSyncedAt` missing or `"0"` → **everything** (first sync after login).
* Otherwise returns every row with `updatedAt > lastSyncedAt`.
* Returns **full objects** (every column) for: patients assigned to this ASHA; those patients' `encounters`, `vitals`, `prescriptions` and `referrals` (with current `status`); `followups` assigned to this ASHA; and `facilities`.

```json
{ "data": {
    "serverTimestamp": "2026-09-20T08:20:00.000Z",
    "deviceId": "pixel-7-asha-001",
    "patients": [ "…" ], "encounters": [ "…" ], "vitals": [ "…" ], "prescriptions": [ "…" ],
    "referrals": [ "…" ], "followups": [ "…" ], "facilities": [ "…" ] } }
```

* **Store `serverTimestamp` as the next `lastSyncedAt`.** The server captures it at the *start* of the request, so a row written while the queries run is never skipped by the next sync.
* Records you just uploaded come back too (their `updatedAt` moved). Upserting them into Room is harmless.
* Referrals are read-only on the phone — the ASHA sees the doctor/hospital's status here (`CREATED → ACCEPTED → PATIENT_ARRIVED → TREATED …`).
* Suggested safety margin: request with `lastSyncedAt = serverTimestamp − 5 s`. Row timestamps are assigned just before a row commits, so an in-flight write can, in theory, commit a few ms after a concurrent download's cut-off. Re-receiving a record is free (upsert); missing one is not.

#### Timeline

Every synced record creates the **same** timeline event as the equivalent web endpoint (`PATIENT_REGISTERED`, `ENCOUNTER_CREATED`, `VITALS_RECORDED`, `FOLLOWUP_SCHEDULED`, `FOLLOWUP_COMPLETED` / `MISSED` / `ESCALATED`), visible in `GET /api/patients/:id/timeline`. Events are stamped with the record's own time (`createdAt` / `encounterDate` / `recordedAt`), not the sync time, so late-synced visits appear in the right place.

When a patient's `isHighRisk` goes **false → true** (via sync or the regular patient endpoints) a **`HIGH_RISK_FLAGGED`** event is added, with the `riskReasons` in its description. This is how doctors notice high-risk patients.

---

## Integration Guide for Teammates

### Person 1 (ASHA Mobile App — native Android)
- Use the sync endpoints: `POST /api/sync/upload` and `GET /api/sync/download`
- The app defines its own schema in **Room**; this README's sync section is the contract
- Generate a **UUID v4** for every new record. It *is* the server id. Keep the server `updatedAt` per record and send it back as `baseUpdatedAt` when editing
- See the sync section above for the exact JSON format, statuses and conflict rules
- ASHAs cannot create referrals; they only see referral status via download

### Person 2 (Doctor Web Portal)
- Create encounters: `POST /api/encounters`
- Record vitals: `POST /api/vitals`
- Issue prescriptions: `POST /api/prescriptions`
- Schedule follow-ups: `POST /api/followups`
- View patient history: `GET /api/patients/:id/timeline`

### Person 4 (Smart Referral / AI)
# Smart Referral AI (Person 4)

## Overview

The Smart Referral AI is a hybrid facility matching and recommendation engine for the ArogyaLink platform. It automates the complex process of finding the best healthcare facility for a patient based on clinical requirements, location, availability, urgency, and even patient preferences (such as specialist gender).

This module is seamlessly integrated with the existing Referral Lifecycle engine. It is fully backward-compatible, meaning existing integrations that specify a destination facility directly will continue to function without any changes.

---

## 🔄 Supported Frontend Workflows

The API is designed to be highly flexible, supporting two distinct user experiences depending on how your frontend integrates with it:

### Workflow 1: System Auto-Creates (1-Step Process)
Designed for speed and automated routing (e.g., emergencies).
1. The frontend calls `POST /api/referrals` with patient coordinates and medical needs, but **omits** the `receivingFacilityId`.
2. The backend AI calculates the best facility and **automatically creates the referral** assigning the patient to that facility in a single step.
3. The response includes the created referral alongside the AI's explanation so the doctor knows where the patient was routed.

### Workflow 2: Doctor Reviews & Selects (2-Step Process)
Designed for when the doctor needs the final say (e.g., standard out-patient care).
1. The frontend calls `POST /api/facilities/recommend` with the patient's data.
2. The backend returns a ranked list of recommended facilities, but **does not** create a referral.
3. The UI displays this ranked list. The doctor reviews the AI's reasons and manually clicks to select a facility (even if it's the 2nd or 3rd best).
4. The frontend calls `POST /api/referrals` providing that specific `receivingFacilityId`. The backend bypasses the AI and creates the direct referral.

---

## 🧠 The AI Matching Algorithm

The Smart Referral Engine uses a 3-Phase approach to score and rank facilities.

### Phase 1: Rule-Based Eligibility Filter
Instantly excludes facilities that are strictly incapable of handling the patient.
- **Operational Status:** Excludes non-operational or closed facilities.
- **Emergency Capabilities:** If the priority is `EMERGENCY` or `emergency=true`, facilities without emergency services are immediately excluded.
- **Service Availability:** If a required service (e.g., "CARDIOLOGY") is explicitly marked as unavailable, the facility is excluded.

### Phase 2: Weighted Facility Scoring
Ranks all eligible facilities using highly configurable, weighted parameters:
- **Distance:** Calculated dynamically using the Haversine formula against the patient's coordinates.
- **Wait Time:** Penalizes facilities with notoriously long estimated waiting times.
- **Service & Specialist Availability:** Rewards facilities with the exact required department and active specialists.
- **Diagnostics/Resources:** Rewards facilities that have the specific machines/tests (e.g., MRI, ECG) required for the referral.

> **Dynamic Weight Profiles:** The engine supports dual scoring profiles (`STANDARD` and `EMERGENCY`). For emergency cases, the engine heavily prioritizes proximity and emergency capabilities while de-prioritizing generic wait times.

### Phase 3: Patient Preference & Explainability
- **Gender Preference Matching:** Identifies the highest-ranking facility that meets the patient's preferred specialist gender (Male/Female/Any) without compromising critical clinical rules.
- **Explainable AI:** Generates human-readable arrays explaining exactly *why* a facility received its score (e.g., `"15km from patient location"`, `"Gender preference matched: Female specialist available"`).

---

## 📡 API Reference

### 1. Create a Smart Referral
Submit referral requirements without a destination facility, and the AI will auto-select the best one.

**`POST /api/referrals`**
```json
{
  "patientId": "cuid_patient123",
  "encounterId": "cuid_encounter123",
  "referringFacilityId": "cuid_phc123",
  "reason": "Severe chest pain, requires immediate evaluation.",
  "priority": "HIGH",
  
  // --- Smart AI Parameters ---
  "patientLatitude": 25.57,
  "patientLongitude": 91.88,
  "requiredService": "CARDIOLOGY",
  "requiredSpecialist": "CARDIOLOGIST",
  "preferredSpecialistGender": "FEMALE", // Optional: "MALE" | "FEMALE" | "ANY"
  "requiredDiagnostics": ["ECG", "ECHO"]
}
```

#### Response Object
The AI will embed the recommendation directly into the referral response:
```json
{
  "success": true,
  "message": "Referral created successfully.",
  "data": {
    "referral": {
      "id": "cuid_referral123",
      "status": "CREATED",
      // ...
    },
    "recommendation": {
      "facilityName": "City General Hospital",
      "score": 92.5,
      "distanceKm": 12.3,
      "reasons": [
        "Required service \"CARDIOLOGY\" is available",
        "Gender preference matched: Female specialist available",
        "12.3 km from patient location",
        "Available diagnostics: ECG, ECHO"
      ]
    },
    "bestOverall": { ... },           // Mathematically highest score
    "bestMatchingGender": { ... },    // Highest score that matches the gender preference
    "alternatives": [ ... ]           // Runner-up facilities
  }
}
```

### 2. Preview Recommendations (No DB Write)
Used to populate UI dropdowns so a doctor can manually review the AI's suggestions before confirming a referral.

**`POST /api/facilities/recommend`**
```json
{
  "patientLatitude": 25.57,
  "patientLongitude": 91.88,
  "requiredService": "CARDIOLOGY",
  "preferredSpecialistGender": "FEMALE"
}
```

### 3. Facility Management (CRUD)
Standard REST endpoints to manage the facility directory, available exclusively to `HOSPITAL_ADMIN` and `SYSTEM_ADMIN`.
- `GET /api/facilities` (Search & Filter)
- `POST /api/facilities` (Create)
- `POST /api/facilities/:id/services`
- `POST /api/facilities/:id/specialists`
- `POST /api/facilities/:id/resources`

---

## ⚙️ Configuration & Tuning

The AI's priorities can be fine-tuned via `src/config/referralWeights.js`.

```javascript
module.exports = {
  REFERRAL_WEIGHTS: {
    STANDARD: {
      service:     0.30,
      specialist:  0.25,
      distance:    0.15,
      waitingTime: 0.10,
      emergency:   0.10,
      resources:   0.10,
    },
    EMERGENCY: {
      service:     0.25,
      specialist:  0.25,
      emergency:   0.25,
      distance:    0.15,
      waitingTime: 0.10,
      resources:   0.00,
    }
  }
}
```
*Note: Ensure all weight profiles sum to exactly 1.0 (100%).*

---

## 🧪 Testing

The AI logic is thoroughly unit-tested using Jest, simulating real-world patient scenarios without requiring a live database.

Run the test suite:
```bash
npm test
```

### Test Scenarios Covered:
1. Exact matches (Services, Resources, Specialists)
2. Emergency override rules
3. Filtering missing required services
4. Specialist absence penalties
5. Resource/Diagnostic absence penalties
6. Geographic distance penalties
7. Waiting time penalties
8. Absolute failure handling (0 eligible facilities)
9. **Gender Preference Prioritization** (Matching vs Fallback)

### Person 5 (Triage / Emergency)
- Create emergency encounters: `POST /api/encounters` with `encounterType: "EMERGENCY"`
- Create high-priority referrals: `POST /api/referrals` with `priority: "EMERGENCY"`
- Escalate follow-ups: `PATCH /api/followups/:id` with `status: "ESCALATED"`

### Person 6 (Medicine / Diagnostic / Service Availability & Notifications)

Person 6 extends the backend with healthcare resource availability and notification support so referral and facility workflows can check whether medicines, diagnostics, and services are currently available.

#### Medicine availability
- Maintains medicine master data through the `Medicine` model.
- Tracks facility-level stock/availability through `MedicineInventory`.
- Supports medicine metadata such as name, generic name, category, strength and unit.
- Inventory records include quantity and availability state, with timestamps for freshness.
- Medicine availability can be consumed as part of the combined facility resource availability flow.

#### Diagnostic availability
- Maintains diagnostic test definitions through `DiagnosticTest`.
- Tracks facility-level diagnostic availability through `DiagnosticAvailability`.
- Supports diagnostic metadata and availability status with timestamps.
- Diagnostic availability is exposed alongside medicine and service availability for facility/resource checks.

#### Service availability
- Maintains reusable service definitions through `Service`.
- Tracks real-time facility service availability through `ServiceAvailability`.
- Each availability record is unique per service/facility pair and includes a `lastUpdated` timestamp.
- This is intentionally separate from the existing `FacilityService` Smart Referral model so the two modules can coexist without replacing Person 4's facility-service data.

#### Notifications
- Provides `Notification` records linked optionally to a user and/or patient.
- Notification categories include follow-up due/overdue, referral updates, medicine unavailable, diagnostic unavailable, emergency escalation, teleconsultation scheduling and general notifications.
- Notification priorities are `LOW`, `MEDIUM`, `HIGH` and `URGENT`.
- Availability changes can generate notifications, allowing frontend clients to surface important resource changes.

#### Resource and availability API surface

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/medicines` | List medicines / availability information |
| POST | `/api/medicines` | Create or update medicine resource data |
| GET | `/api/diagnostics` | List diagnostic tests / availability information |
| POST | `/api/diagnostics` | Create or update diagnostic resource data |
| GET | `/api/services` | List services |
| POST | `/api/services` | Create a service |
| POST | `/api/services/availability` | Update facility service availability |
| GET | `/api/services/:id/availability` | Get availability for a service |
| GET | `/api/resources/:facilityId` | Get combined medicine, diagnostic and service availability for a facility |
| GET | `/api/notifications` | List notifications |
| GET | `/api/notifications/unread-count` | Get unread notification count |
| PATCH | `/api/notifications/:id/read` | Mark a notification as read |
| PATCH | `/api/notifications/read-all` | Mark all notifications as read |

> Availability responses include timestamps so clients can distinguish current information from stale resource data.

#### Module 6 integration notes
- Resource availability is facility-specific.
- Service availability uses `ServiceAvailability`; the Smart Referral `FacilityService` model remains intact.
- Notifications are stored in the database and can reference both a patient and a user.
- Module 6 is designed to feed resource availability into the broader referral/facility workflow.
- Use the existing authentication/authorization middleware when calling protected write endpoints.
---

## Role Permissions Summary

| Role | Can Do |
|------|--------|
| `ASHA` | Register patients, record vitals and home visits, update their follow-ups, sync offline data (cannot create referrals) |
| `ANM` | Same as ASHA |
| `DOCTOR` | Everything ASHA can + create encounters, prescriptions, referrals, follow-ups |
| `SPECIALIST` | Same as DOCTOR |
| `HOSPITAL_ADMIN` | Accept/update referral status, view facility referrals |
| `SYSTEM_ADMIN` | Full access + create users |

---

## Available npm Scripts

```bash
npm run dev          # Start server with auto-reload (nodemon)
npm run start        # Start server (production)
npm run db:generate  # Regenerate Prisma client after schema changes
npm run db:migrate   # Run database migrations (dev; creates new migrations)
npm run db:deploy    # Apply existing migrations (shared/cloud DB, CI)
npm run db:seed      # Load demo facilities + demo users
npm test             # End-to-end sync test (needs a seeded throwaway DB)
npm run db:studio    # Open Prisma Studio (visual DB browser)
```

---

## Common Issues

**"Cannot connect to database"**
→ Make sure PostgreSQL is running and your `DATABASE_URL` in `.env` is correct.

**"Table does not exist"**
→ Run `npm run db:migrate` to create all tables.

**"Prisma client not generated"**
→ Run `npm run db:generate` after any schema change.

**"401 Unauthorized" during testing**
→ Set `AUTH_ENABLED=false` in your `.env` file.
