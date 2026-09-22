// const { PrismaClient } = require('@prisma/client');
// const bcrypt = require('bcryptjs');

// const prisma = new PrismaClient();

// async function main() {
//   console.log('🌱 Starting database seeding...');

//   try {
//     // 1. Clear existing data
//     console.log('🧹 Clearing existing data...');
//     await prisma.teleconsultationRequest.deleteMany();
//     await prisma.referralEvent.deleteMany();
//     await prisma.followUp.deleteMany();
//     await prisma.prescription.deleteMany();
//     await prisma.vitals.deleteMany();
//     await prisma.timelineEvent.deleteMany();
//     await prisma.encounter.deleteMany();
//     await prisma.referral.deleteMany();
//     await prisma.patient.deleteMany();
//     await prisma.user.deleteMany();
//     console.log('✅ Existing data cleared');

//     // Password hashing
//     const hashedPassword = await bcrypt.hash('password123', 10);

//     // 2. Create Users
//     console.log('👤 Creating users...');
//     const usersData = [
//       { identifier: 'asha_priya', name: 'Priya Devi', phone: '9876543210', role: 'ASHA' },
//       { identifier: 'anm_sunita', name: 'Sunita Kumari', phone: '9876543211', role: 'ANM' },
//       { identifier: 'dr_sharma', name: 'Dr. Rajesh Sharma', phone: '9876543212', role: 'DOCTOR' },
//       { identifier: 'dr_kulkarni', name: 'Dr. Anita Kulkarni', phone: '9876543213', role: 'SPECIALIST' },
//       { identifier: 'dr_banerjee', name: 'Dr. Suman Banerjee', phone: '9876543214', role: 'SPECIALIST' },
//       { identifier: 'admin_arogyalink', name: 'System Administrator', phone: '9876543215', role: 'SYSTEM_ADMIN' },
//       { identifier: 'hospital_delhi', name: 'Delhi District Hospital Admin', phone: '9876543216', role: 'HOSPITAL_ADMIN' }
//     ];

//     const users = {};
//     for (const u of usersData) {
//       users[u.identifier] = await prisma.user.create({
//         data: {
//           identifier: u.identifier,
//           name: u.name,
//           phone: u.phone,
//           role: u.role,
//           passwordHash: hashedPassword,
//         }
//       });
//     }
//     console.log('✅ Users created');

//     // 3. Create Patients
//     console.log('🤒 Creating patients...');
//     const patientsData = [
//       { idKey: 'ramesh', name: 'Ramesh Kumar', gender: 'MALE', dob: new Date('1985-03-15'), village: 'Chandpur', district: 'Varanasi', state: 'Uttar Pradesh', phone: '9111222333', ashaId: users['asha_priya'].id },
//       { idKey: 'sunita', name: 'Sunita Devi', gender: 'FEMALE', dob: new Date('1992-07-22'), village: 'Mahua', district: 'Varanasi', state: 'Uttar Pradesh', phone: '9111222334', ashaId: users['asha_priya'].id },
//       { idKey: 'mohan', name: 'Mohan Lal', gender: 'MALE', dob: new Date('1958-11-03'), village: 'Sarai', district: 'Jaunpur', state: 'Uttar Pradesh', phone: '9111222335', ashaId: users['anm_sunita'].id },
//       { idKey: 'lakshmi', name: 'Lakshmi Bai', gender: 'FEMALE', dob: new Date('1975-01-28'), village: 'Dhanupura', district: 'Jaunpur', state: 'Uttar Pradesh', phone: '9111222336', ashaId: users['anm_sunita'].id },
//       { idKey: 'arjun', name: 'Arjun Singh', gender: 'MALE', dob: new Date('2001-09-10'), village: 'Bhagwanpur', district: 'Varanasi', state: 'Uttar Pradesh', phone: null, ashaId: users['asha_priya'].id },
//       { idKey: 'meera', name: 'Meera Kumari', gender: 'FEMALE', dob: new Date('2018-04-05'), village: 'Chandpur', district: 'Varanasi', state: 'Uttar Pradesh', phone: '9111222337', ashaId: users['asha_priya'].id }
//     ];

//     const patients = {};
//     for (const p of patientsData) {
//       patients[p.idKey] = await prisma.patient.create({
//         data: {
//           name: p.name,
//           gender: p.gender,
//           dateOfBirth: p.dob,
//           village: p.village,
//           district: p.district,
//           state: p.state,
//           phone: p.phone,
//           //assignedToId: p.ashaId
//                 assignedAsha: {
//         connect: {
//           id: p.ashaId
//         }
// }
//         }
//       });
//       // PATIENT_REGISTERED TimelineEvent
// //       await prisma.timelineEvent.create({
// //         // data: {
// //         //   patientId: patients[p.idKey].id,
// //         //   type: 'PATIENT_REGISTERED',
// //         //   title: 'Patient Registered',
// //         //   description: `Patient ${p.name} registered in the system`,
// //         //   userId: p.ashaId,
// //         //   date: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) // Registered a month ago
// //         // }
// //                     data: {
// //               name: p.name,
// //               gender: p.gender,
// //               dateOfBirth: p.dob,
// //               village: p.village,
// //               district: p.district,
// //               state: p.state,
// //               phone: p.phone,
// //               assignedAsha: {
// //                 connect: {
// //                   id: p.ashaId
// //                 }
// //           }
// // }
// //       });

