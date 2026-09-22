# ArogyaLink — Teleconsultation Module (Backend)

This README covers **only the teleconsultation feature** of the ArogyaLink backend — the part of the codebase responsible for letting an ASHA/ANM/PHC doctor request a video consultation with a doctor/specialist, run the WebRTC video call signaling, and optionally provide live speech translation (Bhashini) during the call.

It does **not** cover patients, encounters, vitals, prescriptions, referrals, follow-ups, or offline sync — those belong to other modules in this same backend, built by other teammates.

---

## 1. What this module does

The teleconsultation module has three moving parts:

1. **REST API** — the request lifecycle (create → accept/reject/cancel → complete). This is plain HTTP, stored in Postgres via Prisma.
2. **Socket.io signaling server** — real-time push notifications + WebRTC offer/answer/ICE relay so two browsers can establish a peer-to-peer video/audio call.
3. **Bhashini speech-translation relay** — an optional service that takes short audio chunks from the patient's side, runs them through ASR → NMT (→ TTS), and pushes the translated transcript to everyone in the call room.

**Important:** Socket.io never carries video/audio itself. WebRTC connects the two browsers directly (peer-to-peer); Socket.io only relays small JSON signaling messages (SDP offers/answers, ICE candidates) and short base64 audio chunks for translation.

---

## 2. Tech stack

| Layer | Technology |
|---|---|
| Server | Node.js + Express 4 |
| Real-time | Socket.io 4 (WebSocket + polling fallback) |
| Database | PostgreSQL + Prisma ORM |
| Auth | JWT (`jsonwebtoken`) |
| Speech translation | Bhashini / ULCA / Dhruva government API (`axios`), with a built-in mock mode |
| Validation | (manual checks in controller — no schema validator on this route yet) |

---

## 3. File map (teleconsultation-relevant files only)

```
arogyalink-backend/
├── src/
│   ├── index.js                              ← wires HTTP server + Socket.io together, mounts routes
│   ├── controllers/
│   │   └── teleconsultationController.js     ← REST lifecycle logic (create/accept/reject/cancel/complete)
│   ├── routes/
│   │   ├── teleconsultationRoutes.js         ← /api/teleconsultations/*
│   │   └── teleconsultDoctorsRoutes.js       ← /api/teleconsult-doctors/*  (directory for the "call a doctor" picker)
│   ├── socket/
│   │   └── teleconsultationSocket.js         ← all Socket.io event handlers (register, join-room, offer/answer/ice, translation relay, end-call)
│   ├── services/
│   │   └── bhashiniService.js                ← Bhashini ASR→NMT→TTS integration + mock mode
│   ├── middleware/
│   │   └── auth.js                           ← authenticate() + authorize(...roles) used on every route
│   └── utils/
│       └── responseHelper.js                 ← successResponse()/errorResponse() — standard JSON envelope
└── prisma/
    └── schema.prisma                          ← TeleconsultationRequest model (see §6)
```

---

## 4. Setup

### Prerequisites
- Node.js 18+
- PostgreSQL 15+ running, with a database named `arogyalink`
- (Optional) Bhashini ULCA credentials from https://bhashini.gov.in — **not required for local dev**, see §8.

### Steps

```bash
cd arogyalink-backend
npm install

# Copy the env template and fill in your DB password
cp .env.example .env

# Generate the Prisma client and apply migrations
npm run db:generate
npm run db:migrate

# Start the dev server (auto-reload)
npm run dev
```

Server runs at `http://localhost:3001`
Health check: `GET http://localhost:3001/health`
Socket.io endpoint: `ws://localhost:3001` (same port as HTTP — Socket.io is attached to the same `http.Server`)

> `AUTH_ENABLED=false` by default in `.env`, so all teleconsultation routes work without a real JWT during development (requests are treated as coming from a seeded `dev-user` with role `SYSTEM_ADMIN`). Set `AUTH_ENABLED=true` before a real demo/deployment so the role checks below actually apply.

### Relevant environment variables

```bash
# --- Server / Socket.io ---
PORT=3001
CLIENT_ORIGIN=http://localhost:5173     # Socket.io CORS — must match the frontend's origin exactly

# --- Auth ---
AUTH_ENABLED=false                      # true in production
JWT_SECRET=your_super_secret_key_here
JWT_EXPIRES_IN=7d

# --- Bhashini (speech translation) ---
USE_MOCK_BHASHINI=true                  # true = no real credentials needed, canned phrases returned
BHASHINI_USER_ID=your_bhashini_user_id
BHASHINI_ULCA_KEY=your_bhashini_ulca_api_key
BHASHINI_PIPELINE_ID=your_bhashini_pipeline_id
```

