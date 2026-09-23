/**
 * prisma/seed.js
 * ---------------
 * Seeds DEMO data: a fictional set of Maharashtra health facilities plus demo
 * users so the mobile app and the automated tests can log in.
 *
 * Run with:  npx prisma db seed      (or: npm run db:seed)
 * Safe to run repeatedly — everything is upserted by a fixed key.
 *
 * ⚠️  DEMO ONLY. Facility IDs (PHC-DEMO-001, ...) and user credentials are
 * fictional and public (they are in the README). Never seed this into a real
 * production database.
 */

require('dotenv').config();
const bcrypt = require('bcryptjs');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

// Shared by all demo users. Documented in README.md.
const DEMO_PASSWORD = 'Demo@1234';

const DISTRICT = 'Pune';
const STATE = 'Maharashtra';

// Fictional facilities in one district. Coordinates are approximate so that a
// map / "nearest facility" demo looks plausible.
const FACILITIES = [
  { id: 'SC-DEMO-001',   name: 'Demo Sub-Centre Velhe',        type: 'SUB_CENTRE',        latitude: 18.2810, longitude: 73.6210, phone: '020-5550-0001' },
  { id: 'SC-DEMO-002',   name: 'Demo Sub-Centre Mulshi',       type: 'SUB_CENTRE',        latitude: 18.5140, longitude: 73.5120, phone: '020-5550-0002' },
  { id: 'SC-DEMO-003',   name: 'Demo Sub-Centre Bhor',         type: 'SUB_CENTRE',        latitude: 18.1500, longitude: 73.8450, phone: '020-5550-0003' },
  { id: 'SC-DEMO-004',   name: 'Demo Sub-Centre Purandar',     type: 'SUB_CENTRE',        latitude: 18.2830, longitude: 74.0330, phone: '020-5550-0004' },
  { id: 'PHC-DEMO-001',  name: 'Demo PHC Velhe',               type: 'PHC',               latitude: 18.2900, longitude: 73.6300, phone: '020-5550-0101' },
  { id: 'PHC-DEMO-002',  name: 'Demo PHC Mulshi',              type: 'PHC',               latitude: 18.5200, longitude: 73.5200, phone: '020-5550-0102' },
  { id: 'PHC-DEMO-003',  name: 'Demo PHC Bhor',                type: 'PHC',               latitude: 18.1600, longitude: 73.8500, phone: '020-5550-0103' },
  { id: 'CHC-DEMO-001',  name: 'Demo Community Health Centre Pirangut', type: 'CHC',      latitude: 18.5330, longitude: 73.6850, phone: '020-5550-0201' },
  { id: 'DH-DEMO-001',   name: 'Demo District Hospital Pune',  type: 'DISTRICT_HOSPITAL', latitude: 18.5204, longitude: 73.8567, phone: '020-5550-0301', emergencyCapability: true},
  { id: 'MC-DEMO-001',   name: 'Demo Medical College & Hospital Pune', type: 'MEDICAL_COLLEGE', latitude: 18.5310, longitude: 73.8740, phone: '020-5550-0401', emergencyCapability: true},
];

// Two ASHAs (the second lets the tests prove ASHA A cannot touch ASHA B's
// patients) and one doctor.
const USERS = [
  { identifier: 'ASHA-DEMO-001', role: 'ASHA',   name: 'Demo ASHA One (Sunita Patil)', phone: '9000000001' },
  { identifier: 'ASHA-DEMO-002', role: 'ASHA',   name: 'Demo ASHA Two (Rekha Jadhav)', phone: '9000000002' },
  { identifier: 'DOC-DEMO-001',  role: 'DOCTOR', name: 'Dr. Demo Kulkarni',            phone: '9000000101' },
];

async function main() {
  for (const f of FACILITIES) {
    const data = { ...f, district: DISTRICT, state: STATE };
    await prisma.facility.upsert({ where: { id: f.id }, update: data, create: data });
  }
  console.log(`✔ Seeded ${FACILITIES.length} demo facilities (${DISTRICT}, ${STATE})`);

  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);
  for (const u of USERS) {
    // `identifier` is unique; the password is (re)set so the documented one always works.
    await prisma.user.upsert({
      where: { identifier: u.identifier },
      update: { name: u.name, phone: u.phone, role: u.role, passwordHash, isActive: true },
      create: { ...u, passwordHash, isActive: true },
    });
  }
  console.log(`✔ Seeded ${USERS.length} demo users (password for all: ${DEMO_PASSWORD})`);
}

main()
  .catch((err) => {
    console.error('Seed failed:', err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