//         await prisma.timelineEvent.create({
//     data: {
//       patientId: patients[p.idKey].id,
//       eventType: "PATIENT_REGISTERED",
//       description: `Patient ${p.name} was registered by ASHA.`
//     }
//   });
//     }
//     console.log('✅ Patients created');

//     // 4. Create Encounters
//     console.log('🩺 Creating encounters...');
//     const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
//     const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
//     const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
//     const oneDayAgo = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000);
//     const today = new Date();

//     const encountersData = [
//       { idKey: 'enc1', patientId: patients['ramesh'].id, userId: users['dr_sharma'].id, type: 'PHC_VISIT', date: fiveDaysAgo, symptoms: ['Persistent cough', 'Mild fever'], notes: 'Patient presents with productive cough for 5 days...' },
//       { idKey: 'enc2', patientId: patients['mohan'].id, userId: users['dr_sharma'].id, type: 'PHC_VISIT', date: threeDaysAgo, symptoms: ['Chest pain', 'Shortness of breath'], notes: 'Elderly patient with history of hypertension...' },
//       { idKey: 'enc3', patientId: patients['sunita'].id, userId: users['dr_kulkarni'].id, type: 'TELECONSULTATION', date: twoDaysAgo, symptoms: ['Severe headache', 'Blurred vision'], notes: 'Teleconsultation - referred for ophthalmology evaluation' },
//       { idKey: 'enc4', patientId: patients['lakshmi'].id, userId: users['dr_banerjee'].id, type: 'TELECONSULTATION', date: oneDayAgo, symptoms: ['Pediatric fever'], notes: 'Teleconsultation for child (granddaughter) with persistent fever' }
//     ];

//     const encounters = {};
//     for (const e of encountersData) {
//       encounters[e.idKey] = await prisma.encounter.create({
//         data: {
//           patientId: e.patientId,
//           userId: e.userId,
//           type: e.type,
//           symptoms: e.symptoms,
//           notes: e.notes,
//           date: e.date
//         }
//       });
      
//       // ENCOUNTER_CREATED TimelineEvent
//       await prisma.timelineEvent.create({
//         data: {
//           patientId: e.patientId,
//           encounterId: encounters[e.idKey].id,
//           type: 'ENCOUNTER_CREATED',
//           title: `${e.type.replace('_', ' ')} created`,
//           description: `Encounter created by Doctor`,
//           userId: e.userId,
//           date: e.date
//         }
//       });
//     }
//     console.log('✅ Encounters created');

//     // 5. Create Vitals
//     console.log('❤️ Creating vitals...');
//     const vitalsData = [
//       // Encounters vitals
//       { patientId: patients['ramesh'].id, encounterId: encounters['enc1'].id, recordedById: users['asha_priya'].id, systolic: 140, diastolic: 90, heartRate: 82, temperature: 37.8, spO2: 96, weight: 68, createdAt: fiveDaysAgo },
//       { patientId: patients['mohan'].id, encounterId: encounters['enc2'].id, recordedById: users['anm_sunita'].id, systolic: 165, diastolic: 105, heartRate: 92, spO2: 94, weight: 72, createdAt: threeDaysAgo },
//       { patientId: patients['sunita'].id, encounterId: encounters['enc3'].id, recordedById: users['asha_priya'].id, systolic: 130, diastolic: 85, heartRate: 76, temperature: 37.2, spO2: 98, createdAt: twoDaysAgo },
//       { patientId: patients['lakshmi'].id, encounterId: encounters['enc4'].id, recordedById: users['anm_sunita'].id, systolic: 120, diastolic: 80, heartRate: 88, temperature: 38.5, spO2: 97, weight: 55, createdAt: oneDayAgo },
//       // Standalone vitals
//       { patientId: patients['ramesh'].id, recordedById: users['asha_priya'].id, systolic: 135, diastolic: 88, heartRate: 78, spO2: 97, createdAt: twoDaysAgo },
//       { patientId: patients['arjun'].id, recordedById: users['asha_priya'].id, systolic: 118, diastolic: 75, heartRate: 72, spO2: 99, weight: 62, createdAt: today },
//       { patientId: patients['meera'].id, recordedById: users['asha_priya'].id, temperature: 39.1, heartRate: 110, spO2: 96, weight: 15, createdAt: today },
//       { patientId: patients['mohan'].id, recordedById: users['anm_sunita'].id, systolic: 158, diastolic: 98, heartRate: 88, spO2: 95, createdAt: today }
//     ];