---

## 5. Request lifecycle (state machine)

Mirrors the `Referral` status pattern used elsewhere in the app, for team consistency.

```
CREATED ──accept──▶ ACCEPTED ──complete──▶ COMPLETED
   │
   ├──reject────▶ REJECTED
   │
   └──cancel────▶ CANCELLED
```

- **CREATED** — a requester (ASHA/ANM/Doctor) has asked a specific doctor/specialist for a call. Nothing else has happened yet.
- **ACCEPTED** — the doctor accepted. At this point the server auto-generates a `roomId` and creates a clinical `Encounter` (`encounterType: TELECONSULTATION`) so the call is tied to the patient's medical record from the start.
- **REJECTED** — the doctor declined. Terminal state.
- **CANCELLED** — the requester pulled the request before the doctor acted. Terminal state.
- **COMPLETED** — either side marks the call as finished after it ends (currently restricted to the assigned doctor in the controller). Terminal state.

Only `CREATED` requests can be accepted, rejected, or cancelled. Only `ACCEPTED` requests can be completed. Attempting an invalid transition returns `409 Conflict`.

---

## 6. Data model — `TeleconsultationRequest`

(from `prisma/schema.prisma`)

| Field | Type | Notes |
|---|---|---|
| `id` | String (cuid) | Primary key |
| `patientId` → `Patient` | String | The patient the call is about |
| `doctorId` → `User` | String | The doctor/specialist being called |
| `requesterId` → `User` | String | Who created the request (ASHA/ANM/PHC Doctor) |
| `reason` | String | Clinical reason for the consult |
| `status` | Enum `TeleconsultationStatus` | `CREATED \| ACCEPTED \| REJECTED \| CANCELLED \| COMPLETED` |
| `roomId` | String? | Set only on ACCEPTED — both sides use this to join the same Socket.io/WebRTC room |
| `encounterId` → `Encounter` | String? (unique) | Set only on ACCEPTED — links the call to the patient's clinical timeline |
| `createdAt` / `updatedAt` | DateTime | Standard timestamps |

Indexed on `patientId` for fast "all teleconsultations for this patient" lookups (used by the patient timeline feature built by another teammate).

---

## 7. REST API reference

**Base URL:** `http://localhost:3001/api`
**Auth:** every route requires `Authorization: Bearer <token>` when `AUTH_ENABLED=true`.
**Response envelope** (all endpoints, success or error):

```json
{
  "success": true,
  "message": "Description",
  "data": { "...": "..." },
  "timestamp": "2026-09-22T00:00:00.000Z"
}
```

### `POST /api/teleconsultations` — create a request
**Roles:** `ASHA`, `ANM`, `DOCTOR`, `SPECIALIST`

```json
// Request body
{
  "patientId": "patient_cuid",
  "doctorId": "doctor_user_cuid",
  "reason": "Suspected cardiac issue, needs specialist opinion"
}
```

Behavior:
- Verifies the patient exists (404 if not).
- Verifies the target user exists and has role `DOCTOR` or `SPECIALIST` (404 if not).
- If a `CREATED` request already exists for the same `patientId` + `doctorId`, returns that existing request instead of creating a duplicate (200, not 201).
- On success, emits Socket.io event `new-teleconsultation-request` to room `user_<doctorId>` so the doctor's UI updates live if they're online.
- Returns `201` with the created request (patient/doctor/requester relations included).

### `GET /api/teleconsultations/incoming` — doctor's live queue
**Roles:** `DOCTOR`, `SPECIALIST`
**Query:** `?status=all` to get full history (default: only `CREATED`, capped at 100, newest first).

Returns all requests where `doctorId === req.user.id`.

### `GET /api/teleconsultations/mine` — requester's own list
**Roles:** any authenticated user

Returns all requests where `requesterId === req.user.id`, so the UI can poll status and pick up the `roomId` once accepted (in addition to the real-time socket push).

### `GET /api/teleconsultations/:id` — fetch a single request
**Roles:** any authenticated user

### `PATCH /api/teleconsultations/:id/accept` — accept a request
**Roles:** `DOCTOR`, `SPECIALIST` (must be the doctor the request was addressed to)

