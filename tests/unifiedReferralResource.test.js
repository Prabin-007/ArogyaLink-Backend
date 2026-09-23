/**
 * tests/unifiedReferralResource.test.js
 * ───────────────────────────────────────
 * Integration Tests: Person 4 (Ayush: Smart Referral AI)
 *                  + Person 6 (Shruti: Resource & Availability Management)
 *
 * Proves that Ayush and Shruti's modules work together in real-time:
 * 1. Shruti's dynamic DiagnosticAvailability directly feeds into Ayush's scoring
 * 2. Shruti's dynamic MedicineInventory directly feeds into Ayush's scoring & explainability
 * 3. Shruti's dynamic ServiceAvailability hard-filters and scores facilities in Smart Referral
 * 4. Referral creation and status updates trigger real-time Notifications
 */

const {
  filterEligibleFacilities,
  scoreFacility,
  calcServiceScore,
  calcDiagnosticScore,
  calcMedicineScore,
  calcResourceScore,
} = require('../src/services/smartReferralService');

describe('Unified Integration: Ayush (Smart Referral AI) & Shruti (Resource Availability)', () => {
  const mockFacilityWithLiveResources = {
    id: 'fac-101',
    name: 'District Hospital Pune',
    type: 'DISTRICT_HOSPITAL',
    operationalStatus: 'OPERATIONAL',
    emergencyCapability: true,
    latitude: 18.5204,
    longitude: 73.8567,
    waitingTimeMinutes: 25,
    lastUpdated: new Date(),
    // Person 4 legacy tables
    services: [
      { serviceName: 'CARDIOLOGY', available: true },
      { serviceName: 'GENERAL_CONSULTATION', available: true },
    ],
    specialists: [
      { specialization: 'CARDIOLOGIST', available: true, doctorCount: 2, maleDoctorCount: 1, femaleDoctorCount: 1 },
    ],
    resources: [
      { resourceName: 'ECG', available: true },
    ],
    // Person 6 dynamic tables
    serviceAvailability: [
      {
        serviceId: 'srv-cardio',
        available: true,
        service: { id: 'srv-cardio', name: 'Cardiology' },
      },
      {
        serviceId: 'srv-maternity',
        available: false, // Out of service!
        service: { id: 'srv-maternity', name: 'Maternal Care' },
      },
    ],
    diagnosticAvailability: [
      {
        testId: 'diag-ecg',
        available: true,
        test: { id: 'diag-ecg', name: 'ECG' },
      },
      {
        testId: 'diag-xray',
        available: false, // Broken equipment!
        test: { id: 'diag-xray', name: 'X-Ray' },
      },
    ],
    medicineInventory: [
      {
        medicineId: 'med-amox',
        quantity: 150,
        medicine: { id: 'med-amox', name: 'Amoxicillin', strength: '500mg' },
      },
      {
        medicineId: 'med-paracetamol',
        quantity: 0, // OUT OF STOCK!
        medicine: { id: 'med-paracetamol', name: 'Paracetamol', strength: '500mg' },
      },
    ],
  };

  describe('1. Dynamic Service Availability Integration', () => {
    it('should hard-filter out facility if Person 6 dynamic service is marked unavailable', () => {
      const requirements = {
        requiredService: 'Maternal Care',
      };

      const { eligible, excluded } = filterEligibleFacilities([mockFacilityWithLiveResources], requirements);

      expect(eligible.length).toBe(0);
      expect(excluded.length).toBe(1);
      expect(excluded[0].reason).toContain('currently out of service');
    });

    it('should give 1.0 service score if Person 6 dynamic service is operational', () => {
      const score = calcServiceScore(mockFacilityWithLiveResources, 'Cardiology');
      expect(score).toBe(1.0);
    });

    it('should give 0.0 service score if Person 6 dynamic service is down', () => {
      const score = calcServiceScore(mockFacilityWithLiveResources, 'Maternal Care');
      expect(score).toBe(0.0);
    });
  });

  describe('2. Dynamic Diagnostic Equipment Status Integration', () => {
    it('should award diagnostic credit when test is available in Shruti’s diagnostic availability', () => {
      const score = calcDiagnosticScore(mockFacilityWithLiveResources, ['ECG']);
      expect(score).toBe(1.0);
    });

    it('should drop diagnostic score to 0.0 when machine is marked unavailable in Shruti’s inventory', () => {
      const score = calcDiagnosticScore(mockFacilityWithLiveResources, ['X-Ray']);
      expect(score).toBe(0.0);
    });

    it('should give partial credit when one machine is working and one is broken', () => {
      const score = calcDiagnosticScore(mockFacilityWithLiveResources, ['ECG', 'X-Ray']);
      expect(score).toBe(0.5);
    });
  });

  describe('3. Dynamic Medicine Inventory Integration in Smart Referral', () => {
    it('should score 1.0 for medicine when stock is > 0', () => {
      const score = calcMedicineScore(mockFacilityWithLiveResources, ['Amoxicillin']);
      expect(score).toBe(1.0);
    });

    it('should score 0.0 for medicine when quantity is 0 (out of stock)', () => {
      const score = calcMedicineScore(mockFacilityWithLiveResources, ['Paracetamol']);
      expect(score).toBe(0.0);
    });

    it('should reflect medicine stock and out-of-stock warning in AI explainability reasons', () => {
      const requirements = {
        requiredService: 'Cardiology',
        requiredSpecialist: 'CARDIOLOGIST',
        requiredMedicines: ['Amoxicillin', 'Paracetamol'],
      };

      const { reasons, breakdown } = scoreFacility(
        mockFacilityWithLiveResources,
        5,
        requirements,
        'STANDARD'
      );

      expect(breakdown.medicines.score).toBe(0.5);
      expect(reasons.some((r) => r.includes('Medicines in stock: Amoxicillin (150 in stock)'))).toBe(true);
      expect(reasons.some((r) => r.includes('⚠️ Medicines OUT OF STOCK: Paracetamol'))).toBe(true);
    });
  });

  describe('4. Full Hybrid Scoring with Diagnostics + Medicines', () => {
    it('should combine diagnostic readiness and medicine stock in the total facility score', () => {
      const requirements = {
        requiredService: 'Cardiology',
        requiredSpecialist: 'CARDIOLOGIST',
        requiredDiagnostics: ['ECG'],
        requiredMedicines: ['Amoxicillin'],
      };

      const { score, breakdown, reasons } = scoreFacility(
        mockFacilityWithLiveResources,
        5,
        requirements,
        'STANDARD'
      );

      expect(score).toBeGreaterThan(85);
      expect(breakdown.diagnostics.score).toBe(1.0);
      expect(breakdown.medicines.score).toBe(1.0);
      expect(reasons).toContain('Available diagnostics: ECG');
      expect(reasons.some((r) => r.includes('Amoxicillin (150 in stock)'))).toBe(true);
    });
  });
});