//     for (const v of vitalsData) {
//       await prisma.vitals.create({
//         data: {
//           patientId: v.patientId,
//           encounterId: v.encounterId || null,
//           recordedById: v.recordedById,
//           systolic: v.systolic,
//           diastolic: v.diastolic,
//           heartRate: v.heartRate,
//           temperature: v.temperature,
//           spO2: v.spO2,
//           weight: v.weight,
//           createdAt: v.createdAt
//         }
//       });
//       // VITALS_RECORDED TimelineEvent
//       if (v.encounterId) {
//           await prisma.timelineEvent.create({
//             data: {
//               patientId: v.patientId,
//               encounterId: v.encounterId,
//               type: 'VITALS_RECORDED',
//               title: 'Vitals Recorded',
//               description: 'Vitals recorded for patient',
//               userId: v.recordedById,
//               date: v.createdAt
//             }
//           });
//       }
//     }
//     console.log('✅ Vitals created');

//     // 6. Create Prescriptions
//     console.log('💊 Creating prescriptions...');
//     const prescriptionsData = [
//       { patientId: patients['ramesh'].id, encounterId: encounters['enc1'].id, doctorId: users['dr_sharma'].id, medications: [{ name: 'Amoxicillin', dosage: '500mg', frequency: 'Three times daily', duration: '7 days' }, { name: 'Paracetamol', dosage: '650mg', frequency: 'As needed for fever', duration: '5 days' }], instructions: 'Complete full course of antibiotics. Return if symptoms worsen.', createdAt: fiveDaysAgo },
//       { patientId: patients['mohan'].id, encounterId: encounters['enc2'].id, doctorId: users['dr_sharma'].id, medications: [{ name: 'Amlodipine', dosage: '5mg', frequency: 'Once daily', duration: '30 days' }, { name: 'Aspirin', dosage: '75mg', frequency: 'Once daily', duration: '30 days' }], instructions: 'Monitor blood pressure daily. Low sodium diet.', createdAt: threeDaysAgo },
//       { patientId: patients['sunita'].id, encounterId: encounters['enc3'].id, doctorId: users['dr_kulkarni'].id, medications: [{ name: 'Ibuprofen', dosage: '400mg', frequency: 'Twice daily', duration: '5 days' }, { name: 'Vitamin B12', dosage: '1500mcg', frequency: 'Once daily', duration: '30 days' }], instructions: 'Ophthalmology referral recommended.', createdAt: twoDaysAgo }
//     ];

//     for (const p of prescriptionsData) {
//       await prisma.prescription.create({
//         data: {
//           patientId: p.patientId,
//           encounterId: p.encounterId,
//           doctorId: p.doctorId,
//           medications: p.medications,
//           instructions: p.instructions,
//           createdAt: p.createdAt
//         }
//       });
//       // PRESCRIPTION_ISSUED TimelineEvent
//       await prisma.timelineEvent.create({
//         data: {
//           patientId: p.patientId,
//           encounterId: p.encounterId,
//           type: 'PRESCRIPTION_ISSUED',
//           title: 'Prescription Issued',
//           description: 'Medication prescribed by doctor',
//           userId: p.doctorId,
//           date: p.createdAt
//         }
//       });
//     }
//     console.log('✅ Prescriptions created');

//     // 7. Create Referrals & ReferralEvents
//     console.log('🏥 Creating referrals...');
    
//     const referral1 = await prisma.referral.create({
//       data: {
//         patientId: patients['mohan'].id,
//         encounterId: encounters['enc2'].id,
//         referringFacilityId: 'PHC-Sarai',
//         receivingFacilityId: 'DH-Jaunpur',
//         reason: 'Uncontrolled hypertension with suspected cardiac involvement',
//         priority: 'HIGH',
//         status: 'ACCEPTED',
//         createdById: users['dr_sharma'].id,
//         createdAt: threeDaysAgo
//       }
//     });

//     await prisma.referralEvent.create({
//       data: {
//         referralId: referral1.id,
//         status: 'CREATED',
//         userId: users['dr_sharma'].id,
//         notes: 'Initial referral created',
//         createdAt: threeDaysAgo
//       }
//     });
    
//     await prisma.timelineEvent.create({
//       data: {
//         patientId: patients['mohan'].id,
//         encounterId: encounters['enc2'].id,
//         type: 'REFERRAL_CREATED',
//         title: 'Referral Created',
//         description: 'Referred to DH-Jaunpur for Uncontrolled hypertension with suspected cardiac involvement',
//         userId: users['dr_sharma'].id,
//         date: threeDaysAgo
//       }
//     });

//     await prisma.referralEvent.create({
//       data: {
//         referralId: referral1.id,
//         status: 'ACCEPTED',
//         userId: users['dr_sharma'].id,
//         notes: 'Referral accepted by receiving facility',
//         createdAt: twoDaysAgo
//       }
//     });

//     await prisma.timelineEvent.create({
//       data: {
//         patientId: patients['mohan'].id,
//         encounterId: encounters['enc2'].id,
//         type: 'REFERRAL_ACCEPTED',
//         title: 'Referral Accepted',
//         description: 'Referral was accepted by DH-Jaunpur',
//         userId: users['dr_sharma'].id,
//         date: twoDaysAgo
//       }
//     });

