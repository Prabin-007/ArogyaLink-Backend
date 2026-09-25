/**
 * test/sync.test.js
 * ------------------
 * End-to-end test of the mobile sync contract. Plain Node — no test framework.
 *
 * What it does:
 *   1. Starts the REAL server (src/index.js) as a child process with
 *      AUTH_ENABLED=true, so JWT auth + role checks are exercised.
 *   2. Logs in as the seeded demo ASHA(s) and doctor over HTTP.
 *   3. Runs the scenarios below against the real database, then deletes every
 *      row it created.
 *
 * Prerequisites (run once):
 *   npm run db:deploy      # apply migrations
 *   npm run db:seed        # demo facilities + demo users
 * .env must contain DATABASE_URL (use a THROWAWAY database — tests write data).
 *
 * Run:  npm test
 *
 * Scenarios:
 *   A  one batch: patient + encounter + vitals + follow-up referencing each other by UUID
 *   B  re-sending the identical batch creates no duplicates (rows or timeline events)
 *   C  the patient timeline contains an event for every synced record
 *   D  a referral created + moved by a doctor on the web shows up in the ASHA's next download
 *   E  optimistic concurrency: wrong / stale baseUpdatedAt → "conflict", right one → ok
 *   F  an ASHA cannot touch a patient (or follow-up) assigned to another ASHA
 *   G  HIGH_RISK_FLAGGED fires only on false → true (sync AND regular endpoints)
 *   H  server-created (cuid) patients / follow-ups can be synced against
 *   I  input rules: new records need UUIDs; referrals/prescriptions are rejected
 *   J  facilities endpoint + role guards + download parameter validation
 *   K  lost response: create ok, response lost, edit offline, resend WITHOUT baseUpdatedAt → ok, edit applied
 *      (lastModifiedById == caller)
 *   L  a doctor edits the record, then the ASHA resends a stale version → conflict, serverRecord included
 *
 * Assessments (structured forms):
 *   M  one batch (order patient→encounter→vitals→assessment), phone values kept, timeline event, idempotent retry
 *   N  the server's own triage (existing rule engine) is stored separately from the phone's result
 *   O  optimistic concurrency, lost response, "someone else changed it" → conflict + serverRecord
 *   P  ownership through the patient, fixed fields, validation, per-record independence
 *   Q  download: the ASHA's patients' assessments, incremental; existing keys unchanged
 *   R  GET /api/patients/:id/assessments — clinical roles only, newest first by completedAt
 *   S  GET /api/patients?triageLevel= — patients whose LATEST assessment has that level
 */

require('dotenv').config();

const { spawn } = require('node:child_process');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { isDeepStrictEqual } = require('node:util');
const bcrypt = require('bcryptjs');
const { PrismaClient } = require('@prisma/client');

const PORT = process.env.TEST_PORT || '3999';
const BASE = `http://localhost:${PORT}`;
const PASSWORD = 'Demo@123'; // demo password set by prisma/seed.js (DEMO_PASSWORD)

const prisma = new PrismaClient();

// ─── Tiny assertion harness ───────────────────────────────────────────────────
let passed = 0;
let failed = 0;
const failures = [];

const section = (title) => console.log(`\n── ${title}`);

const check = (name, condition, detail) => {
  if (condition) {
    passed++;
    console.log(`  ✔ ${name}`);
  } else {
    failed++;
    failures.push(name);
    console.log(`  ✘ ${name}${detail !== undefined ? `\n      ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''}`);
  }
};

// ─── HTTP helper ──────────────────────────────────────────────────────────────
const api = async (method, url, token, body) => {
  const res = await fetch(BASE + url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try {
    json = await res.json();
  } catch (_) {
    /* non-JSON body */
  }
  return { status: res.status, body: json, data: json && json.data };
};

const login = async (identifier, role) => {
  const r = await api('POST', '/api/auth/login', null, { identifier, password: PASSWORD, role });
  if (r.status !== 200) {
    throw new Error(`Login failed for ${identifier} (${r.status}). Did you run "npm run db:seed"? ${JSON.stringify(r.body)}`);
  }
  return { token: r.data.token, id: r.data.user.id };
};

const upload = (token, records, deviceId = 'test-device') =>
  api('POST', '/api/sync/upload', token, { deviceId, records });

const download = (token, lastSyncedAt) =>
  api('GET', `/api/sync/download?deviceId=test-device${lastSyncedAt !== undefined ? `&lastSyncedAt=${encodeURIComponent(lastSyncedAt)}` : ''}`, token);

const findResult = (resp, type, id) => (resp.data.results || []).find((r) => r.type === type && r.id === id);
const timelineTypes = async (token, patientId) => {
  const r = await api('GET', `/api/patients/${patientId}/timeline`, token);
  return { events: r.data.timeline, types: r.data.timeline.map((e) => e.eventType) };
};
const count = (arr, v) => arr.filter((x) => x === v).length;
const daysAgo = (d) => new Date(Date.now() - d * 86400000).toISOString();

// ─── Server lifecycle ─────────────────────────────────────────────────────────
let server;
let serverLog = '';

const startServer = async () => {
  server = spawn(process.execPath, ['src/index.js'], {
    cwd: path.join(__dirname, '..'),
    env: {
      ...process.env,
      PORT,
      NODE_ENV: 'test',
      AUTH_ENABLED: 'true', // the whole point: run with real auth
      JWT_SECRET: process.env.JWT_SECRET || 'test-only-secret',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout.on('data', (d) => (serverLog += d));
  server.stderr.on('data', (d) => (serverLog += d));

  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`${BASE}/health`);
      if (r.ok) return;
    } catch (_) {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Server did not start.\n${serverLog}`);
};

// ─── Test data bookkeeping (for cleanup) ──────────────────────────────────────
const createdPatientIds = new Set();
const createdUserIds = new Set();

/** Creates a throwaway user for a role the seed does not provide, and logs in as them. Removed by cleanup(). */
const makeWebUser = async (role) => {
  const identifier = `TEST-${role}-${randomUUID().slice(0, 8)}`;
  const user = await prisma.user.create({
    data: { identifier, role, name: `Test ${role}`, phone: '9000000999', passwordHash: await bcrypt.hash(PASSWORD, 10), isActive: true },
  });
  createdUserIds.add(user.id);
  return login(identifier, role);
};

const cleanup = async () => {
  const ids = [...createdPatientIds];
  if (ids.length === 0 && createdUserIds.size === 0) return;
  const referrals = await prisma.referral.findMany({ where: { patientId: { in: ids } }, select: { id: true } });
  const referralIds = referrals.map((r) => r.id);
  await prisma.timelineEvent.deleteMany({ where: { patientId: { in: ids } } });
  await prisma.referralEvent.deleteMany({ where: { referralId: { in: referralIds } } });
  await prisma.followUp.deleteMany({ where: { patientId: { in: ids } } });
  await prisma.prescription.deleteMany({ where: { patientId: { in: ids } } });
  await prisma.referral.deleteMany({ where: { patientId: { in: ids } } });
  await prisma.assessment.deleteMany({ where: { patientId: { in: ids } } });
  await prisma.vitals.deleteMany({ where: { patientId: { in: ids } } });
  await prisma.encounter.deleteMany({ where: { patientId: { in: ids } } });
  await prisma.patient.deleteMany({ where: { id: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: [...createdUserIds] } } });
};

