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
 */

require('dotenv').config();

const { spawn } = require('node:child_process');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { PrismaClient } = require('@prisma/client');

const PORT = process.env.TEST_PORT || '3999';
const BASE = `http://localhost:${PORT}`;
const PASSWORD = 'Demo@1234'; // documented demo password (prisma/seed.js)

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

const cleanup = async () => {
  const ids = [...createdPatientIds];
  if (ids.length === 0) return;
  const referrals = await prisma.referral.findMany({ where: { patientId: { in: ids } }, select: { id: true } });
  const referralIds = referrals.map((r) => r.id);
  await prisma.timelineEvent.deleteMany({ where: { patientId: { in: ids } } });
  await prisma.referralEvent.deleteMany({ where: { referralId: { in: referralIds } } });
  await prisma.followUp.deleteMany({ where: { patientId: { in: ids } } });
  await prisma.prescription.deleteMany({ where: { patientId: { in: ids } } });
  await prisma.referral.deleteMany({ where: { patientId: { in: ids } } });
  await prisma.vitals.deleteMany({ where: { patientId: { in: ids } } });
  await prisma.encounter.deleteMany({ where: { patientId: { in: ids } } });
  await prisma.patient.deleteMany({ where: { id: { in: ids } } });
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

  const e4 = await upload(asha1.token, { patients: [{ id: P, phone: '9333333333' }] });
  const e4r = findResult(e4, 'patient', P);
  check('existing record + different content + NO baseUpdatedAt → conflict', e4r && e4r.status === 'conflict' && /baseUpdatedAt/.test(e4r.message), e4r);

  // Doctor edits the same patient on the web while the ASHA is offline.
  const webEdit = await api('PUT', `/api/patients/${P}`, doctor.token, { village: 'Mulshi' });
  check('doctor edits the patient on the web (200)', webEdit.status === 200, webEdit.body);
  const e5 = await upload(asha1.token, { patients: [{ id: P, address: 'Ward 4', baseUpdatedAt: U1 }] });
  check('ASHA edit based on the pre-doctor version → conflict (doctor\'s edit not overwritten)',
    findResult(e5, 'patient', P).status === 'conflict' && (await prisma.patient.findUnique({ where: { id: P } })).village === 'Mulshi');
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