//     const referral2 = await prisma.referral.create({
//       data: {
//         patientId: patients['sunita'].id,
//         encounterId: encounters['enc3'].id,
//         referringFacilityId: 'PHC-Mahua',
//         receivingFacilityId: 'DH-Varanasi',
//         reason: 'Ophthalmology evaluation for blurred vision with headache',
//         priority: 'MEDIUM',
//         status: 'CREATED',
//         createdById: users['dr_kulkarni'].id,
//         createdAt: twoDaysAgo
//       }
//     });

//     await prisma.referralEvent.create({
//       data: {
//         referralId: referral2.id,
//         status: 'CREATED',
//         userId: users['dr_kulkarni'].id,
//         notes: 'Initial referral created',
//         createdAt: twoDaysAgo
//       }
//     });

//     await prisma.timelineEvent.create({
//       data: {
//         patientId: patients['sunita'].id,
//         encounterId: encounters['enc3'].id,
//         type: 'REFERRAL_CREATED',
//         title: 'Referral Created',
//         description: 'Referred to DH-Varanasi for Ophthalmology evaluation for blurred vision with headache',
//         userId: users['dr_kulkarni'].id,
//         date: twoDaysAgo
//       }
//     });

//     console.log('✅ Referrals created');

//     // 8. Create FollowUps
//     console.log('📅 Creating follow-ups...');
//     const inTwoDays = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
//     const followUpsData = [
//       { patientId: patients['ramesh'].id, encounterId: encounters['enc1'].id, assignedToId: users['asha_priya'].id, dueDate: inTwoDays, status: 'PENDING', notes: 'Check if cough has resolved after antibiotics course' },
//       { patientId: patients['mohan'].id, encounterId: encounters['enc2'].id, referralId: referral1.id, assignedToId: users['anm_sunita'].id, dueDate: oneDayAgo, status: 'COMPLETED', outcome: 'Patient visited DH Jaunpur, BP now under control with medication', completedAt: oneDayAgo },
//       { patientId: patients['lakshmi'].id, encounterId: encounters['enc4'].id, assignedToId: users['anm_sunita'].id, dueDate: twoDaysAgo, status: 'MISSED', notes: 'Patient was not reachable by phone' }
//     ];

//     for (const f of followUpsData) {
//       await prisma.followUp.create({
//         data: {
//           patientId: f.patientId,
//           encounterId: f.encounterId,
//           referralId: f.referralId,
//           assignedToId: f.assignedToId,
//           dueDate: f.dueDate,
//           status: f.status,
//           notes: f.notes,
//           outcome: f.outcome,
//           completedAt: f.completedAt
//         }
//       });
//       // Timeline events for FollowUp
//       await prisma.timelineEvent.create({
//         data: {
//           patientId: f.patientId,
//           encounterId: f.encounterId,
//           type: 'FOLLOWUP_SCHEDULED',
//           title: 'Follow-up Scheduled',
//           description: `Scheduled follow-up`,
//           userId: f.assignedToId,
//           date: new Date() // usually scheduled at encounter time but using now for simplicity
//         }
//       });

//       if (f.status === 'COMPLETED') {
//         await prisma.timelineEvent.create({
//           data: {
//             patientId: f.patientId,
//             encounterId: f.encounterId,
//             type: 'FOLLOWUP_COMPLETED',
//             title: 'Follow-up Completed',
//             description: `Outcome: ${f.outcome}`,
//             userId: f.assignedToId,
//             date: f.completedAt
//           }
//         });
//       } else if (f.status === 'MISSED') {
//         await prisma.timelineEvent.create({
//           data: {
//             patientId: f.patientId,
//             encounterId: f.encounterId,
//             type: 'FOLLOWUP_MISSED',
//             title: 'Follow-up Missed',
//             description: f.notes,
//             userId: f.assignedToId,
//             date: f.dueDate
//           }
//         });
//       }
//     }
//     console.log('✅ Follow-ups created');

//     // 9. Create Teleconsultation Requests
//     console.log('📞 Creating teleconsultation requests...');
//     const teleRequestsData = [
//       { patientId: patients['arjun'].id, doctorId: users['dr_kulkarni'].id, requesterId: users['asha_priya'].id, status: 'CREATED', reason: 'Young patient with recurring skin rashes and itching for 2 weeks' },
//       { patientId: patients['meera'].id, doctorId: users['dr_banerjee'].id, requesterId: users['asha_priya'].id, status: 'CREATED', reason: 'Child with high fever (39°C) for 3 days, not responding to paracetamol' },
//       { patientId: patients['sunita'].id, doctorId: users['dr_kulkarni'].id, requesterId: users['anm_sunita'].id, status: 'ACCEPTED', reason: 'Follow-up teleconsultation for headache and vision issues', roomId: 'teleconsult-abc12345', encounterId: encounters['enc3'].id },
//       { patientId: patients['lakshmi'].id, doctorId: users['dr_banerjee'].id, requesterId: users['anm_sunita'].id, status: 'COMPLETED', reason: 'Pediatric consultation for granddaughter fever', encounterId: encounters['enc4'].id }
//     ];