Behavior:
1. Confirms the request belongs to the calling doctor and is still `CREATED` (else `404`/`409`).
2. Generates a room id: `'teleconsult-' + random 8-char string`.
3. Creates an `Encounter` row: `encounterType: TELECONSULTATION`, `facilityId: null` (virtual visit), `symptoms: []`, `clinicalNotes: null`, `encounterDate: now()`.
4. Updates the request → `status: ACCEPTED`, sets `roomId` and `encounterId`.
5. Emits Socket.io event `teleconsultation-accepted` to room `user_<requesterId>` with `{ requestId, roomId, doctorId, doctorName, encounterId }` so the requester's browser can navigate straight to the video room without polling.

### `PATCH /api/teleconsultations/:id/reject` — decline a request
**Roles:** `DOCTOR`, `SPECIALIST`
Emits `teleconsultation-rejected` to `user_<requesterId>`.

### `PATCH /api/teleconsultations/:id/cancel` — cancel before acceptance
**Roles:** any authenticated user, but only the original requester can cancel their own request.
Emits `teleconsultation-cancelled` to `user_<doctorId>`.

### `PATCH /api/teleconsultations/:id/complete` — mark call finished
**Roles:** `DOCTOR`, `SPECIALIST` (must be the assigned doctor). Only valid from `ACCEPTED`.

### `GET /api/teleconsult-doctors` — doctor/specialist directory
**Roles:** any authenticated user
**Query:** `?role=DOCTOR` or `?role=SPECIALIST` to filter (defaults to both).

Used to populate the "who do you want to call" picker on the requester's side. Only returns active users, and only safe fields (`id, name, phone, role, identifier, isActive, createdAt` — no password hash).

### `GET /api/teleconsult-doctors/:id` — single doctor profile
**Roles:** any authenticated user

---

## 8. Socket.io — real-time events

The Socket.io server is created in `src/index.js` and attached to the same HTTP server the Express app uses, so it shares the port. It is also stored on the Express app (`app.set('io', io)`) so the REST controllers above can `req.app.get('io')` and push events without a circular import.

All handlers live in `src/socket/teleconsultationSocket.js`, registered once via `registerTeleconsultationSocket(io)`.

### Client → Server events

| Event | Payload | Purpose |
|---|---|---|
| `register` | `{ userId }` | Joins the socket to a personal room `user_<userId>` so REST controllers can push notifications regardless of which page the user is on. **Call this immediately after connecting, for every logged-in user, not just people in a call.** |
| `join-room` | `{ roomId, userId, role }` | Joins the WebRTC room. Both participants call this when they land on `/room/:roomId`. Triggers `user-joined` to the other side. |
| `offer` | `{ roomId, offer }` | Relays an SDP offer to the rest of the room. Pass-through — server never inspects it. |
| `answer` | `{ roomId, answer }` | Relays an SDP answer. |
| `ice-candidate` | `{ roomId, candidate }` | Relays an ICE candidate. |
| `patient_speech_chunk` | `{ roomId, audioBase64, sourceLanguage, targetLanguage }` | Sends a ~3 second base64-encoded audio chunk for translation (see §9). |
| `end-call` | `{ roomId }` | Ends the call for everyone in the room. |

### Server → Client events

| Event | Payload | Emitted by |
|---|---|---|
| `new-teleconsultation-request` | full request object | REST controller (`createRequest`), to `user_<doctorId>` |
| `teleconsultation-accepted` | `{ requestId, roomId, doctorId, doctorName, encounterId }` | REST controller (`acceptRequest`), to `user_<requesterId>` |
| `teleconsultation-rejected` | `{ requestId, doctorId }` | REST controller (`rejectRequest`), to `user_<requesterId>` |
| `teleconsultation-cancelled` | `{ requestId }` | REST controller (`cancelRequest`), to `user_<doctorId>` |
| `user-joined` | `{ userId, role, socketId }` | Socket handler, broadcast to rest of room on `join-room` |
| `offer` / `answer` / `ice-candidate` | signaling payload + `from: socket.id` | Socket handler, relayed to rest of room |
| `translated_audio_response` | `{ recognizedText, translatedText, audioContent, sourceLanguage, targetLanguage }` | Socket handler, broadcast to entire room after a `patient_speech_chunk` is processed |
| `translation-error` | `{ message }` | Socket handler, sent only to the sender if translation fails |
| `call-ended` | `{ by: socket.id }` | Socket handler, broadcast to rest of room on `end-call` |
| `user-left` | `{ userId, socketId }` | Socket handler, broadcast on disconnect |