// ─── The scenarios ────────────────────────────────────────────────────────────
const run = async () => {
  const asha1 = await login('ASHA-DEMO-001', 'ASHA');
  const asha2 = await login('ASHA-DEMO-002', 'ASHA');
  const doctor = await login('DOC-DEMO-001', 'DOCTOR');

  // UUIDs generated "on the phone" — none of these exist on the server yet.
  const P = randomUUID(); // patient
  const E = randomUUID(); // encounter (HOME_VISIT)
  const V = randomUUID(); // vitals
  const F = randomUUID(); // follow-up
  createdPatientIds.add(P);

  const registeredAt = daysAgo(3);
  const visitAt = daysAgo(2);
  const dueAt = daysAgo(1); // already overdue when synced — must be accepted

  const batch = {
    // Deliberately listed children-first; the server orders by record type, not array position.
    followups: [{ id: F, patientId: P, relatedEncounterId: E, dueDate: dueAt, notes: 'Recheck BP' }],
    vitals: [
      { id: V, patientId: P, encounterId: E, bpSystolic: 150, bpDiastolic: 95, temperature: 37.2, recordedAt: visitAt },
    ],
    encounters: [
      { id: E, patientId: P, encounterType: 'HOME_VISIT', symptoms: ['headache'], clinicalNotes: 'Home visit', encounterDate: visitAt },
    ],
    patients: [
      {
        id: P,
        name: 'Test Patient A',
        dateOfBirth: '1996-05-15',
        gender: 'FEMALE',
        village: 'Velhe',
        district: 'Pune',
        state: 'Maharashtra',
        category: 'PREGNANT',
        lmpDate: '2026-06-01T00:00:00.000Z',
        isHighRisk: true,
        riskReasons: ['BP >= 140/90'],
        createdAt: registeredAt,
      },
    ],
  };

  // ── A ──────────────────────────────────────────────────────────────────────
  section('A. One batch: patient + encounter + vitals + follow-up, all referencing each other by UUID');
  const a = await upload(asha1.token, batch);
  check('upload returns 200', a.status === 200, a.body);
  check('response carries data.results and data.serverTimestamp', Array.isArray(a.data?.results) && !!a.data?.serverTimestamp);
  check('exactly 4 results', a.data?.results?.length === 4, a.data?.results);
  for (const [type, id] of [['patient', P], ['encounter', E], ['vitals', V], ['followup', F]]) {
    const r = findResult(a, type, id);
    check(`${type} → status ok`, r && r.status === 'ok', r);
    check(`${type} result includes the new server updatedAt`, r && !isNaN(Date.parse(r.updatedAt)), r);
  }
  const dbPatient = await prisma.patient.findUnique({ where: { id: P } });
  check('client UUID is the server primary key', dbPatient && dbPatient.id === P);
  check('syncId = id (legacy column)', dbPatient && dbPatient.syncId === P);
  check('assignedAshaId defaulted to the syncing ASHA', dbPatient && dbPatient.assignedAshaId === asha1.id);
  check('new patient fields stored (category/lmpDate/isHighRisk/riskReasons)',
    dbPatient && dbPatient.category === 'PREGNANT' && dbPatient.isHighRisk === true &&
    dbPatient.riskReasons[0] === 'BP >= 140/90' && dbPatient.lmpDate !== null);
  const dbEnc = await prisma.encounter.findUnique({ where: { id: E } });
  check('encounter: HOME_VISIT, no doctor, phone encounterDate honoured',
    dbEnc && dbEnc.encounterType === 'HOME_VISIT' && dbEnc.doctorId === null &&
    dbEnc.encounterDate.toISOString() === visitAt);
  const dbVit = await prisma.vitals.findUnique({ where: { id: V } });
  check('vitals: phone recordedAt honoured, recordedById = the ASHA',
    dbVit && dbVit.recordedAt.toISOString() === visitAt && dbVit.recordedById === asha1.id);
  const dbFu = await prisma.followUp.findUnique({ where: { id: F } });
  check('follow-up with a past dueDate accepted, assigned to the ASHA',
    dbFu && dbFu.assignedToId === asha1.id && dbFu.status === 'PENDING');

  check('lastModifiedById = the syncing ASHA on all four created rows',
    dbPatient.lastModifiedById === asha1.id && dbEnc.lastModifiedById === asha1.id &&
    dbVit.lastModifiedById === asha1.id && dbFu.lastModifiedById === asha1.id,
    [dbPatient.lastModifiedById, dbEnc.lastModifiedById, dbVit.lastModifiedById, dbFu.lastModifiedById]);

  const updatedAtAfterA = {
    patient: findResult(a, 'patient', P).updatedAt,
    vitals: findResult(a, 'vitals', V).updatedAt,
    followup: findResult(a, 'followup', F).updatedAt,
  };

  // ── B ──────────────────────────────────────────────────────────────────────
  section('B. Re-sending the exact same batch creates no duplicates');
  const timelineBefore = (await timelineTypes(asha1.token, P)).events.length;
  const b = await upload(asha1.token, batch);
  check('re-upload returns 200', b.status === 200, b.body);
  check('every record → ok again', b.data.results.length === 4 && b.data.results.every((r) => r.status === 'ok'), b.data.results);
  check('updatedAt unchanged (nothing was rewritten)',
    findResult(b, 'patient', P).updatedAt === updatedAtAfterA.patient &&
    findResult(b, 'vitals', V).updatedAt === updatedAtAfterA.vitals);
  const counts = {
    patients: await prisma.patient.count({ where: { id: P } }),
    encounters: await prisma.encounter.count({ where: { patientId: P } }),
    vitals: await prisma.vitals.count({ where: { patientId: P } }),
    followups: await prisma.followUp.count({ where: { patientId: P } }),
  };
  check('still exactly 1 patient / 1 encounter / 1 vitals / 1 follow-up', Object.values(counts).every((n) => n === 1), counts);
  check('no duplicate timeline events', (await timelineTypes(asha1.token, P)).events.length === timelineBefore);

  // ── C ──────────────────────────────────────────────────────────────────────
  section('C. Patient timeline contains an event for every synced record');
  const tl = await timelineTypes(asha1.token, P);
  for (const t of ['PATIENT_REGISTERED', 'HIGH_RISK_FLAGGED', 'ENCOUNTER_CREATED', 'VITALS_RECORDED', 'FOLLOWUP_SCHEDULED']) {
    check(`timeline has ${t} (exactly once)`, count(tl.types, t) === 1, tl.types);
  }
  check('timeline has exactly those 5 events', tl.events.length === 5, tl.types);
  const hr = tl.events.find((e) => e.eventType === 'HIGH_RISK_FLAGGED');
  check('HIGH_RISK_FLAGGED description includes the risk reasons', hr && hr.description.includes('BP >= 140/90'), hr);
  const reg = tl.events.find((e) => e.eventType === 'PATIENT_REGISTERED');
  check('events are stamped with the offline time, not sync time', reg && reg.createdAt === registeredAt, reg);
  const vt = tl.events.find((e) => e.eventType === 'VITALS_RECORDED');
  check('vitals timeline text uses the shared helper wording', vt && vt.description.startsWith('Vitals recorded: ') && vt.description.includes('BP: 150/95 mmHg'), vt);

  // ── D ──────────────────────────────────────────────────────────────────────
  section('D. Doctor-side referral status change appears in the ASHA\'s next download');
  const dl0 = await download(asha1.token, '0');
  check('first sync (lastSyncedAt=0) returns 200', dl0.status === 200, dl0.body);
  const pFull = (dl0.data.patients || []).find((p) => p.id === P);
  check('download returns FULL patient objects', pFull && pFull.category === 'PREGNANT' && pFull.riskReasons.length === 1 && !!pFull.updatedAt, pFull);
  check('download includes encounter, vitals and follow-up for the ASHA\'s patient',
    dl0.data.encounters.some((x) => x.id === E) && dl0.data.vitals.some((x) => x.id === V) && dl0.data.followups.some((x) => x.id === F));
  check('download includes the facilities list (≥ 10 seeded)', dl0.data.facilities.length >= 10, dl0.data.facilities.length);
  check('download has no referrals yet', dl0.data.referrals.filter((r) => r.patientId === P).length === 0);
  const t0 = dl0.data.serverTimestamp;

  const refCreate = await api('POST', '/api/referrals', doctor.token, {
    patientId: P,
    encounterId: E,
    referringFacilityId: 'PHC-DEMO-001',
    receivingFacilityId: 'DH-DEMO-001',
    reason: 'Suspected pre-eclampsia',
    priority: 'HIGH',
  });
  check('doctor creates a referral via the web endpoint (201)', refCreate.status === 201, refCreate.body);
  const referralId = refCreate.data?.referral?.id;

  const dl1 = await download(asha1.token, t0);
  const ref1 = (dl1.data.referrals || []).find((r) => r.id === referralId);
  check('ASHA\'s next download contains the new referral (status CREATED)', ref1 && ref1.status === 'CREATED', dl1.data.referrals);
  check('...and does NOT re-send unchanged records', !dl1.data.patients.some((p) => p.id === P) && !dl1.data.vitals.some((x) => x.id === V));

  const acc = await api('PATCH', `/api/referrals/${referralId}/status`, doctor.token, { newStatus: 'ACCEPTED', remarks: 'Bed reserved' });
  check('doctor accepts the referral (200)', acc.status === 200, acc.body);
  const dl2 = await download(asha1.token, dl1.data.serverTimestamp);
  const ref2 = (dl2.data.referrals || []).find((r) => r.id === referralId);
  check('ASHA\'s following download shows status ACCEPTED', ref2 && ref2.status === 'ACCEPTED', dl2.data.referrals);

  const dlOther = await download(asha2.token, '0');
  check('a DIFFERENT ASHA never receives this patient\'s referral or records',
    !dlOther.data.referrals.some((r) => r.id === referralId) && !dlOther.data.patients.some((p) => p.id === P));

  const upRef = await upload(asha1.token, { referrals: [{ id: randomUUID(), patientId: P, reason: 'x' }] });
  check('uploading a referral from the phone is rejected per-record', upRef.data.results[0].status === 'error' && /doctors/i.test(upRef.data.results[0].message), upRef.data.results);
  check('no ASHA-created referral exists', (await prisma.referral.count({ where: { patientId: P } })) === 1);

  // ── E ──────────────────────────────────────────────────────────────────────
  section('E. Optimistic concurrency (baseUpdatedAt)');
  const U0 = updatedAtAfterA.patient;

  const wrongBase = new Date(Date.parse(U0) - 3600000).toISOString();
  const e1 = await upload(asha1.token, { patients: [{ id: P, phone: '9111111111', baseUpdatedAt: wrongBase }] });
  const e1r = findResult(e1, 'patient', P);
  check('wrong baseUpdatedAt → status "conflict"', e1r && e1r.status === 'conflict', e1r);
  check('conflict result returns the server\'s current updatedAt', e1r && e1r.updatedAt === U0, e1r);
  check('conflict result includes serverRecord (the server\'s current row)',
    e1r && e1r.serverRecord && e1r.serverRecord.id === P && e1r.serverRecord.updatedAt === U0 && e1r.serverRecord.phone === null, e1r);
  check('conflict wrote nothing', (await prisma.patient.findUnique({ where: { id: P } })).phone === null);

  const e2 = await upload(asha1.token, { patients: [{ id: P, phone: '9111111111', baseUpdatedAt: U0 }] });
  const e2r = findResult(e2, 'patient', P);
  check('correct baseUpdatedAt → ok', e2r && e2r.status === 'ok', e2r);
  check('ok result carries a NEW updatedAt', e2r && e2r.updatedAt !== U0, e2r);
  check('the change was written', (await prisma.patient.findUnique({ where: { id: P } })).phone === '9111111111');
  const U1 = e2r.updatedAt;

  const e3 = await upload(asha1.token, { patients: [{ id: P, phone: '9222222222', baseUpdatedAt: U0 }] });
  check('re-using the OLD baseUpdatedAt → conflict', findResult(e3, 'patient', P).status === 'conflict', e3.data.results);
  check('...and the newer value survives', (await prisma.patient.findUnique({ where: { id: P } })).phone === '9111111111');

  check('the ASHA\'s own write is recorded: lastModifiedById = ASHA', (await prisma.patient.findUnique({ where: { id: P } })).lastModifiedById === asha1.id);

  // Doctor edits the same patient on the web while the ASHA is offline.
  const webEdit = await api('PUT', `/api/patients/${P}`, doctor.token, { village: 'Mulshi' });
  check('doctor edits the patient on the web (200)', webEdit.status === 200, webEdit.body);
  check('web write records lastModifiedById = the doctor', (await prisma.patient.findUnique({ where: { id: P } })).lastModifiedById === doctor.id);

  const e4 = await upload(asha1.token, { patients: [{ id: P, phone: '9333333333' }] });
  const e4r = findResult(e4, 'patient', P);
  check('existing + different content + NO baseUpdatedAt + someone ELSE modified it → conflict',
    e4r && e4r.status === 'conflict' && /baseUpdatedAt/.test(e4r.message) && e4r.serverRecord && e4r.serverRecord.village === 'Mulshi', e4r);
  const e5 = await upload(asha1.token, { patients: [{ id: P, address: 'Ward 4', baseUpdatedAt: U1 }] });
  check('ASHA edit based on the pre-doctor version → conflict (doctor\'s edit not overwritten)',
    findResult(e5, 'patient', P).status === 'conflict' && (await prisma.patient.findUnique({ where: { id: P } })).village === 'Mulshi');
  check('...and the phone\'s stale change (phone 9333333333) was not applied',
    (await prisma.patient.findUnique({ where: { id: P } })).phone === '9111111111');
  const freshPatient = (await download(asha1.token, t0)).data.patients.find((p) => p.id === P);
  const e6 = await upload(asha1.token, { patients: [{ id: P, address: 'Ward 4', baseUpdatedAt: freshPatient.updatedAt }] });
  check('after re-downloading, the same edit with the fresh updatedAt → ok', findResult(e6, 'patient', P).status === 'ok', e6.data.results);

  // Vitals + follow-up use the same mechanism.
  const ev = await upload(asha1.token, { vitals: [{ id: V, weight: 61.5, baseUpdatedAt: updatedAtAfterA.vitals }] });
  check('vitals update with correct base → ok', findResult(ev, 'vitals', V).status === 'ok', ev.data.results);
  const fuDone = await upload(asha1.token, {
    followups: [{ id: F, status: 'COMPLETED', outcome: 'BP normal', baseUpdatedAt: updatedAtAfterA.followup }],
  });
  check('follow-up → COMPLETED with correct base → ok', findResult(fuDone, 'followup', F).status === 'ok', fuDone.data.results);
  const fuRow = await prisma.followUp.findUnique({ where: { id: F } });
  check('completedAt set, outcome saved', fuRow.status === 'COMPLETED' && fuRow.completedAt !== null && fuRow.outcome === 'BP normal');
  const fuAgain = await upload(asha1.token, {
    followups: [{ id: F, status: 'COMPLETED', outcome: 'BP normal', baseUpdatedAt: updatedAtAfterA.followup }],
  });
  check('retrying that completion (old base) is idempotent → ok', findResult(fuAgain, 'followup', F).status === 'ok', fuAgain.data.results);
  const tlAfter = await timelineTypes(asha1.token, P);
  check('FOLLOWUP_COMPLETED on the timeline exactly once', count(tlAfter.types, 'FOLLOWUP_COMPLETED') === 1, tlAfter.types);

  // ── F ──────────────────────────────────────────────────────────────────────
  section('F. An ASHA cannot touch another ASHA\'s patient');
  const V2 = randomUUID();
  const f1 = await upload(asha2.token, { vitals: [{ id: V2, patientId: P, bpSystolic: 120, bpDiastolic: 80 }] });
  const f1r = findResult(f1, 'vitals', V2);
  check('ASHA #2 uploading vitals for ASHA #1\'s patient → error', f1r && f1r.status === 'error', f1r);
  check('...and nothing was written', (await prisma.vitals.count({ where: { id: V2 } })) === 0);

  const f2 = await upload(asha2.token, { patients: [{ id: P, phone: '0000000000', baseUpdatedAt: freshPatient.updatedAt }] });
  check('ASHA #2 updating ASHA #1\'s patient → error', findResult(f2, 'patient', P).status === 'error', f2.data.results);

  const f3 = await upload(asha2.token, { encounters: [{ id: randomUUID(), patientId: P, encounterType: 'HOME_VISIT' }] });
  check('ASHA #2 adding an encounter to ASHA #1\'s patient → error', f3.data.results[0].status === 'error', f3.data.results);

  const f4 = await upload(asha2.token, { followups: [{ id: F, status: 'MISSED', baseUpdatedAt: fuRow.updatedAt.toISOString() }] });
  check('ASHA #2 updating ASHA #1\'s follow-up → error', findResult(f4, 'followup', F).status === 'error', f4.data.results);

  const Pother = randomUUID();
  createdPatientIds.add(Pother);
  const f5 = await upload(asha1.token, {
    patients: [{ id: Pother, name: 'Other', dateOfBirth: '1990-01-01', gender: 'MALE', village: 'V', district: 'D', state: 'S', assignedAshaId: asha2.id }],
  });
  check('ASHA #1 creating a patient assigned to ASHA #2 → error', findResult(f5, 'patient', Pother).status === 'error', f5.data.results);

  const f6 = await upload(asha1.token, { patients: [{ id: P, assignedAshaId: asha2.id, baseUpdatedAt: freshPatient.updatedAt }] });
  check('an ASHA cannot reassign her own patient from the phone → error', findResult(f6, 'patient', P).status === 'error', f6.data.results);

  const f7 = await upload(asha1.token, { vitals: [{ id: randomUUID(), patientId: P, encounterId: randomUUID(), bpSystolic: 1 }] });
  check('vitals pointing at a non-existent encounter → per-record error', f7.data.results[0].status === 'error', f7.data.results);

  // ── G ──────────────────────────────────────────────────────────────────────
  section('G. HIGH_RISK_FLAGGED only on false → true');
  const P2 = randomUUID();
  createdPatientIds.add(P2);
  const g1 = await upload(asha1.token, {
    patients: [{ id: P2, name: 'Test Patient B', dateOfBirth: '1980-02-02', gender: 'MALE', village: 'Bhor', district: 'Pune', state: 'Maharashtra', category: 'NCD', isHighRisk: false }],
  });
  const g1r = findResult(g1, 'patient', P2);
  check('created not-high-risk → ok', g1r.status === 'ok', g1r);
  check('no HIGH_RISK_FLAGGED event yet', count((await timelineTypes(asha1.token, P2)).types, 'HIGH_RISK_FLAGGED') === 0);
  const g2 = await upload(asha1.token, { patients: [{ id: P2, isHighRisk: true, riskReasons: ['SpO2 < 94%'], baseUpdatedAt: g1r.updatedAt }] });
  const g2r = findResult(g2, 'patient', P2);
  check('flip to high-risk via sync → ok', g2r.status === 'ok', g2r);
  let tlB = await timelineTypes(asha1.token, P2);
  const hrB = tlB.events.find((e) => e.eventType === 'HIGH_RISK_FLAGGED');
  check('HIGH_RISK_FLAGGED created once, with the reason', count(tlB.types, 'HIGH_RISK_FLAGGED') === 1 && hrB.description.includes('SpO2 < 94%'), tlB.types);
  await upload(asha1.token, { patients: [{ id: P2, phone: '9444444444', baseUpdatedAt: g2r.updatedAt }] });
  tlB = await timelineTypes(asha1.token, P2);
  check('a later edit of an already-high-risk patient adds no second event', count(tlB.types, 'HIGH_RISK_FLAGGED') === 1, tlB.types);

  const webHigh = await api('POST', '/api/patients', doctor.token, {
    name: 'Web Patient High', dateOfBirth: '1975-03-03', gender: 'FEMALE', village: 'Velhe', district: 'Pune', state: 'Maharashtra',
    assignedAshaId: asha1.id, category: 'ELDERLY', isHighRisk: true, riskReasons: ['Age > 70'],
  });
  check('regular POST /api/patients accepts the new fields (201)', webHigh.status === 201 && webHigh.data.patient.category === 'ELDERLY', webHigh.body);
  const WH = webHigh.data.patient.id;
  createdPatientIds.add(WH);
  check('...and raises HIGH_RISK_FLAGGED', count((await timelineTypes(doctor.token, WH)).types, 'HIGH_RISK_FLAGGED') === 1);

  const webLow = await api('POST', '/api/patients', doctor.token, {
    name: 'Web Patient Low', dateOfBirth: '1990-04-04', gender: 'MALE', village: 'Velhe', district: 'Pune', state: 'Maharashtra', assignedAshaId: asha1.id,
  });
  check('existing-style POST (no new fields) still works and defaults apply',
    webLow.status === 201 && webLow.data.patient.category === 'GENERAL' && webLow.data.patient.isHighRisk === false, webLow.body);
  const WL = webLow.data.patient.id;
  createdPatientIds.add(WL);
  await api('PUT', `/api/patients/${WL}`, doctor.token, { isHighRisk: true, riskReasons: ['Smoker + BP'] });
  await api('PUT', `/api/patients/${WL}`, doctor.token, { isHighRisk: true, riskReasons: ['Smoker + BP'] });
  check('regular PUT false→true raises the event once (repeat PUT adds none)',
    count((await timelineTypes(doctor.token, WL)).types, 'HIGH_RISK_FLAGGED') === 1);

  // ── H ──────────────────────────────────────────────────────────────────────
  section('H. Server-created (cuid) records can be synced against');
  const V3 = randomUUID();
  const h1 = await upload(asha1.token, { vitals: [{ id: V3, patientId: WL, temperature: 38.1 }] });
  check('vitals for a web-created patient (cuid patientId) → ok', findResult(h1, 'vitals', V3).status === 'ok', h1.data.results);

  const webFu = await api('POST', '/api/followups', doctor.token, {
    patientId: WL, assignedToId: asha1.id, dueDate: new Date(Date.now() + 86400000).toISOString(),
  });
  check('doctor creates a follow-up assigned to the ASHA (201)', webFu.status === 201, webFu.body);
  const dlFu = await download(asha1.token, '0');
  const fuFromServer = dlFu.data.followups.find((x) => x.id === webFu.data.followUp.id);
  check('ASHA downloads that follow-up (cuid id)', !!fuFromServer);
  const h2 = await upload(asha1.token, { followups: [{ id: fuFromServer.id, status: 'IN_PROGRESS', notes: 'Called the family', baseUpdatedAt: fuFromServer.updatedAt }] });
  check('ASHA updates the doctor-created follow-up by its cuid → ok', findResult(h2, 'followup', fuFromServer.id).status === 'ok', h2.data.results);

  // ── I ──────────────────────────────────────────────────────────────────────
  section('I. Input rules');
  const cuidLike = 'c' + 'a'.repeat(24);
  const i1 = await upload(asha1.token, {
    patients: [{ id: cuidLike, name: 'X', dateOfBirth: '1990-01-01', gender: 'MALE', village: 'V', district: 'D', state: 'S' }],
  });
  check('NEW record with a cuid-style id → error asking for a UUID', i1.data.results[0].status === 'error' && /UUID/.test(i1.data.results[0].message), i1.data.results);
  const i2 = await upload(asha1.token, { patients: [{ id: 'not-an-id', name: 'X' }] });
  check('malformed id → per-record validation error', i2.data.results[0].status === 'error', i2.data.results);
  const i3 = await upload(asha1.token, { patients: [{ id: randomUUID(), name: 'Incomplete' }] });
  check('new patient missing required fields → error naming them', i3.data.results[0].status === 'error' && /dateOfBirth/.test(i3.data.results[0].message), i3.data.results);
  const i4 = await upload(asha1.token, {
    patients: [{ id: randomUUID(), name: 'Bad enum', dateOfBirth: '1990-01-01', gender: 'ALIEN', village: 'V', district: 'D', state: 'S' }],
    encounters: [{ id: E, clinicalNotes: 'notes updated', baseUpdatedAt: (await prisma.encounter.findUnique({ where: { id: E } })).updatedAt.toISOString() }],
  });
  check('one bad record does not block the others in the batch',
    i4.data.results.find((r) => r.type === 'patient').status === 'error' && findResult(i4, 'encounter', E).status === 'ok', i4.data.results);
  const i5 = await upload(asha1.token, { prescriptions: [{ id: randomUUID() }] });
  check('uploading a prescription is rejected per-record', i5.data.results[0].status === 'error' && /Prescriptions/.test(i5.data.results[0].message), i5.data.results);
  const i6 = await api('POST', '/api/sync/upload', asha1.token, { records: {} });
  check('missing deviceId → 400', i6.status === 400, i6.body);

  // ── J ──────────────────────────────────────────────────────────────────────
  section('J. Facilities, role guards, download validation');
  const fac = await api('GET', '/api/facilities', asha1.token);
  check('GET /api/facilities works for an ASHA', fac.status === 200 && fac.data.facilities.length >= 10, fac.body);
  const facD = await api('GET', '/api/facilities?district=pune', doctor.token);
  check('?district= filter is case-insensitive', facD.status === 200 && facD.data.facilities.length >= 10 && facD.data.facilities.every((f) => f.district === 'Pune'), facD.body);
  const facNone = await api('GET', '/api/facilities?district=Nowhere', doctor.token);
  check('?district=Nowhere → empty list', facNone.status === 200 && facNone.data.facilities.length === 0);
  check('facilities need authentication', (await api('GET', '/api/facilities')).status === 401);
  check('upload without a token → 401', (await api('POST', '/api/sync/upload', null, { deviceId: 'x', records: {} })).status === 401);
  check('a DOCTOR cannot use sync upload → 403', (await upload(doctor.token, {})).status === 403);
  check('download with an invalid lastSyncedAt → 400', (await download(asha1.token, 'yesterday')).status === 400);
  const noStamp = await download(asha1.token);
  check('download with no lastSyncedAt behaves like a full sync', noStamp.status === 200 && noStamp.data.patients.some((p) => p.id === P));
  const latest = await download(asha1.token, (await download(asha1.token, '0')).data.serverTimestamp);
  check('download with an up-to-date lastSyncedAt returns nothing new',
    latest.data.patients.length === 0 && latest.data.encounters.length === 0 && latest.data.vitals.length === 0 && latest.data.referrals.length === 0 && latest.data.followups.length === 0);

  // ── K ──────────────────────────────────────────────────────────────────────
  section('K. Lost response: create succeeded, response never arrived, ASHA edited offline, resend WITHOUT baseUpdatedAt');
  const PK = randomUUID(), EK = randomUUID(), VK = randomUUID(), FK = randomUUID();
  createdPatientIds.add(PK);
  const kPatient = { id: PK, name: 'Lost Response', dateOfBirth: '1992-07-07', gender: 'FEMALE', village: 'Velhe', district: 'Pune', state: 'Maharashtra', phone: '9000000000', isHighRisk: false };
  const kEnc = { id: EK, patientId: PK, encounterType: 'HOME_VISIT', clinicalNotes: 'first draft' };
  const kVit = { id: VK, patientId: PK, encounterId: EK, bpSystolic: 118, bpDiastolic: 76 };
  const kFu = { id: FK, patientId: PK, dueDate: daysAgo(-3), notes: 'first draft' };

  const k1 = await upload(asha1.token, { patients: [kPatient], encounters: [kEnc], vitals: [kVit], followups: [kFu] });
  check('original create → all ok (we now pretend this response was lost: the phone has no updatedAt)',
    k1.data.results.length === 4 && k1.data.results.every((r) => r.status === 'ok'), k1.data.results);
  const kUpdatedAt1 = findResult(k1, 'patient', PK).updatedAt;

  // The ASHA edits everything locally. The app still believes all four rows are unsynced creates,
  // so it resends the FULL rows with the edits and no baseUpdatedAt.
  const k2 = await upload(asha1.token, {
    patients: [{ ...kPatient, phone: '9555555555', isHighRisk: true, riskReasons: ['Edited offline: BP high'] }],
    encounters: [{ ...kEnc, clinicalNotes: 'edited offline', symptoms: ['fever'] }],
    vitals: [{ ...kVit, bpSystolic: 132, bpDiastolic: 86 }],
    followups: [{ ...kFu, status: 'COMPLETED', outcome: 'Visited, doing well', notes: 'edited offline' }],
  });
  check('resend with edits and NO baseUpdatedAt → all ok', k2.data.results.length === 4 && k2.data.results.every((r) => r.status === 'ok'), k2.data.results);
  const kP = await prisma.patient.findUnique({ where: { id: PK } });
  const kE = await prisma.encounter.findUnique({ where: { id: EK } });
  const kV = await prisma.vitals.findUnique({ where: { id: VK } });
  const kF = await prisma.followUp.findUnique({ where: { id: FK } });
  check('the edits WERE applied (patient, encounter, vitals, follow-up)',
    kP.phone === '9555555555' && kP.isHighRisk === true &&
    kE.clinicalNotes === 'edited offline' && kE.symptoms[0] === 'fever' &&
    kV.bpSystolic === 132 && kV.bpDiastolic === 86 &&
    kF.status === 'COMPLETED' && kF.outcome === 'Visited, doing well' && kF.completedAt !== null,
    { kP: kP.phone, kE: kE.clinicalNotes, kV: kV.bpSystolic, kF: kF.status });
  check('new updatedAt returned and it differs from the create\'s', findResult(k2, 'patient', PK).updatedAt !== kUpdatedAt1);
  check('lastModifiedById is still the ASHA', kP.lastModifiedById === asha1.id && kF.lastModifiedById === asha1.id);
  const tlK = await timelineTypes(asha1.token, PK);
  check('timeline: each creation event exactly once (no duplicates from the resend)',
    ['PATIENT_REGISTERED', 'ENCOUNTER_CREATED', 'VITALS_RECORDED', 'FOLLOWUP_SCHEDULED'].every((t) => count(tlK.types, t) === 1), tlK.types);
  check('timeline: the offline edits raised HIGH_RISK_FLAGGED and FOLLOWUP_COMPLETED once each',
    count(tlK.types, 'HIGH_RISK_FLAGGED') === 1 && count(tlK.types, 'FOLLOWUP_COMPLETED') === 1, tlK.types);

  const k3 = await upload(asha1.token, {
    patients: [{ ...kPatient, phone: '9555555555', isHighRisk: true, riskReasons: ['Edited offline: BP high'] }],
  });
  check('sending that same edit AGAIN is a pure retry → ok, updatedAt unchanged',
    findResult(k3, 'patient', PK).status === 'ok' && findResult(k3, 'patient', PK).updatedAt === findResult(k2, 'patient', PK).updatedAt, k3.data.results);

  const k4 = await upload(asha2.token, { patients: [{ ...kPatient, phone: '9777777777' }] });
  check('the rule does not let ANOTHER ASHA in (ownership still enforced) → error', findResult(k4, 'patient', PK).status === 'error', k4.data.results);

  // ── L ──────────────────────────────────────────────────────────────────────
  section('L. A doctor edits the record, then the ASHA resends a stale version → conflict with serverRecord');
  const PL = randomUUID(), FL = randomUUID();
  createdPatientIds.add(PL);
  const lPatient = { id: PL, name: 'Doctor Edits', dateOfBirth: '1988-08-08', gender: 'MALE', village: 'Bhor', district: 'Pune', state: 'Maharashtra' };
  const lFu = { id: FL, patientId: PL, dueDate: daysAgo(-2), notes: 'ASHA note' };
  const l1 = await upload(asha1.token, { patients: [lPatient], followups: [lFu] });
  check('ASHA creates a patient and a follow-up → ok', l1.data.results.every((r) => r.status === 'ok'), l1.data.results);
  const lBaseP = findResult(l1, 'patient', PL).updatedAt;
  const lBaseF = findResult(l1, 'followup', FL).updatedAt;

  const dp = await api('PUT', `/api/patients/${PL}`, doctor.token, { village: 'Mulshi', address: 'Doctor-corrected address' });
  const df = await api('PATCH', `/api/followups/${FL}`, doctor.token, { notes: 'Doctor note' });
  check('doctor edits the patient and the follow-up on the web', dp.status === 200 && df.status === 200, [dp.body, df.body]);

  // (1) stale, no baseUpdatedAt — someone else (the doctor) is now the last modifier
  const l2 = await upload(asha1.token, { patients: [{ ...lPatient, phone: '9666666666' }] });
  const l2r = findResult(l2, 'patient', PL);
  check('stale resend WITHOUT baseUpdatedAt → conflict', l2r && l2r.status === 'conflict', l2r);
  check('conflict includes serverRecord with the DOCTOR\'s changes',
    l2r && l2r.serverRecord && l2r.serverRecord.id === PL && l2r.serverRecord.village === 'Mulshi' &&
    l2r.serverRecord.address === 'Doctor-corrected address' && l2r.serverRecord.lastModifiedById === doctor.id, l2r);
  check('result.updatedAt equals serverRecord.updatedAt (the version to build on)', l2r && l2r.updatedAt === l2r.serverRecord.updatedAt, l2r);
  check('the phone\'s stale change was NOT applied', (await prisma.patient.findUnique({ where: { id: PL } })).phone === null);

  // (2) stale WITH the old baseUpdatedAt
  const l3 = await upload(asha1.token, { patients: [{ id: PL, phone: '9666666666', baseUpdatedAt: lBaseP }] });
  const l3r = findResult(l3, 'patient', PL);
  check('stale resend WITH the old baseUpdatedAt → conflict + serverRecord', l3r && l3r.status === 'conflict' && l3r.serverRecord && l3r.serverRecord.village === 'Mulshi', l3r);

  // (3) same for a follow-up
  const l4 = await upload(asha1.token, { followups: [{ id: FL, status: 'COMPLETED', notes: 'ASHA final note', baseUpdatedAt: lBaseF }] });
  const l4r = findResult(l4, 'followup', FL);
  check('stale follow-up edit → conflict; serverRecord carries the doctor\'s note',
    l4r && l4r.status === 'conflict' && l4r.serverRecord && l4r.serverRecord.notes === 'Doctor note' && l4r.serverRecord.status === 'PENDING', l4r);
  check('...and nothing was overwritten', (await prisma.followUp.findUnique({ where: { id: FL } })).notes === 'Doctor note');

  // serverRecord has exactly the shape the download endpoint returns.
  const dlL = (await download(asha1.token, '0')).data.patients.find((p) => p.id === PL);
  check('serverRecord has the same fields as a downloaded patient',
    JSON.stringify(Object.keys(l2r.serverRecord).sort()) === JSON.stringify(Object.keys(dlL).sort()));

  // Recovery: the phone replaces its local copy with serverRecord, re-applies the edit on top, resends.
  const l5 = await upload(asha1.token, { patients: [{ id: PL, phone: '9666666666', baseUpdatedAt: l2r.serverRecord.updatedAt }] });
  const l5r = findResult(l5, 'patient', PL);
  const lNow = await prisma.patient.findUnique({ where: { id: PL } });
  check('recovery: re-apply on top of serverRecord using its updatedAt → ok',
    l5r && l5r.status === 'ok' && lNow.phone === '9666666666' && lNow.village === 'Mulshi' && lNow.lastModifiedById === asha1.id, l5r);

  // ══════════════════════════════════════════════════════════════════════════════
  // Assessments (structured forms). Scenarios M–S.
  // ══════════════════════════════════════════════════════════════════════════════
  const mkPatient = (id, extra = {}) => ({
    id, name: `Assess ${id.slice(0, 4)}`, dateOfBirth: '1990-03-03', gender: 'FEMALE',
    village: 'Velhe', district: 'Pune', state: 'Maharashtra', ...extra,
  });
  const mkAssessment = (id, patientId, extra = {}) => ({
    id, patientId, formId: 'anc_visit', formVersion: 2,
    answers: { headache: 'severe', bp_checked: true },
    score: 7, triageLevel: 'REFER_SOON', triageReasons: ['BP >= 140/90', 'Severe headache'],
    completedAt: daysAgo(1), ...extra,
  });
  const dbAssessment = (id) => prisma.assessment.findUnique({ where: { id } });
  const countAssessments = (patientId) => prisma.assessment.count({ where: { patientId } });

  // ── M ──────────────────────────────────────────────────────────────────────
  section('M. Assessments: one batch, the phone\'s values kept, timeline event, idempotent retry');
  const PM = randomUUID(), EM = randomUUID(), VM = randomUUID(), AM = randomUUID();
  createdPatientIds.add(PM);
  const mCompleted = daysAgo(2);
  const mAnswers = { headache: 'severe', bp_checked: true, weeks_pregnant: 30, notes: { a: 1, b: [1, 2] } };
  const mBatch = {
    // Listed first on purpose: the server orders by record type (…vitals → assessments…).
    assessments: [mkAssessment(AM, PM, {
      encounterId: EM, answers: mAnswers, completedAt: mCompleted,
      serverTriageLevel: 'ROUTINE', // a phone must not be able to set the server's triage — stripped
      recordedById: doctor.id, // never trusted from the payload either
    })],
    vitals: [{ id: VM, patientId: PM, encounterId: EM, bpSystolic: 150, bpDiastolic: 95, recordedAt: daysAgo(2) }],
    encounters: [{ id: EM, patientId: PM, encounterType: 'HOME_VISIT', encounterDate: daysAgo(2) }],
    patients: [mkPatient(PM)],
  };
  const m1 = await upload(asha1.token, mBatch);
  check('upload returns 200 with 4 results', m1.status === 200 && m1.data?.results?.length === 4, m1.body);
  check('processed in order patient → encounter → vitals → assessment',
    JSON.stringify(m1.data.results.map((r) => r.type)) === JSON.stringify(['patient', 'encounter', 'vitals', 'assessment']), m1.data.results);
  const m1a = findResult(m1, 'assessment', AM);
  check('assessment → ok, with the new server updatedAt', m1a && m1a.status === 'ok' && !isNaN(Date.parse(m1a.updatedAt)), m1a);
  const mRow = await dbAssessment(AM);
  check('client UUID is the primary key; patient/encounter/form fields stored',
    mRow && mRow.id === AM && mRow.patientId === PM && mRow.encounterId === EM && mRow.formId === 'anc_visit' && mRow.formVersion === 2, mRow);
  // Deep (order-independent) comparison: Postgres jsonb does not preserve object key order.
  check('answers (nested JSON), score, triageLevel, triageReasons stored as sent',
    isDeepStrictEqual(mRow.answers, mAnswers) && mRow.score === 7 && mRow.triageLevel === 'REFER_SOON' &&
    JSON.stringify(mRow.triageReasons) === JSON.stringify(['BP >= 140/90', 'Severe headache']), mRow);
  check('completedAt is the PHONE\'s time, not the sync time', mRow.completedAt.getTime() === new Date(mCompleted).getTime(), mRow.completedAt);
  check('recordedById / lastModifiedById = the authenticated ASHA (payload value ignored)',
    mRow.recordedById === asha1.id && mRow.lastModifiedById === asha1.id, mRow);
  check('the phone cannot set the server triage columns', mRow.serverTriageLevel !== 'ROUTINE', mRow.serverTriageLevel);

  const tlM = await timelineTypes(asha1.token, PM);
  const evM = tlM.events.filter((e) => e.eventType === 'ASSESSMENT_COMPLETED');
  check('exactly one ASSESSMENT_COMPLETED timeline event', evM.length === 1, tlM.types);
  check('event description carries the triage level, the reasons and the form',
    evM[0] && /REFER_SOON/.test(evM[0].description) && /BP >= 140\/90; Severe headache/.test(evM[0].description) && /anc_visit/.test(evM[0].description), evM[0]);
  check('event references the assessment and is stamped with the phone\'s completedAt',
    evM[0] && evM[0].referenceId === AM && new Date(evM[0].createdAt).getTime() === new Date(mCompleted).getTime(), evM[0]);

  const m2 = await upload(asha1.token, mBatch);
  check('re-sending the identical batch → all ok', m2.data.results.length === 4 && m2.data.results.every((r) => r.status === 'ok'), m2.data.results);
  check('...no duplicate assessment row', (await countAssessments(PM)) === 1);
  check('...no duplicate timeline event', count((await timelineTypes(asha1.token, PM)).types, 'ASSESSMENT_COMPLETED') === 1);
  check('...updatedAt unchanged (a pure retry writes nothing)', findResult(m2, 'assessment', AM).updatedAt === m1a.updatedAt);
  const m3 = await upload(asha1.token, {
    assessments: [mkAssessment(AM, PM, {
      encounterId: EM, completedAt: mCompleted,
      answers: { notes: { b: [1, 2], a: 1 }, weeks_pregnant: 30, bp_checked: true, headache: 'severe' }, // same content, keys reordered
    })],
  });
  check('same answers with the keys in a different order → still a no-op retry',
    findResult(m3, 'assessment', AM).status === 'ok' && findResult(m3, 'assessment', AM).updatedAt === m1a.updatedAt, m3.data.results);

  // ── N ──────────────────────────────────────────────────────────────────────
  section('N. The server\'s own triage (existing rule engine) is stored SEPARATELY from the phone\'s result');
  const PN1 = randomUUID(), VN1 = randomUUID(), AN1 = randomUUID();
  const PN2 = randomUUID(), EN2 = randomUUID(), AN2 = randomUUID();
  const PN3 = randomUUID(), AN3 = randomUUID();
  [PN1, PN2, PN3].forEach((p) => createdPatientIds.add(p));
  const n1 = await upload(asha1.token, {
    patients: [mkPatient(PN1), mkPatient(PN2), mkPatient(PN3)],
    encounters: [{ id: EN2, patientId: PN2, encounterType: 'HOME_VISIT', symptoms: ['Unconscious'] }],
    vitals: [{ id: VN1, patientId: PN1, bpSystolic: 190, bpDiastolic: 125, oxygenSaturation: 90 }],
    assessments: [
      mkAssessment(AN1, PN1, { triageLevel: 'WATCH', triageReasons: ['Phone thinks: watch'] }),
      mkAssessment(AN2, PN2, { encounterId: EN2, triageLevel: 'ROUTINE', triageReasons: [] }),
      mkAssessment(AN3, PN3, { triageLevel: 'ROUTINE', triageReasons: [] }),
    ],
  });
  check('all records ok', n1.data.results.length === 8 && n1.data.results.every((r) => r.status === 'ok'), n1.data.results);
  const n1a = await dbAssessment(AN1);
  check('vitals-based: server triage HIGH with its own reasons, from the batch\'s vitals (they sync first)',
    n1a.serverTriageLevel === 'HIGH' && n1a.serverTriageScore === 5 && n1a.serverTriageReasons.includes('Low oxygen saturation'), n1a);
  check('...while the phone\'s result is untouched and on a different scale',
    n1a.triageLevel === 'WATCH' && JSON.stringify(n1a.triageReasons) === JSON.stringify(['Phone thinks: watch']), n1a);
  const n1b = await dbAssessment(AN2);
  check('symptom-based (linked encounter): red flag → EMERGENCY with the flag in the reasons',
    n1b.serverTriageLevel === 'EMERGENCY' && n1b.serverTriageReasons.includes('Red flag: unconscious'), n1b);
  check('...and the phone still says ROUTINE', n1b.triageLevel === 'ROUTINE');
  const n1c = await dbAssessment(AN3);
  check('nothing to assess (no vitals, no symptoms) → null, not a made-up LOW',
    n1c.serverTriageLevel === null && n1c.serverTriageScore === null && n1c.serverTriageReasons.length === 0, n1c);
  check('syncing an assessment does NOT create a referral (that stays a doctor\'s action)',
    (await prisma.referral.count({ where: { patientId: { in: [PN1, PN2, PN3] } } })) === 0);

  // ── O ──────────────────────────────────────────────────────────────────────
  section('O. Optimistic concurrency, same rules as vitals (baseUpdatedAt, lost response, someone else)');
  const oEdit = await upload(asha1.token, { assessments: [{ id: AM, answers: { ...mAnswers, headache: 'mild' }, triageLevel: 'WATCH', baseUpdatedAt: m1a.updatedAt }] });
  const oEditR = findResult(oEdit, 'assessment', AM);
  check('edit with the right baseUpdatedAt → ok and a NEW updatedAt', oEditR.status === 'ok' && oEditR.updatedAt !== m1a.updatedAt, oEditR);
  const oRow = await dbAssessment(AM);
  check('...answers and triageLevel changed; fixed fields untouched',
    oRow.answers.headache === 'mild' && oRow.triageLevel === 'WATCH' && oRow.formId === 'anc_visit' && oRow.encounterId === EM && oRow.lastModifiedById === asha1.id, oRow);
  check('...an edit does not add another timeline event', count((await timelineTypes(asha1.token, PM)).types, 'ASSESSMENT_COMPLETED') === 1);

  const oStale = await upload(asha1.token, { assessments: [{ id: AM, score: 99, baseUpdatedAt: m1a.updatedAt }] });
  const oStaleR = findResult(oStale, 'assessment', AM);
  check('stale baseUpdatedAt → conflict, nothing overwritten',
    oStaleR.status === 'conflict' && (await dbAssessment(AM)).score === 7, oStaleR);
  check('conflict carries serverRecord = the server\'s current row',
    oStaleR.serverRecord && oStaleR.serverRecord.id === AM && oStaleR.serverRecord.answers.headache === 'mild' && oStaleR.updatedAt === oStaleR.serverRecord.updatedAt, oStaleR);
  const dlShape = (await download(asha1.token, '0')).data.assessments.find((x) => x.id === AM);
  check('serverRecord has the same fields as a downloaded assessment',
    JSON.stringify(Object.keys(oStaleR.serverRecord).sort()) === JSON.stringify(Object.keys(dlShape).sort()));

  const oLost = await upload(asha1.token, { assessments: [{ id: AM, score: 8 }] });
  check('lost response (NO baseUpdatedAt, ASHA was the last writer) → edit applied',
    findResult(oLost, 'assessment', AM).status === 'ok' && (await dbAssessment(AM)).score === 8, oLost.data.results);

  await prisma.assessment.update({ where: { id: AM }, data: { lastModifiedById: doctor.id } });
  const oOther = await upload(asha1.token, { assessments: [{ id: AM, score: 9 }] });
  const oOtherR = findResult(oOther, 'assessment', AM);
  check('someone else last modified it and no baseUpdatedAt → conflict with serverRecord',
    oOtherR.status === 'conflict' && oOtherR.serverRecord && oOtherR.serverRecord.lastModifiedById === doctor.id && (await dbAssessment(AM)).score === 8, oOtherR);

  // ── P ──────────────────────────────────────────────────────────────────────
  section('P. Ownership through the patient, fixed fields, validation, per-record independence');
  const p1 = await upload(asha2.token, { assessments: [{ id: AM, score: 1 }] });
  check('ANOTHER ASHA cannot update the assessment → error (same message as "not found")',
    findResult(p1, 'assessment', AM).status === 'error' && /not found or is not assigned/.test(findResult(p1, 'assessment', AM).message), p1.data.results);
  const p2 = await upload(asha2.token, { assessments: [mkAssessment(randomUUID(), PM)] });
  check('ANOTHER ASHA cannot create an assessment for this patient → error', p2.data.results[0].status === 'error', p2.data.results);
  check('...and nothing was written', (await countAssessments(PM)) === 1);

  const fresh = await dbAssessment(AM);
  for (const [field, value, re] of [
    ['formId', 'general_screening', /formId cannot be changed/],
    ['formVersion', 3, /formVersion cannot be changed/],
    ['patientId', PN1, /patientId cannot be changed/],
    ['encounterId', null, /encounterId cannot be changed/],
  ]) {
    const r = findResult(await upload(asha1.token, { assessments: [{ id: AM, [field]: value, baseUpdatedAt: fresh.updatedAt.toISOString() }] }), 'assessment', AM);
    check(`changing ${field} on an existing assessment → error`, r.status === 'error' && re.test(r.message), r);
  }
  const p3 = await upload(asha1.token, { assessments: [mkAssessment(randomUUID(), PM, { encounterId: E })] });
  check('encounter belonging to another patient → error', p3.data.results[0].status === 'error' && /does not exist for this patient/.test(p3.data.results[0].message), p3.data.results);
  const p4 = await upload(asha1.token, { assessments: [{ id: randomUUID(), patientId: PM }] });
  check('new assessment missing required fields → error naming them',
    p4.data.results[0].status === 'error' && /formId/.test(p4.data.results[0].message) && /answers/.test(p4.data.results[0].message) &&
    /triageLevel/.test(p4.data.results[0].message) && /completedAt/.test(p4.data.results[0].message), p4.data.results);
  const p5 = await upload(asha1.token, { assessments: [mkAssessment(randomUUID(), PM, { triageLevel: 'HIGH' })] });
  check('triageLevel must be EMERGENCY|REFER_SOON|WATCH|ROUTINE (the server\'s HIGH is not valid here)',
    p5.data.results[0].status === 'error' && /triageLevel/.test(p5.data.results[0].message), p5.data.results);
  const p6 = await upload(asha1.token, { assessments: [mkAssessment(randomUUID(), PM, { answers: ['not', 'an', 'object'] })] });
  check('answers must be an object (key → value)', p6.data.results[0].status === 'error' && /answers/.test(p6.data.results[0].message), p6.data.results);
  const p7 = await upload(asha1.token, { assessments: [mkAssessment('not-a-uuid', PM)] });
  check('malformed id → per-record validation error', p7.data.results[0].status === 'error', p7.data.results);
  const p8 = await upload(asha1.token, { assessments: [mkAssessment('cabcdefghijklmnopqrstuvwx', PM)] });
  check('a NEW assessment needs a UUID id (a server-style id is refused)', p8.data.results[0].status === 'error' && /UUID/.test(p8.data.results[0].message), p8.data.results);
  const goodId = randomUUID();
  const p9 = await upload(asha1.token, { assessments: [mkAssessment(randomUUID(), PM, { formVersion: 0 }), mkAssessment(goodId, PM, { completedAt: daysAgo(4) })] });
  check('one bad assessment does not block a good one in the same batch',
    p9.data.results[0].status === 'error' && p9.data.results[1].status === 'ok', p9.data.results);

  // ── Q ──────────────────────────────────────────────────────────────────────
  section('Q. Download: the ASHA\'s patients\' assessments, incremental, and the existing keys are unchanged');
  const q1 = await download(asha1.token, '0');
  const q1a = q1.data.assessments.find((x) => x.id === AM);
  check('download has an "assessments" array', Array.isArray(q1.data.assessments));
  check('full object: answers, both triage results, ids and timestamps',
    q1a && q1a.answers.headache === 'mild' && q1a.triageLevel === 'WATCH' && 'serverTriageLevel' in q1a && 'serverTriageReasons' in q1a &&
    q1a.patientId === PM && q1a.recordedById === asha1.id && !!q1a.updatedAt && !!q1a.completedAt, q1a);
  check('a record for each of this ASHA\'s patients is present', [AN1, AN2, AN3].every((id) => q1.data.assessments.some((x) => x.id === id)));
  check('another ASHA does NOT receive them', !(await download(asha2.token, '0')).data.assessments.some((x) => x.id === AM || x.id === AN1));
  check('every pre-existing download key is still there (additive change only)',
    ['serverTimestamp', 'deviceId', 'patients', 'encounters', 'vitals', 'prescriptions', 'referrals', 'followups', 'facilities'].every((k) => k in q1.data));
  const q2 = await download(asha1.token, q1.data.serverTimestamp);
  check('with an up-to-date lastSyncedAt → no assessments', q2.data.assessments.length === 0, q2.data.assessments.length);
  const stamp = q1.data.serverTimestamp;
  await upload(asha1.token, { assessments: [{ id: goodId, score: 3 }] }); // ASHA is the last writer → applied
  const q3 = await download(asha1.token, stamp);
  check('an updated assessment appears in the next incremental download', q3.data.assessments.some((x) => x.id === goodId && x.score === 3), q3.data.assessments.map((x) => x.id));

  // ── R ──────────────────────────────────────────────────────────────────────
  section('R. GET /api/patients/:id/assessments — clinical roles only, newest first');
  const hadmin = await makeWebUser('HOSPITAL_ADMIN');
  const specialist = await makeWebUser('SPECIALIST');
  const sysadmin = await makeWebUser('SYSTEM_ADMIN');
  // Sync the NEWER assessment first, then an OLDER one: "newest first" must follow completedAt, not arrival order.
  const PR = randomUUID(), RNew = randomUUID(), ROld = randomUUID();
  createdPatientIds.add(PR);
  await upload(asha1.token, { patients: [mkPatient(PR)], assessments: [mkAssessment(RNew, PR, { triageLevel: 'ROUTINE', triageReasons: [], completedAt: daysAgo(1) })] });
  await upload(asha1.token, { assessments: [mkAssessment(ROld, PR, { triageLevel: 'REFER_SOON', completedAt: daysAgo(6) })] });
  const r1 = await api('GET', `/api/patients/${PR}/assessments`, doctor.token);
  check('a DOCTOR gets 200', r1.status === 200, r1.body);
  check('response: { patientId, assessments[] }', r1.data.patientId === PR && Array.isArray(r1.data.assessments), r1.body);
  check('newest first by completedAt (not by when they synced)',
    r1.data.assessments.length === 2 && r1.data.assessments[0].id === RNew && r1.data.assessments[1].id === ROld, r1.data.assessments.map((x) => x.id));
  check('each item has the phone\'s triage, the server\'s triage and who recorded it',
    r1.data.assessments[1].triageLevel === 'REFER_SOON' && 'serverTriageLevel' in r1.data.assessments[1] && r1.data.assessments[1].recordedBy?.id === asha1.id, r1.data.assessments[1]);
  check('SPECIALIST, HOSPITAL_ADMIN and SYSTEM_ADMIN are allowed',
    (await api('GET', `/api/patients/${PR}/assessments`, specialist.token)).status === 200 &&
    (await api('GET', `/api/patients/${PR}/assessments`, hadmin.token)).status === 200 &&
    (await api('GET', `/api/patients/${PR}/assessments`, sysadmin.token)).status === 200);
  check('an ASHA gets 403', (await api('GET', `/api/patients/${PR}/assessments`, asha1.token)).status === 403);
  check('no token → 401', (await api('GET', `/api/patients/${PR}/assessments`)).status === 401);
  check('unknown patient → 404', (await api('GET', `/api/patients/${randomUUID()}/assessments`, doctor.token)).status === 404);
  const rEmpty = await api('GET', `/api/patients/${PN3}/assessments`, doctor.token);
  check('a patient with one assessment returns exactly that one', rEmpty.status === 200 && rEmpty.data.assessments.length === 1);

  // ── S ──────────────────────────────────────────────────────────────────────
  section('S. GET /api/patients?triageLevel= — patients whose LATEST assessment has that level');
  // PS_A: older REFER_SOON, newer ROUTINE  → latest is ROUTINE
  // PS_B: newer REFER_SOON synced FIRST, older ROUTINE synced later → latest is REFER_SOON (completedAt, not arrival)
  // PS_C: no assessments at all
  const PS_A = randomUUID(), PS_B = randomUUID(), PS_C = randomUUID();
  [PS_A, PS_B, PS_C].forEach((p) => createdPatientIds.add(p));
  await upload(asha1.token, {
    patients: [mkPatient(PS_A), mkPatient(PS_B), mkPatient(PS_C)],
    assessments: [
      mkAssessment(randomUUID(), PS_A, { triageLevel: 'REFER_SOON', completedAt: daysAgo(5) }),
      mkAssessment(randomUUID(), PS_A, { triageLevel: 'ROUTINE', triageReasons: [], completedAt: daysAgo(1) }),
      mkAssessment(randomUUID(), PS_B, { triageLevel: 'REFER_SOON', completedAt: daysAgo(1) }),
    ],
  });
  await upload(asha1.token, { assessments: [mkAssessment(randomUUID(), PS_B, { triageLevel: 'ROUTINE', triageReasons: [], completedAt: daysAgo(7) })] });
  const ids = (resp) => resp.data.patients.map((p) => p.id);
  const s1 = await api('GET', '/api/patients?triageLevel=REFER_SOON&limit=100', doctor.token);
  check('?triageLevel=REFER_SOON → 200', s1.status === 200, s1.body);
  check('includes the patient whose latest is REFER_SOON, even though a later-synced older one says ROUTINE', ids(s1).includes(PS_B), ids(s1));
  check('excludes the patient whose EARLIER assessment was REFER_SOON but latest is ROUTINE', !ids(s1).includes(PS_A));
  check('excludes patients with no assessment', !ids(s1).includes(PS_C));
  check('every returned patient really has REFER_SOON as their latest',
    (await Promise.all(ids(s1).map((id) => prisma.assessment.findFirst({ where: { patientId: id }, orderBy: [{ completedAt: 'desc' }, { createdAt: 'desc' }] })))).every((a) => a && a.triageLevel === 'REFER_SOON'));
  check('pagination block is still returned', s1.data.pagination && s1.data.pagination.total === ids(s1).length, s1.data.pagination);
  const s2 = await api('GET', '/api/patients?triageLevel=ROUTINE&limit=100', doctor.token);
  check('?triageLevel=ROUTINE → PS_A yes, PS_B no', ids(s2).includes(PS_A) && !ids(s2).includes(PS_B), ids(s2));
  const s3 = await api('GET', `/api/patients?triageLevel=EMERGENCY&assignedAshaId=${asha2.id}&limit=100`, doctor.token);
  check('combines with the other filters (nothing for ASHA 2)', s3.status === 200 && s3.data.patients.length === 0, s3.body);
  check('an unknown level → 400 listing the valid ones',
    (await api('GET', '/api/patients?triageLevel=HIGH', doctor.token)).status === 400 && /REFER_SOON/.test((await api('GET', '/api/patients?triageLevel=urgent', doctor.token)).body.message));
  const s4 = await api('GET', '/api/patients?limit=100', doctor.token);
  check('WITHOUT the parameter the list is unchanged: all three patients present', [PS_A, PS_B, PS_C].every((id) => ids(s4).includes(id)), ids(s4).length);
  check('...with the same response shape', Object.keys(s4.data).sort().join() === 'pagination,patients' && s4.data.patients[0].assignedAsha !== undefined);
};

// ─── Main ─────────────────────────────────────────────────────────────────────
(async () => {
  try {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set (put it in .env).');
    await startServer();
    await run();
  } catch (err) {
    failed++;
    failures.push('unexpected error');
    console.error('\n✘ Test run aborted:', err.message);
    if (serverLog) console.error('\n--- server output ---\n' + serverLog.split('\n').slice(-25).join('\n'));
  } finally {
    try {
      await cleanup();
    } catch (err) {
      console.error('Cleanup failed:', err.message);
    }
    await prisma.$disconnect();
    if (server) server.kill();
    console.log(`\n${failed === 0 ? '✅ ALL PASSED' : '❌ FAILURES'} — ${passed} passed, ${failed} failed`);
    if (failed) console.log('Failed:\n  - ' + failures.join('\n  - '));
    process.exit(failed === 0 ? 0 : 1);
  }
})();