//     for (const t of teleRequestsData) {
//       await prisma.teleconsultationRequest.create({
//         data: {
//           patientId: t.patientId,
//           doctorId: t.doctorId,
//           requesterId: t.requesterId,
//           status: t.status,
//           reason: t.reason,
//           roomId: t.roomId,
//           encounterId: t.encounterId
//         }
//       });
//     }
//     console.log('✅ Teleconsultation requests created');

//     console.log('🎉 Database seeding completed successfully!');
//   } catch (error) {
//     console.error('❌ Error during database seeding:', error);
//     process.exit(1);
//   } finally {
//     await prisma.$disconnect();
//   }
// }

// main();


const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Starting database seeding...');

  try {
    // 1. Clear existing data
    console.log('🧹 Clearing existing data...');
    await prisma.teleconsultationRequest.deleteMany();
    await prisma.referralEvent.deleteMany();
    await prisma.followUp.deleteMany();
    await prisma.prescription.deleteMany();
    await prisma.vitals.deleteMany();
    await prisma.timelineEvent.deleteMany();
    await prisma.encounter.deleteMany();
    await prisma.referral.deleteMany();
    await prisma.patient.deleteMany();
    await prisma.user.deleteMany();
    console.log('✅ Existing data cleared');

    // Password hashing
    const hashedPassword = await bcrypt.hash('password123', 10);

    // 2. Create Users
    console.log('👤 Creating users...');
    const usersData = [
      { identifier: 'asha_priya', name: 'Priya Devi', phone: '9876543210', role: 'ASHA' },
      { identifier: 'anm_sunita', name: 'Sunita Kumari', phone: '9876543211', role: 'ANM' },
      { identifier: 'dr_sharma', name: 'Dr. Rajesh Sharma', phone: '9876543212', role: 'DOCTOR' },
      { identifier: 'dr_kulkarni', name: 'Dr. Anita Kulkarni', phone: '9876543213', role: 'SPECIALIST' },
      { identifier: 'dr_banerjee', name: 'Dr. Suman Banerjee', phone: '9876543214', role: 'SPECIALIST' },
      { identifier: 'admin_arogyalink', name: 'System Administrator', phone: '9876543215', role: 'SYSTEM_ADMIN' },
      { identifier: 'hospital_delhi', name: 'Delhi District Hospital Admin', phone: '9876543216', role: 'HOSPITAL_ADMIN' }
    ];

    const users = {};
    for (const u of usersData) {
      users[u.identifier] = await prisma.user.create({
        data: {
          identifier: u.identifier,
          name: u.name,
          phone: u.phone,
          role: u.role,
          passwordHash: hashedPassword, // schema field is `passwordHash`, not `password`
        }
      });
    }
    console.log('✅ Users created');

    // 3. Create Patients
    console.log('🤒 Creating patients...');
    const patientsData = [
      { idKey: 'ramesh', name: 'Ramesh Kumar', gender: 'MALE', dob: new Date('1985-03-15'), village: 'Chandpur', district: 'Varanasi', state: 'Uttar Pradesh', phone: '9111222333', ashaId: users['asha_priya'].id },
      { idKey: 'sunita', name: 'Sunita Devi', gender: 'FEMALE', dob: new Date('1992-07-22'), village: 'Mahua', district: 'Varanasi', state: 'Uttar Pradesh', phone: '9111222334', ashaId: users['asha_priya'].id },
      { idKey: 'mohan', name: 'Mohan Lal', gender: 'MALE', dob: new Date('1958-11-03'), village: 'Sarai', district: 'Jaunpur', state: 'Uttar Pradesh', phone: '9111222335', ashaId: users['anm_sunita'].id },
      { idKey: 'lakshmi', name: 'Lakshmi Bai', gender: 'FEMALE', dob: new Date('1975-01-28'), village: 'Dhanupura', district: 'Jaunpur', state: 'Uttar Pradesh', phone: '9111222336', ashaId: users['anm_sunita'].id },
      { idKey: 'arjun', name: 'Arjun Singh', gender: 'MALE', dob: new Date('2001-09-10'), village: 'Bhagwanpur', district: 'Varanasi', state: 'Uttar Pradesh', phone: null, ashaId: users['asha_priya'].id },
      { idKey: 'meera', name: 'Meera Kumari', gender: 'FEMALE', dob: new Date('2018-04-05'), village: 'Chandpur', district: 'Varanasi', state: 'Uttar Pradesh', phone: '9111222337', ashaId: users['asha_priya'].id }
    ];

    const patients = {};
    for (const p of patientsData) {
      patients[p.idKey] = await prisma.patient.create({
        data: {
          name: p.name,
          gender: p.gender,
          dateOfBirth: p.dob,       // schema field is `dateOfBirth`, not `dob`
          village: p.village,
          district: p.district,
          state: p.state,
          phone: p.phone,
          assignedAshaId: p.ashaId  // schema field is `assignedAshaId`, not `assignedToId`
        }
      });
      // PATIENT_REGISTERED TimelineEvent
      await prisma.timelineEvent.create({
        data: {
          patientId: patients[p.idKey].id,
          eventType: 'PATIENT_REGISTERED', // schema field is `eventType`, not `type`
          description: `Patient ${p.name} registered in the system`,
          createdAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) // Registered a month ago
          // Note: TimelineEvent has no `title` or `userId` field in the schema, so they're dropped.
        }
      });
    }
    console.log('✅ Patients created');

    // 4. Create Encounters
    console.log('🩺 Creating encounters...');
    const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    const oneDayAgo = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000);
    const today = new Date();

    const encountersData = [
      { idKey: 'enc1', patientId: patients['ramesh'].id, userId: users['dr_sharma'].id, type: 'PHC_VISIT', date: fiveDaysAgo, symptoms: ['Persistent cough', 'Mild fever'], notes: 'Patient presents with productive cough for 5 days...' },
      { idKey: 'enc2', patientId: patients['mohan'].id, userId: users['dr_sharma'].id, type: 'PHC_VISIT', date: threeDaysAgo, symptoms: ['Chest pain', 'Shortness of breath'], notes: 'Elderly patient with history of hypertension...' },
      { idKey: 'enc3', patientId: patients['sunita'].id, userId: users['dr_kulkarni'].id, type: 'TELECONSULTATION', date: twoDaysAgo, symptoms: ['Severe headache', 'Blurred vision'], notes: 'Teleconsultation - referred for ophthalmology evaluation' },
      { idKey: 'enc4', patientId: patients['lakshmi'].id, userId: users['dr_banerjee'].id, type: 'TELECONSULTATION', date: oneDayAgo, symptoms: ['Pediatric fever'], notes: 'Teleconsultation for child (granddaughter) with persistent fever' }
    ];

    const encounters = {};
    for (const e of encountersData) {
      encounters[e.idKey] = await prisma.encounter.create({
        data: {
          patientId: e.patientId,
          doctorId: e.userId,          // schema field is `doctorId`, not `userId`
          encounterType: e.type,       // schema field is `encounterType`, not `type`
          symptoms: e.symptoms,
          clinicalNotes: e.notes,      // schema field is `clinicalNotes`, not `notes`
          encounterDate: e.date        // schema field is `encounterDate`, not `date`
        }
      });
      // ENCOUNTER_CREATED TimelineEvent
      await prisma.timelineEvent.create({
        data: {
          patientId: e.patientId,
          referenceId: encounters[e.idKey].id, // schema field is `referenceId`, not `encounterId`
          eventType: 'ENCOUNTER_CREATED',
          description: `${e.type.replace('_', ' ')} encounter created by doctor`,
          createdAt: e.date
        }
      });
    }
    console.log('✅ Encounters created');

    // 5. Create Vitals
    console.log('❤️ Creating vitals...');
    const vitalsData = [
      // Encounters vitals
      { patientId: patients['ramesh'].id, encounterId: encounters['enc1'].id, recordedById: users['asha_priya'].id, systolic: 140, diastolic: 90, heartRate: 82, temperature: 37.8, spO2: 96, weight: 68, createdAt: fiveDaysAgo },
      { patientId: patients['mohan'].id, encounterId: encounters['enc2'].id, recordedById: users['anm_sunita'].id, systolic: 165, diastolic: 105, heartRate: 92, spO2: 94, weight: 72, createdAt: threeDaysAgo },
      { patientId: patients['sunita'].id, encounterId: encounters['enc3'].id, recordedById: users['asha_priya'].id, systolic: 130, diastolic: 85, heartRate: 76, temperature: 37.2, spO2: 98, createdAt: twoDaysAgo },
      { patientId: patients['lakshmi'].id, encounterId: encounters['enc4'].id, recordedById: users['anm_sunita'].id, systolic: 120, diastolic: 80, heartRate: 88, temperature: 38.5, spO2: 97, weight: 55, createdAt: oneDayAgo },
      // Standalone vitals
      { patientId: patients['ramesh'].id, recordedById: users['asha_priya'].id, systolic: 135, diastolic: 88, heartRate: 78, spO2: 97, createdAt: twoDaysAgo },
      { patientId: patients['arjun'].id, recordedById: users['asha_priya'].id, systolic: 118, diastolic: 75, heartRate: 72, spO2: 99, weight: 62, createdAt: today },
      { patientId: patients['meera'].id, recordedById: users['asha_priya'].id, temperature: 39.1, heartRate: 110, spO2: 96, weight: 15, createdAt: today },
      { patientId: patients['mohan'].id, recordedById: users['anm_sunita'].id, systolic: 158, diastolic: 98, heartRate: 88, spO2: 95, createdAt: today }
    ];

    for (const v of vitalsData) {
      const vitals = await prisma.vitals.create({
        data: {
          patientId: v.patientId,
          encounterId: v.encounterId || null,
          recordedById: v.recordedById,
          bpSystolic: v.systolic,        // schema field is `bpSystolic`, not `systolic`
          bpDiastolic: v.diastolic,      // schema field is `bpDiastolic`, not `diastolic`
          heartRate: v.heartRate,
          temperature: v.temperature,
          oxygenSaturation: v.spO2,      // schema field is `oxygenSaturation`, not `spO2`
          weight: v.weight,
          recordedAt: v.createdAt        // schema field is `recordedAt`; there is no `createdAt` on Vitals
        }
      });
      // VITALS_RECORDED TimelineEvent
      if (v.encounterId) {
          await prisma.timelineEvent.create({
            data: {
              patientId: v.patientId,
              referenceId: vitals.id,
              eventType: 'VITALS_RECORDED',
              description: 'Vitals recorded for patient',
              createdAt: v.createdAt
            }
          });
      }
    }
    console.log('✅ Vitals created');

    // 6. Create Prescriptions
    console.log('💊 Creating prescriptions...');
    const prescriptionsData = [
      { patientId: patients['ramesh'].id, encounterId: encounters['enc1'].id, doctorId: users['dr_sharma'].id, medications: [{ name: 'Amoxicillin', dosage: '500mg', frequency: 'Three times daily', duration: '7 days' }, { name: 'Paracetamol', dosage: '650mg', frequency: 'As needed for fever', duration: '5 days' }], instructions: 'Complete full course of antibiotics. Return if symptoms worsen.', createdAt: fiveDaysAgo },
      { patientId: patients['mohan'].id, encounterId: encounters['enc2'].id, doctorId: users['dr_sharma'].id, medications: [{ name: 'Amlodipine', dosage: '5mg', frequency: 'Once daily', duration: '30 days' }, { name: 'Aspirin', dosage: '75mg', frequency: 'Once daily', duration: '30 days' }], instructions: 'Monitor blood pressure daily. Low sodium diet.', createdAt: threeDaysAgo },
      { patientId: patients['sunita'].id, encounterId: encounters['enc3'].id, doctorId: users['dr_kulkarni'].id, medications: [{ name: 'Ibuprofen', dosage: '400mg', frequency: 'Twice daily', duration: '5 days' }, { name: 'Vitamin B12', dosage: '1500mcg', frequency: 'Once daily', duration: '30 days' }], instructions: 'Ophthalmology referral recommended.', createdAt: twoDaysAgo }
    ];

    for (const p of prescriptionsData) {
      const prescription = await prisma.prescription.create({
        data: {
          patientId: p.patientId,
          encounterId: p.encounterId,
          doctorId: p.doctorId,
          medicineDetails: p.medications, // schema field is `medicineDetails`, not `medications`
          instructions: p.instructions,
          createdAt: p.createdAt
        }
      });
      // PRESCRIPTION_ISSUED TimelineEvent
      await prisma.timelineEvent.create({
        data: {
          patientId: p.patientId,
          referenceId: prescription.id,
          eventType: 'PRESCRIPTION_ISSUED',
          description: 'Medication prescribed by doctor',
          createdAt: p.createdAt
        }
      });
    }
    console.log('✅ Prescriptions created');

    // 7. Create Referrals & ReferralEvents
    console.log('🏥 Creating referrals...');

    const referral1 = await prisma.referral.create({
      data: {
        patientId: patients['mohan'].id,
        encounterId: encounters['enc2'].id,
        referringFacilityId: 'PHC-Sarai',
        receivingFacilityId: 'DH-Jaunpur',
        reason: 'Uncontrolled hypertension with suspected cardiac involvement',
        priority: 'HIGH',
        status: 'ACCEPTED',
        createdById: users['dr_sharma'].id,
        createdAt: threeDaysAgo
      }
    });

    await prisma.referralEvent.create({
      data: {
        referralId: referral1.id,
        newStatus: 'CREATED',       // schema field is `newStatus`, not `status`
        updatedById: users['dr_sharma'].id, // schema field is `updatedById`, not `userId`
        remarks: 'Initial referral created', // schema field is `remarks`, not `notes`
        createdAt: threeDaysAgo
      }
    });

    await prisma.timelineEvent.create({
      data: {
        patientId: patients['mohan'].id,
        referenceId: referral1.id,
        eventType: 'REFERRAL_CREATED',
        description: 'Referred to DH-Jaunpur for Uncontrolled hypertension with suspected cardiac involvement',
        createdAt: threeDaysAgo
      }
    });

    await prisma.referralEvent.create({
      data: {
        referralId: referral1.id,
        previousStatus: 'CREATED',
        newStatus: 'ACCEPTED',
        updatedById: users['dr_sharma'].id,
        remarks: 'Referral accepted by receiving facility',
        createdAt: twoDaysAgo
      }
    });

    await prisma.timelineEvent.create({
      data: {
        patientId: patients['mohan'].id,
        referenceId: referral1.id,
        eventType: 'REFERRAL_ACCEPTED',
        description: 'Referral was accepted by DH-Jaunpur',
        createdAt: twoDaysAgo
      }
    });

    const referral2 = await prisma.referral.create({
      data: {
        patientId: patients['sunita'].id,
        encounterId: encounters['enc3'].id,
        referringFacilityId: 'PHC-Mahua',
        receivingFacilityId: 'DH-Varanasi',
        reason: 'Ophthalmology evaluation for blurred vision with headache',
        priority: 'MEDIUM',
        status: 'CREATED',
        createdById: users['dr_kulkarni'].id,
        createdAt: twoDaysAgo
      }
    });

    await prisma.referralEvent.create({
      data: {
        referralId: referral2.id,
        newStatus: 'CREATED',
        updatedById: users['dr_kulkarni'].id,
        remarks: 'Initial referral created',
        createdAt: twoDaysAgo
      }
    });

    await prisma.timelineEvent.create({
      data: {
        patientId: patients['sunita'].id,
        referenceId: referral2.id,
        eventType: 'REFERRAL_CREATED',
        description: 'Referred to DH-Varanasi for Ophthalmology evaluation for blurred vision with headache',
        createdAt: twoDaysAgo
      }
    });

    console.log('✅ Referrals created');

    // 8. Create FollowUps
    console.log('📅 Creating follow-ups...');
    const inTwoDays = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
    const followUpsData = [
      { patientId: patients['ramesh'].id, encounterId: encounters['enc1'].id, assignedToId: users['asha_priya'].id, dueDate: inTwoDays, status: 'PENDING', notes: 'Check if cough has resolved after antibiotics course' },
      { patientId: patients['mohan'].id, encounterId: encounters['enc2'].id, referralId: referral1.id, assignedToId: users['anm_sunita'].id, dueDate: oneDayAgo, status: 'COMPLETED', outcome: 'Patient visited DH Jaunpur, BP now under control with medication', completedAt: oneDayAgo },
      { patientId: patients['lakshmi'].id, encounterId: encounters['enc4'].id, assignedToId: users['anm_sunita'].id, dueDate: twoDaysAgo, status: 'MISSED', notes: 'Patient was not reachable by phone' }
    ];

    for (const f of followUpsData) {
      const followUp = await prisma.followUp.create({
        data: {
          patientId: f.patientId,
          relatedEncounterId: f.encounterId, // schema field is `relatedEncounterId`, not `encounterId`
          relatedReferralId: f.referralId,   // schema field is `relatedReferralId`, not `referralId`
          assignedToId: f.assignedToId,
          dueDate: f.dueDate,
          status: f.status,
          notes: f.notes,
          outcome: f.outcome,
          completedAt: f.completedAt
        }
      });
      // Timeline events for FollowUp
      await prisma.timelineEvent.create({
        data: {
          patientId: f.patientId,
          referenceId: followUp.id,
          eventType: 'FOLLOWUP_SCHEDULED',
          description: 'Scheduled follow-up',
          createdAt: new Date() // usually scheduled at encounter time but using now for simplicity
        }
      });

      if (f.status === 'COMPLETED') {
        await prisma.timelineEvent.create({
          data: {
            patientId: f.patientId,
            referenceId: followUp.id,
            eventType: 'FOLLOWUP_COMPLETED',
            description: `Outcome: ${f.outcome}`,
            createdAt: f.completedAt
          }
        });
      } else if (f.status === 'MISSED') {
        await prisma.timelineEvent.create({
          data: {
            patientId: f.patientId,
            referenceId: followUp.id,
            eventType: 'FOLLOWUP_MISSED',
            description: f.notes,
            createdAt: f.dueDate
          }
        });
      }
    }
    console.log('✅ Follow-ups created');

    // 9. Create Teleconsultation Requests
    console.log('📞 Creating teleconsultation requests...');
    const teleRequestsData = [
      { patientId: patients['arjun'].id, doctorId: users['dr_kulkarni'].id, requesterId: users['asha_priya'].id, status: 'CREATED', reason: 'Young patient with recurring skin rashes and itching for 2 weeks' },
      { patientId: patients['meera'].id, doctorId: users['dr_banerjee'].id, requesterId: users['asha_priya'].id, status: 'CREATED', reason: 'Child with high fever (39°C) for 3 days, not responding to paracetamol' },
      { patientId: patients['sunita'].id, doctorId: users['dr_kulkarni'].id, requesterId: users['anm_sunita'].id, status: 'ACCEPTED', reason: 'Follow-up teleconsultation for headache and vision issues', roomId: 'teleconsult-abc12345', encounterId: encounters['enc3'].id },
      { patientId: patients['lakshmi'].id, doctorId: users['dr_banerjee'].id, requesterId: users['anm_sunita'].id, status: 'COMPLETED', reason: 'Pediatric consultation for granddaughter fever', encounterId: encounters['enc4'].id }
    ];

    for (const t of teleRequestsData) {
      await prisma.teleconsultationRequest.create({
        data: {
          patientId: t.patientId,
          doctorId: t.doctorId,
          requesterId: t.requesterId,
          status: t.status,
          reason: t.reason,
          roomId: t.roomId,
          encounterId: t.encounterId
        }
      });
    }
    console.log('✅ Teleconsultation requests created');

    console.log('🎉 Database seeding completed successfully!');
  } catch (error) {
    console.error('❌ Error during database seeding:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