### CORS for Socket.io
Controlled separately from the Express CORS middleware — set via `CLIENT_ORIGIN` in `.env`. It must exactly match the frontend's dev/prod URL, or the WebSocket handshake will fail even though REST calls succeed.

---

## 9. Bhashini speech translation (`services/bhashiniService.js`)

This is an **optional layer** on top of the video call — the call itself works over plain WebRTC without it. It exists to translate what the patient says (often in a regional language) into text the doctor can read live, and optionally back into synthesized speech.

### Flow
1. Frontend records ~3s of the patient's mic audio (`MediaRecorder`).
2. Sends it as base64 over the `patient_speech_chunk` socket event.
3. Backend calls `translateSpeech({ audioBase64, sourceLanguage, targetLanguage })`.
4. Real Bhashini pipeline: fetches pipeline config (cached in memory) → runs ASR → NMT → TTS via the ULCA inference endpoint → normalizes the response into `{ recognizedText, translatedText, audioContent }`.
5. Result is broadcast to the whole room as `translated_audio_response`.

### Mock mode (default: `USE_MOCK_BHASHINI=true`)
No real credentials needed. Returns a canned phrase from a small dictionary keyed by `sourceLanguage` (`hi`, `mr`, `bn`, `ta`, `te`), with `audioContent: null`. This lets the full call + translation UI be demoed end-to-end without registering for Bhashini access. **The frontend must handle `audioContent === null` gracefully (skip audio playback).**

### Real mode
Requires registering at https://bhashini.gov.in and setting `BHASHINI_USER_ID`, `BHASHINI_ULCA_KEY`, `BHASHINI_PIPELINE_ID`.

> ⚠️ **Known fragility:** the Bhashini pipeline/inference response shape is not fully stable/documented. `parsePipelineResponse()` and `parseInferenceResponse()` in `bhashiniService.js` are the *only* two places that parse the raw response — if a live call fails with "Unexpected Bhashini pipeline config response shape" or similar, verify the current field paths against the live API and fix those two functions only.

### Supported languages (current UI + mock dictionary)
`hi` Hindi · `mr` Marathi · `bn` Bengali · `ta` Tamil · `te` Telugu · `en` English

---

## 10. Auth & role rules (teleconsultation-specific)

| Action | Allowed roles |
|---|---|
| Create a request | `ASHA`, `ANM`, `DOCTOR`, `SPECIALIST` |
| View incoming queue | `DOCTOR`, `SPECIALIST` |
| Accept / reject | `DOCTOR`, `SPECIALIST` (must be the addressed doctor) |
| Cancel | Any role, but must be the original requester |
| Complete | `DOCTOR`, `SPECIALIST` (must be the assigned doctor) |
| View doctor directory | Any authenticated user |

With `AUTH_ENABLED=false` (dev default), all requests are treated as the seeded `dev-user` (role `SYSTEM_ADMIN`) — role checks above will effectively block dev-mode testing of doctor-only actions unless you seed/login as an actual `DOCTOR`/`SPECIALIST` user, or temporarily broaden the role arrays while testing locally.

---

## 11. Common issues

**"Doctor or Specialist not found" on create request**
→ The `doctorId` you passed doesn't belong to a user with role `DOCTOR` or `SPECIALIST`. Check `GET /api/teleconsult-doctors` first to get a valid id.

**Socket connects but doctor never receives `new-teleconsultation-request`**
→ The doctor's browser must call `socket.emit('register', { userId })` right after connecting — this is what joins them to `user_<doctorId>`. If they never registered (e.g. reloaded the page after the request was created), they'll only see it via `GET /api/teleconsultations/incoming` polling, not the live push.

**WebRTC connects but no video/audio**
→ Check `CLIENT_ORIGIN` in the backend `.env` matches the frontend's actual origin — a CORS mismatch on the Socket.io handshake silently breaks signaling, which breaks WebRTC before it can even start.

**Translation always returns the same canned phrase**
→ `USE_MOCK_BHASHINI=true` is expected/default behavior — this is not a bug during development.

**"Missing BHASHINI_USER_ID / BHASHINI_ULCA_KEY" error**
→ You set `USE_MOCK_BHASHINI=false` without providing real credentials. Either set it back to `true`, or provide all three Bhashini env vars.

---

## 12. npm scripts (whole backend, shared)

```bash
npm run dev          # start with nodemon (auto-reload)
npm run start        # start (production)
npm run db:generate  # regenerate Prisma client after schema changes
npm run db:migrate   # run Postgres migrations
npm run db:studio    # visual DB browser
```

