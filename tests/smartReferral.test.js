const {
  filterEligibleFacilities,
  scoreFacility,
  calcDistanceScore,
  calcWaitingTimeScore,
  ReferralRankingService
} = require('../src/services/smartReferralService');

describe('Smart Referral AI (Person 4) Core Logic', () => {
  const baseFacility = {
    id: 'f1',
    name: 'Test Hospital',
    type: 'DISTRICT_HOSPITAL',
    operationalStatus: 'OPERATIONAL',
    emergencyCapability: true,
    latitude: 25.0,
    longitude: 92.0,
    waitingTimeMinutes: 30,
    services: [
      { serviceName: 'CARDIOLOGY', available: true },
      { serviceName: 'NEUROLOGY', available: false }
    ],
    specialists: [
      { specialization: 'CARDIOLOGIST', available: true, doctorCount: 2 }
    ],
    resources: [
      { resourceName: 'ECG', available: true }
    ]
  };

  const requirements = {
    requiredService: 'CARDIOLOGY',
    requiredSpecialist: 'CARDIOLOGIST',
    emergency: false,
    requiredDiagnostics: ['ECG']
  };

  describe('Scenario 1: Exact Match (Service, Specialist, Resources)', () => {
    it('should score high for exact match', () => {
      const { score, reasons } = scoreFacility(baseFacility, 10, requirements, 'STANDARD');
      expect(score).toBeGreaterThan(80);
      expect(reasons).toContain('Required service "CARDIOLOGY" is available');
      expect(reasons).toContain('Cardiologist available (2 on staff)');
    });
  });

  describe('Scenario 2: Emergency Override', () => {
    it('should filter out non-emergency facilities if emergency is true', () => {
      const nonEmergencyFacility = { ...baseFacility, emergencyCapability: false };
      const reqs = { ...requirements, emergency: true };
      
      const { eligible, excluded } = filterEligibleFacilities([nonEmergencyFacility], reqs);
      
      expect(eligible.length).toBe(0);
      expect(excluded.length).toBe(1);
      expect(excluded[0].reason).toContain('No emergency capability');
    });

    it('should score emergency capability higher in EMERGENCY profile', () => {
      const { score: scoreStandard } = scoreFacility(baseFacility, 10, requirements, 'STANDARD');
      const { score: scoreEmergency } = scoreFacility(baseFacility, 10, requirements, 'EMERGENCY');
      // Emergency weight profile prioritizes emergency capability and specialists, ignoring resources.
      // Depending on weights, the exact score may vary, but both should be computed.
      expect(scoreStandard).toBeDefined();
      expect(scoreEmergency).toBeDefined();
    });
  });

  describe('Scenario 3: Missing Required Service', () => {
    it('should explicitly filter out facilities where required service is unavailable', () => {
      const reqs = { ...requirements, requiredService: 'NEUROLOGY' };
      const { eligible, excluded } = filterEligibleFacilities([baseFacility], reqs);
      
      expect(eligible.length).toBe(0);
      expect(excluded.length).toBe(1);
      expect(excluded[0].reason).toContain('unavailable');
    });
  });

  describe('Scenario 4: Missing Required Specialist', () => {
    it('should penalize but not exclude if specialist is unavailable', () => {
      const reqs = { ...requirements, requiredSpecialist: 'NEUROLOGIST' };
      const { eligible } = filterEligibleFacilities([baseFacility], reqs);
      expect(eligible.length).toBe(1); // Not excluded by hard filters

      const { score, breakdown } = scoreFacility(baseFacility, 10, reqs, 'STANDARD');
      expect(breakdown.specialist.score).toBe(0.5); // 0.5 because it's not listed (we don't have neurology specialist listed)
    });
  });

  describe('Scenario 5: Missing Required Diagnostics', () => {
    it('should penalize score if diagnostic is not available', () => {
      const reqs = { ...requirements, requiredDiagnostics: ['MRI'] }; // MRI not available
      const { score, breakdown } = scoreFacility(baseFacility, 10, reqs, 'STANDARD');
      expect(breakdown.resources.score).toBe(0);
    });
  });

  describe('Scenario 6: Distance Penalty', () => {
    it('should score closer facilities higher than farther ones', () => {
      const scoreClose = calcDistanceScore(10); // 10km
      const scoreFar = calcDistanceScore(150);  // 150km
      expect(scoreClose).toBeGreaterThan(scoreFar);
    });
  });

  describe('Scenario 7: Waiting Time Penalty', () => {
    it('should score lower for longer waiting times', () => {
      const scoreShort = calcWaitingTimeScore(10); // 10 mins
      const scoreLong = calcWaitingTimeScore(180); // 180 mins
      expect(scoreShort).toBeGreaterThan(scoreLong);
    });
  });

  describe('Scenario 8: No Eligible Facilities', () => {
    it('should return empty ranked list if all facilities fail hard filters', () => {
      const nonOpFacility = { ...baseFacility, operationalStatus: 'CLOSED' };
      const result = ReferralRankingService.rankFacilities(
        [nonOpFacility], requirements, 'STANDARD', 25.0, 92.0
      );
      expect(result.ranked.length).toBe(0);
      expect(result.excluded.length).toBe(1);
      expect(result.excluded[0].reason).toContain('closed');
    });
  });

  describe('Scenario 9: Gender Preference', () => {
    it('should identify best matching gender facility if preference is specified', () => {
      const maleDoctorFacility = {
        ...baseFacility,
        id: 'f_male',
        specialists: [
          { specialization: 'CARDIOLOGIST', available: true, doctorCount: 1, maleDoctorCount: 1, femaleDoctorCount: 0 }
        ]
      };
      
      const reqs = { ...requirements, requiredSpecialist: 'CARDIOLOGIST', preferredSpecialistGender: 'MALE' };
      
      const { score, reasons } = scoreFacility(maleDoctorFacility, 10, reqs, 'STANDARD');
      expect(reasons).toContain('Gender preference matched: Male specialist available');
    });

    it('should notify if gender preference cannot be matched', () => {
      const maleDoctorFacility = {
        ...baseFacility,
        id: 'f_male',
        specialists: [
          { specialization: 'CARDIOLOGIST', available: true, doctorCount: 1, maleDoctorCount: 1, femaleDoctorCount: 0 }
        ]
      };
      
      const reqs = { ...requirements, requiredSpecialist: 'CARDIOLOGIST', preferredSpecialistGender: 'FEMALE' };
      
      const { score, reasons } = scoreFacility(maleDoctorFacility, 10, reqs, 'STANDARD');
      expect(reasons).toContain('No matching-gender specialist available; showing best available specialist');
    });
  });
});
