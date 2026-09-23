/**
 * tests/triage.test.js
 * ───────────────────────────────────────
 * Person 5 — AI Clinical & Emergency Triage Tests
 * Harmonized with Person 4 (Smart Referral AI) & Person 6 (Notifications & Resources)
 */

const { assessTriage } = require('../src/services/triageService');

describe('Person 5: AI Clinical & Emergency Triage Core Logic', () => {
  describe('Rule 1: Red-Flag Emergency Detection', () => {
    it('should immediately return EMERGENCY for red-flag symptoms regardless of vitals', () => {
      const redFlagSymptoms = [
        ['airway obstruction'],
        ['severe breathing difficulty'],
        ['unconscious'],
        ['unresponsive'],
        ['heavy bleeding'],
        ['acute seizure'],
        ['dangerous poisoning'],
      ];

      for (const symptoms of redFlagSymptoms) {
        const result = assessTriage({
          vitals: {
            temperature: 98.6,
            heartRate: 75,
            bpSystolic: 120,
            bpDiastolic: 80,
            oxygenSaturation: 99,
          },
          symptoms,
        });

        expect(result.triageLevel).toBe('EMERGENCY');
        expect(result.reasons).toContain('Emergency red flag detected');
        expect(result.redFlags.length).toBeGreaterThan(0);
      }
    });

    it('should match case-insensitively and detect keywords within larger symptom strings', () => {
      const result = assessTriage({
        vitals: {},
        symptoms: ['Patient was found UNCONSCIOUS at home after fall'],
      });

      expect(result.triageLevel).toBe('EMERGENCY');
      expect(result.redFlags).toContain('patient was found unconscious at home after fall');
    });
  });

  describe('Rule 2: Normal Vitals & Mild Symptoms (LOW Triage)', () => {
    it('should classify normal vitals and mild complaints as LOW', () => {
      const result = assessTriage({
        vitals: {
          temperature: 98.6,
          heartRate: 72,
          bpSystolic: 120,
          bpDiastolic: 80,
          oxygenSaturation: 98,
        },
        symptoms: ['mild headache', 'tiredness'],
      });

      expect(result.triageLevel).toBe('LOW');
      expect(result.score).toBe(0);
      expect(result.reasons).toHaveLength(0);
      expect(result.redFlags).toHaveLength(0);
    });
  });

  describe('Rule 3: Moderate Abnormalities (MEDIUM Triage)', () => {
    it('should classify moderate fever and mild tachycardia as MEDIUM', () => {
      const result = assessTriage({
        vitals: {
          temperature: 102.0, // score +1
          heartRate: 125,     // score +1
          bpSystolic: 120,
          bpDiastolic: 80,
          oxygenSaturation: 97,
        },
        symptoms: ['body ache'],
      });

      expect(result.triageLevel).toBe('MEDIUM');
      expect(result.score).toBe(2);
      expect(result.reasons).toContain('Abnormal temperature');
      expect(result.reasons).toContain('Abnormal heart rate');
    });

    it('should classify high-attention symptom alone with 1 abnormal vital as MEDIUM', () => {
      const result = assessTriage({
        vitals: {
          heartRate: 125, // score +1
          oxygenSaturation: 98,
        },
        symptoms: ['shortness of breath'], // score +1
      });

      expect(result.triageLevel).toBe('MEDIUM');
      expect(result.score).toBe(2);
      expect(result.reasons).toContain('High-attention symptom: shortness of breath');
    });
  });

  describe('Rule 4: Significant Multiple Abnormalities (HIGH Triage)', () => {
    it('should classify SpO2 < 94% with abnormal blood pressure and tachycardia as HIGH', () => {
      const result = assessTriage({
        vitals: {
          temperature: 103,   // +1
          heartRate: 132,     // +1
          bpSystolic: 85,     // +2 (hypotension < 90)
          bpDiastolic: 55,    // +1 (diastolic < 60)
          oxygenSaturation: 91, // +2 (hypoxemia < 94)
        },
        symptoms: ['persistent vomiting'],
      });

      expect(result.triageLevel).toBe('HIGH');
      expect(result.score).toBe(7);
      expect(result.reasons).toContain('Low oxygen saturation');
      expect(result.reasons).toContain('Abnormal systolic blood pressure');
    });

    it('should classify high systolic hypertension (>= 180) and chest pain as HIGH', () => {
      const result = assessTriage({
        vitals: {
          bpSystolic: 195, // +2
          bpDiastolic: 110,
          heartRate: 105,
          oxygenSaturation: 96,
        },
        symptoms: ['chest pain', 'fainting'], // +1 +1 = +2
      });

      expect(result.triageLevel).toBe('HIGH');
      expect(result.score).toBe(4);
    });
  });

  describe('Integration Harmony: Person 5 Triage Feeding into Person 4 AI & Person 6 Alerts', () => {
    it('should provide the required payload parameters for Smart Referral emergency mode', () => {
      const emergencyTriage = assessTriage({
        vitals: { oxygenSaturation: 88 },
        symptoms: ['severe breathing difficulty'],
      });

      expect(emergencyTriage.triageLevel).toBe('EMERGENCY');

      // Mimics controller decision logic
      const isEmergency = emergencyTriage.triageLevel === 'EMERGENCY';
      const referralPriority = emergencyTriage.triageLevel;

      expect(isEmergency).toBe(true);
      expect(referralPriority).toBe('EMERGENCY');

      // In smart referral engine, isEmergency=true enforces emergencyCapability=true on facilities
      const { filterEligibleFacilities } = require('../src/services/smartReferralService');
      const facilities = [
        { id: 'f-normal', name: 'Rural Clinic', operationalStatus: 'OPERATIONAL', emergencyCapability: false },
        { id: 'f-er', name: 'District Emergency Center', operationalStatus: 'OPERATIONAL', emergencyCapability: true }
      ];

      const { eligible, excluded } = filterEligibleFacilities(facilities, { emergency: isEmergency });
      expect(eligible).toHaveLength(1);
      expect(eligible[0].id).toBe('f-er');
      expect(excluded[0].facility.id).toBe('f-normal');
    });
  });
});
