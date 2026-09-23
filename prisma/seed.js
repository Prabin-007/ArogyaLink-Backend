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

// Service master data and availability links for the same demo facilities.
// The seeding logic below creates only missing records, preserving any existing
// services and availability data.
const SERVICES = [
  {
    name: 'General Consultation',
    category: 'Clinical',
    description: 'Outpatient medical consultations',
    facilityIds: ['PHC-DEMO-001', 'PHC-DEMO-002', 'PHC-DEMO-003', 'CHC-DEMO-001', 'DH-DEMO-001', 'MC-DEMO-001'],
  },
  {
    name: 'Emergency Care',
    category: 'Emergency',
    description: 'Emergency assessment and stabilisation',
    facilityIds: ['CHC-DEMO-001', 'DH-DEMO-001', 'MC-DEMO-001'],
  },
  {
    name: 'Teleconsultation',
    category: 'Specialist Care',
    description: 'Remote consultation with a specialist',
    facilityIds: ['PHC-DEMO-001', 'PHC-DEMO-002', 'PHC-DEMO-003', 'CHC-DEMO-001', 'DH-DEMO-001'],
  },
  {
    name: 'X-Ray',
    category: 'Imaging',
    description: 'Diagnostic X-ray imaging',
    facilityIds: ['CHC-DEMO-001', 'DH-DEMO-001', 'MC-DEMO-001'],
  },
  {
    name: 'Ultrasound',
    category: 'Imaging',
    description: 'Ultrasound diagnostic imaging',
    facilityIds: ['DH-DEMO-001', 'MC-DEMO-001'],
  },
  {
    name: 'ECG',
    category: 'Diagnostics',
    description: 'Electrocardiogram testing',
    facilityIds: ['PHC-DEMO-001', 'PHC-DEMO-002', 'PHC-DEMO-003', 'CHC-DEMO-001', 'DH-DEMO-001', 'MC-DEMO-001'],
  },
  {
    name: 'Minor Surgery',
    category: 'Surgical',
    description: 'Minor surgical procedures',
    facilityIds: ['CHC-DEMO-001', 'DH-DEMO-001', 'MC-DEMO-001'],
  },
  {
    name: 'Maternal Care',
    category: 'Maternal and Child Health',
    description: 'Antenatal, delivery, and postnatal care',
    facilityIds: ['SC-DEMO-001', 'SC-DEMO-002', 'SC-DEMO-003', 'SC-DEMO-004', 'PHC-DEMO-001', 'PHC-DEMO-002', 'PHC-DEMO-003', 'CHC-DEMO-001', 'DH-DEMO-001', 'MC-DEMO-001'],
  },
  {
    name: 'Child Care',
    category: 'Maternal and Child Health',
    description: 'Child health and immunisation services',
    facilityIds: ['SC-DEMO-001', 'SC-DEMO-002', 'SC-DEMO-003', 'SC-DEMO-004', 'PHC-DEMO-001', 'PHC-DEMO-002', 'PHC-DEMO-003', 'CHC-DEMO-001', 'DH-DEMO-001', 'MC-DEMO-001'],
  },
  {
    name: 'Pharmacy',
    category: 'Support Services',
    description: 'Dispensing of medicines and supplies',
    facilityIds: ['PHC-DEMO-001', 'PHC-DEMO-002', 'PHC-DEMO-003', 'CHC-DEMO-001', 'DH-DEMO-001', 'MC-DEMO-001'],
  },
  {
    name: 'Ambulance Service',
    category: 'Emergency',
    description: 'Patient transport for emergencies and referrals',
    facilityIds: ['CHC-DEMO-001', 'DH-DEMO-001', 'MC-DEMO-001'],
  },
  {
    name: 'Laboratory Services',
    category: 'Diagnostics',
    description: 'Routine laboratory investigations',
    facilityIds: ['PHC-DEMO-001', 'PHC-DEMO-002', 'PHC-DEMO-003', 'CHC-DEMO-001', 'DH-DEMO-001', 'MC-DEMO-001'],
  },
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

  let createdServices = 0;
  let createdAvailabilityRecords = 0;

  for (const demoService of SERVICES) {
    const { facilityIds, ...serviceData } = demoService;
    let service = await prisma.service.findFirst({
      where: { name: serviceData.name },
      orderBy: { createdAt: 'asc' },
    });

    if (!service) {
      service = await prisma.service.create({
        data: serviceData,
      });
      createdServices += 1;
    }

    for (const facilityId of facilityIds) {
      // 1. Person 6 ServiceAvailability
      const existingAvailability = await prisma.serviceAvailability.findUnique({
        where: {
          serviceId_facilityId: {
            serviceId: service.id,
            facilityId,
          },
        },
      });

      if (!existingAvailability) {
        await prisma.serviceAvailability.create({
          data: {
            serviceId: service.id,
            facilityId,
            available: true,
          },
        });
        createdAvailabilityRecords += 1;
      }

      // 2. Person 4 FacilityService (matching legacy table)
      await prisma.facilityService.upsert({
        where: {
          facilityId_serviceName: {
            facilityId,
            serviceName: service.name,
          },
        },
        create: {
          facilityId,
          serviceName: service.name,
          available: true,
        },
        update: {
          available: true,
        },
      });
    }
  }
  console.log(
    `✔ Seeded ${createdServices} new demo services and ${createdAvailabilityRecords} service availability records (synced with facility_services)`
  );

  // ── Seed Specialists (Person 4 Smart Referral) ─────────────────────────────
  const SPECIALISTS = [
    { specialization: 'CARDIOLOGIST', doctorCount: 2, maleDoctorCount: 1, femaleDoctorCount: 1, facilityIds: ['DH-DEMO-001', 'MC-DEMO-001'] },
    { specialization: 'PEDIATRICIAN', doctorCount: 3, maleDoctorCount: 1, femaleDoctorCount: 2, facilityIds: ['CHC-DEMO-001', 'DH-DEMO-001', 'MC-DEMO-001'] },
    { specialization: 'GYNECOLOGIST', doctorCount: 2, maleDoctorCount: 0, femaleDoctorCount: 2, facilityIds: ['PHC-DEMO-001', 'CHC-DEMO-001', 'DH-DEMO-001', 'MC-DEMO-001'] },
    { specialization: 'GENERAL_PHYSICIAN', doctorCount: 4, maleDoctorCount: 2, femaleDoctorCount: 2, facilityIds: ['PHC-DEMO-001', 'PHC-DEMO-002', 'PHC-DEMO-003', 'CHC-DEMO-001', 'DH-DEMO-001', 'MC-DEMO-001'] },
  ];

  for (const sp of SPECIALISTS) {
    for (const facilityId of sp.facilityIds) {
      await prisma.facilitySpecialist.upsert({
        where: {
          facilityId_specialization: {
            facilityId,
            specialization: sp.specialization,
          },
        },
        create: {
          facilityId,
          specialization: sp.specialization,
          doctorCount: sp.doctorCount,
          maleDoctorCount: sp.maleDoctorCount,
          femaleDoctorCount: sp.femaleDoctorCount,
          available: true,
        },
        update: {
          doctorCount: sp.doctorCount,
          available: true,
        },
      });
    }
  }
  console.log(`✔ Seeded specialists for Smart Referral AI across facilities`);

  // ── Seed Diagnostic Tests (Person 4 & Person 6) ───────────────────────────
  const DIAGNOSTIC_TESTS = [
    { name: 'ECG', category: 'Cardiology', description: 'Electrocardiogram test', facilityIds: ['PHC-DEMO-001', 'PHC-DEMO-002', 'CHC-DEMO-001', 'DH-DEMO-001', 'MC-DEMO-001'] },
    { name: 'X-Ray', category: 'Radiology', description: 'Diagnostic X-Ray', facilityIds: ['CHC-DEMO-001', 'DH-DEMO-001', 'MC-DEMO-001'] },
    { name: 'Ultrasound', category: 'Radiology', description: 'Ultrasound scanner', facilityIds: ['DH-DEMO-001', 'MC-DEMO-001'] },
    { name: 'Blood Test', category: 'Pathology', description: 'Routine lab tests', facilityIds: ['PHC-DEMO-001', 'PHC-DEMO-002', 'PHC-DEMO-003', 'CHC-DEMO-001', 'DH-DEMO-001', 'MC-DEMO-001'] },
  ];

  for (const dt of DIAGNOSTIC_TESTS) {
    let test = await prisma.diagnosticTest.findFirst({
      where: { name: dt.name },
    });
    if (!test) {
      test = await prisma.diagnosticTest.create({
        data: {
          name: dt.name,
          category: dt.category,
          description: dt.description,
        },
      });
    }

    for (const facilityId of dt.facilityIds) {
      // Person 6 DiagnosticAvailability
      await prisma.diagnosticAvailability.upsert({
        where: {
          testId_facilityId: {
            testId: test.id,
            facilityId,
          },
        },
        create: {
          testId: test.id,
          facilityId,
          available: true,
        },
        update: {
          available: true,
        },
      });

      // Person 4 FacilityResource
      await prisma.facilityResource.upsert({
        where: {
          facilityId_resourceName: {
            facilityId,
            resourceName: dt.name,
          },
        },
        create: {
          facilityId,
          resourceName: dt.name,
          available: true,
        },
        update: {
          available: true,
        },
      });
    }
  }
  console.log(`✔ Seeded diagnostic equipment & availability across facilities`);

  // ── Seed Medicines & Stock (Person 6) ──────────────────────────────────────
  const MEDICINES = [
    { name: 'Paracetamol', strength: '500mg', form: 'Tablet', description: 'Analgesic and antipyretic', defaultQty: 250 },
    { name: 'Amoxicillin', strength: '500mg', form: 'Capsule', description: 'Broad-spectrum antibiotic', defaultQty: 180 },
    { name: 'Metformin', strength: '500mg', form: 'Tablet', description: 'Anti-diabetic medicine', defaultQty: 120 },
    { name: 'Atorvastatin', strength: '10mg', form: 'Tablet', description: 'Lipid-lowering medication', defaultQty: 90 },
    { name: 'ORS', strength: '20.5g', form: 'Sachet', description: 'Oral rehydration salts', defaultQty: 300 },
  ];

  for (const m of MEDICINES) {
    let med = await prisma.medicine.findFirst({
      where: { name: m.name },
    });
    if (!med) {
      med = await prisma.medicine.create({
        data: {
          name: m.name,
          strength: m.strength,
          form: m.form,
          description: m.description,
        },
      });
    }

    // Give inventory to PHC, CHC, DH, MC
    const targetFacilities = ['PHC-DEMO-001', 'PHC-DEMO-002', 'CHC-DEMO-001', 'DH-DEMO-001', 'MC-DEMO-001'];
    for (const facilityId of targetFacilities) {
      await prisma.medicineInventory.upsert({
        where: {
          medicineId_facilityId: {
            medicineId: med.id,
            facilityId,
          },
        },
        create: {
          medicineId: med.id,
          facilityId,
          quantity: m.defaultQty,
        },
        update: {
          quantity: m.defaultQty,
        },
      });
    }
  }
  console.log(`✔ Seeded medicines and live inventory across facilities`);

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
