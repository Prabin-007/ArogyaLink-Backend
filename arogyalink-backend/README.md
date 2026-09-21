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
npm run db:migrate

# 5. Start the development server
npm run dev
```

Server runs at: **http://localhost:3001**
Health check: **http://localhost:3001/health**

> **Note:** `AUTH_ENABLED=false` in `.env` by default. All APIs work without a token during development. Set `AUTH_ENABLED=true` before the demo.

---

## Project Structure

```
ArogyaLink-Backend/
├── prisma/
│   └── schema.prisma          ← Database schema (source of truth)
├── sqlite/
│   └── schema.sql             ← SQLite schema for Person 1 (offline mobile)
├── src/
│   ├── index.js               ← Express app entry point
│   ├── config/db.js           ← Prisma client
│   ├── middleware/
│   │   ├── auth.js            ← JWT verification + role-based access
│   │   └── errorHandler.js    ← Global error handler
│   ├── controllers/           ← Business logic
│   ├── routes/                ← API route definitions
│   └── utils/
│       └── responseHelper.js  ← Standard response format
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

### 📡 Sync Routes (for Person 1 — Mobile App)

| Method | Endpoint | Roles | Description |
|--------|----------|-------|-------------|
| POST | `/api/sync/upload` | ASHA, ANM | Upload offline records to server |
| GET | `/api/sync/download` | ASHA, ANM | Download updates since last sync |

#### POST `/api/sync/upload`
```json
Request:
{
  "deviceId": "device_unique_id",
  "records": {
    "patients": [
      {
        "name": "Meena Sharma",
        "dateOfBirth": "1990-05-15",
        "gender": "FEMALE",
        "syncId": "local_unique_id_from_sqlite",
        ...
      }
    ],
    "encounters": [ ... ],
    "vitals": [ ... ],
    "prescriptions": [ ... ],
    "followups": [ ... ]
  }
}

Response:
{
  "success": true,
  "data": {
    "synced": {
      "patients": 3,
      "encounters": 2,
      "vitals": 2,
      "prescriptions": 1,
      "followups": 1
    },
    "errors": []
  }
}
```

#### GET `/api/sync/download?deviceId=X&lastSyncedAt=2024-01-01T00:00:00Z`

---

## Integration Guide for Teammates

### Person 1 (ASHA Mobile App)
- Use the sync endpoints: `POST /api/sync/upload` and `GET /api/sync/download`
- SQLite schema is available at `sqlite/schema.sql`
- Use `syncId` on patients to prevent duplicate uploads
- See sync section above for the exact JSON format

### Person 2 (Doctor Web Portal)
- Create encounters: `POST /api/encounters`
- Record vitals: `POST /api/vitals`
- Issue prescriptions: `POST /api/prescriptions`
- Schedule follow-ups: `POST /api/followups`
- View patient history: `GET /api/patients/:id/timeline`

### Person 4 (Smart Referral / AI)
- Create referrals: `POST /api/referrals`
- Use `priority: "EMERGENCY"` for urgent cases
- Track referral: `GET /api/referrals/:id`

### Person 5 (Triage / Emergency)
- Create emergency encounters: `POST /api/encounters` with `encounterType: "EMERGENCY"`
- Create high-priority referrals: `POST /api/referrals` with `priority: "EMERGENCY"`
- Escalate follow-ups: `PATCH /api/followups/:id` with `status: "ESCALATED"`

### Person 6 (Medicines / Notifications)
- Read prescriptions: `GET /api/prescriptions/patient/:patientId`
- Monitor follow-up status: `GET /api/followups/overdue`

---

## Role Permissions Summary

| Role | Can Do |
|------|--------|
| `ASHA` | Register patients, record vitals, update follow-ups, sync offline data |
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
npm run db:migrate   # Run database migrations
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
