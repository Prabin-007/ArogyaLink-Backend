/**
 * src/services/smartReferralService.js
 * ──────────────────────────────────────
 * Person 4: Smart Referral AI – Core Service
 *
 * This service implements a hybrid facility matching & recommendation system:
 *
 *   PHASE 1: Rule-based eligibility filtering
 *            – Removes facilities that clearly cannot serve the patient
 *
 *   PHASE 2: Weighted facility scoring
 *            – Ranks eligible facilities using configurable weights
 *
 *   PHASE 3: ML ranking interface (future)
 *            – Optional ML layer can be plugged in via ReferralRankingService
 *
 * The service returns:
 *   - A ranked list of eligible facilities
 *   - A recommendation (the top-ranked facility)
 *   - Alternative facilities
 *   - Explainable reasons for the recommendation
 *   - Distance from patient to each facility
 *   - Normalised score (0–100)
 *
 * Integration:
 *   - Consumed by referralController.js (POST /api/referrals)
 *   - Reads facility data from Prisma (facilities, facility_services, etc.)
 *   - Does NOT create referral records — that remains with referralController.js
 *   - Accepts emergency/priority values from Person 5 (Triage AI)
 *   - Designed so Person 6 (Medicine Inventory) can inject resource data later
 *
 * Coding rules:
 *   - No hard-coded facility names or patient data
 *   - No clinical decisions
 *   - All weights are in src/config/referralWeights.js
 *   - Returns explainable reasons for every recommendation
 */

const prisma = require('../config/db');
const { calculateDistanceKm } = require('../utils/geoDistance');
const {
  REFERRAL_WEIGHTS,
  MAX_DISTANCE_KM,
  MAX_WAITING_TIME_MINUTES,
  MAX_ALTERNATIVES,
} = require('../config/referralWeights');

// =============================================================================
// Phase 1 – Eligibility Filter
// =============================================================================
/**
 * Removes facilities that definitely cannot handle the patient's needs.
 *
 * Exclusion rules (hard filters – facility is completely removed):
 *   1. Facility is not OPERATIONAL
 *   2. Emergency case but facility has no emergency capability
 *   3. Required service is listed as unavailable (not just absent)
 *
 * Soft filters (facility is kept but will score lower):
 *   - Required specialist is unavailable
 *   - Required diagnostic/resource is unavailable
 *   - Long waiting time
 *   - Distance is large
 *
 * @param {Array}   facilities      – Prisma Facility records with relations
 * @param {object}  requirements    – What the patient needs
 * @param {string}  [requirements.requiredService]    – e.g., "CARDIOLOGY"
 * @param {string}  [requirements.requiredSpecialist] – e.g., "CARDIOLOGIST"
 * @param {boolean} [requirements.emergency]          – Is this an emergency?
 * @param {string[]}[requirements.requiredDiagnostics]– e.g., ["ECG"]
 * @returns {{ eligible: Array, excluded: Array<{facility, reason}> }}
 */
function filterEligibleFacilities(facilities, requirements) {
  const {
    requiredService,
    requiredSpecialist,
    emergency = false,
    requiredDiagnostics = [],
  } = requirements;

  const eligible = [];
  const excluded = [];

  for (const facility of facilities) {
    // ── Rule 1: Facility must be OPERATIONAL ──────────────────────────────────
    if (facility.operationalStatus !== 'OPERATIONAL') {
      excluded.push({
        facility,
        reason: `Facility is ${facility.operationalStatus.toLowerCase().replace('_', ' ')}`,
      });
      continue;
    }

    // ── Rule 2: Emergency cases require emergency capability ──────────────────
    if (emergency && !facility.emergencyCapability) {
      excluded.push({
        facility,
        reason: 'No emergency capability (required for emergency referral)',
      });
      continue;
    }

    // ── Rule 3: Required service must not be explicitly marked unavailable ────
    if (requiredService) {
      const serviceRecord = facility.services.find(
        (s) => s.serviceName.toUpperCase() === requiredService.toUpperCase()
      );
      if (serviceRecord && !serviceRecord.available) {
        // Only exclude if the service is explicitly listed AND unavailable
        excluded.push({
          facility,
          reason: `Required service "${requiredService}" is currently unavailable`,
        });
        continue;
      }
    }

    // Facility passes all hard filters → eligible
    eligible.push(facility);
  }

  return { eligible, excluded };
}

// =============================================================================
// Phase 2 – Component Score Calculators
// =============================================================================

/**
 * Service availability score (0–1).
 * 1.0 if the service is available or not required.
 * 0.5 if the service is not listed (may or may not have it).
 * 0.0 if the service is listed as unavailable.
 */
function calcServiceScore(facility, requiredService) {
  if (!requiredService) return 1.0; // No requirement → full marks

  const serviceRecord = facility.services.find(
    (s) => s.serviceName.toUpperCase() === requiredService.toUpperCase()
  );

  if (!serviceRecord) return 0.5;   // Unknown – facility might have it
  if (serviceRecord.available) return 1.0;
  return 0.0; // Explicitly unavailable (shouldn't reach here after filter, but defensive)
}

/**
 * Specialist availability score (0–1).
 * 1.0 if the specialist is available or not required.
 * 0.5 if the specialist type is not listed.
 * 0.0 if listed as unavailable.
 * Bonus scaling for facilities with more than one specialist.
 */
function calcSpecialistScore(facility, requiredSpecialist) {
  if (!requiredSpecialist) return 1.0;

  const specialistRecord = facility.specialists.find(
    (s) => s.specialization.toUpperCase() === requiredSpecialist.toUpperCase()
  );

  if (!specialistRecord) return 0.5;
  if (!specialistRecord.available) return 0.0;

  // More specialists → slightly higher score (capped at 1.0)
  const countBonus = Math.min((specialistRecord.doctorCount - 1) * 0.05, 0.2);
  return Math.min(1.0 + countBonus, 1.0);
}

/**
 * Distance score (0–1).
 * 1.0 if distance = 0.
 * Scales linearly to 0.0 at MAX_DISTANCE_KM.
 * Returns 0.5 if distance is unknown (null).
 */
function calcDistanceScore(distanceKm) {
  if (distanceKm == null) return 0.5;
  if (distanceKm <= 0) return 1.0;
  if (distanceKm >= MAX_DISTANCE_KM) return 0.0;
  return 1.0 - distanceKm / MAX_DISTANCE_KM;
}

/**
 * Waiting time score (0–1).
 * 1.0 if waiting time is 0 or unknown.
 * Scales linearly to 0.0 at MAX_WAITING_TIME_MINUTES.
 */
function calcWaitingTimeScore(waitingTimeMinutes) {
  if (waitingTimeMinutes == null) return 0.8; // Unknown → slightly optimistic
  if (waitingTimeMinutes <= 0) return 1.0;
  if (waitingTimeMinutes >= MAX_WAITING_TIME_MINUTES) return 0.0;
  return 1.0 - waitingTimeMinutes / MAX_WAITING_TIME_MINUTES;
}

/**
 * Emergency capability score (0–1).
 * 1.0 if facility has emergency capability.
 * 0.0 if it does not.
 */
function calcEmergencyScore(facility) {
  return facility.emergencyCapability ? 1.0 : 0.0;
}

/**
 * Resource/diagnostic availability score (0–1).
 * 1.0 if all required diagnostics are available (or none required).
 * Partial credit for partial availability.
 */
function calcResourceScore(facility, requiredDiagnostics = []) {
  if (!requiredDiagnostics || requiredDiagnostics.length === 0) return 1.0;

  let found = 0;
  for (const diag of requiredDiagnostics) {
    const resourceRecord = facility.resources.find(
      (r) => r.resourceName.toUpperCase() === diag.toUpperCase()
    );
    if (resourceRecord && resourceRecord.available) {
      found++;
    }
  }

  return found / requiredDiagnostics.length;
}

// =============================================================================
// Phase 2 – Final Weighted Score
// =============================================================================
/**
 * Calculates the final weighted score for a facility (0–100).
 *
 * @param {object} facility        – Prisma Facility with relations
 * @param {number} distanceKm      – Pre-calculated distance from patient
 * @param {object} requirements    – Patient requirements
 * @param {string} weightProfile   – 'STANDARD' or 'EMERGENCY'
 * @returns {{ score: number, breakdown: object, reasons: string[] }}
 */
function scoreFacility(facility, distanceKm, requirements, weightProfile = 'STANDARD') {
  const {
    requiredService,
    requiredSpecialist,
    requiredDiagnostics = [],
  } = requirements;

  const weights = REFERRAL_WEIGHTS[weightProfile] || REFERRAL_WEIGHTS.STANDARD;

  // ── Calculate individual component scores ─────────────────────────────────
  const serviceScore    = calcServiceScore(facility, requiredService);
  const specialistScore = calcSpecialistScore(facility, requiredSpecialist);
  const distanceScore   = calcDistanceScore(distanceKm);
  const waitingScore    = calcWaitingTimeScore(facility.waitingTimeMinutes);
  const emergencyScore  = calcEmergencyScore(facility);
  const resourceScore   = calcResourceScore(facility, requiredDiagnostics);

  // ── Weighted sum ───────────────────────────────────────────────────────────
  const rawScore =
    serviceScore    * weights.service +
    specialistScore * weights.specialist +
    distanceScore   * weights.distance +
    waitingScore    * weights.waitingTime +
    emergencyScore  * weights.emergency +
    resourceScore   * weights.resources;

  // Convert to 0–100 scale
  const finalScore = Math.round(rawScore * 1000) / 10; // 1 decimal place

  // ── Build breakdown (useful for debugging and transparency) ───────────────
  const breakdown = {
    service:    { score: serviceScore,    weight: weights.service,     weighted: serviceScore    * weights.service    },
    specialist: { score: specialistScore, weight: weights.specialist,  weighted: specialistScore * weights.specialist },
    distance:   { score: distanceScore,   weight: weights.distance,    weighted: distanceScore   * weights.distance   },
    waitingTime:{ score: waitingScore,    weight: weights.waitingTime, weighted: waitingScore    * weights.waitingTime},
    emergency:  { score: emergencyScore,  weight: weights.emergency,   weighted: emergencyScore  * weights.emergency  },
    resources:  { score: resourceScore,   weight: weights.resources,   weighted: resourceScore   * weights.resources  },
  };

  // ── Build human-readable reasons (explainability) ─────────────────────────
  const reasons = buildReasons(facility, distanceKm, requirements, breakdown);

  return { score: finalScore, breakdown, reasons };
}

// =============================================================================
// Explainability – Human-Readable Reasons
// =============================================================================
/**
 * Generates a list of human-readable strings explaining why this facility
 * received its score. These are returned in the API response for the frontend
 * to display directly to the user.
 *
 * @param {object} facility
 * @param {number} distanceKm
 * @param {object} requirements
 * @param {object} breakdown
 * @returns {string[]}
 */
function buildReasons(facility, distanceKm, requirements, breakdown) {
  const reasons = [];

  // Service
  if (requirements.requiredService) {
    const s = breakdown.service.score;
    if (s === 1.0) {
      reasons.push(`Required service "${requirements.requiredService}" is available`);
    } else if (s === 0.5) {
      reasons.push(`Service "${requirements.requiredService}" availability not confirmed`);
    }
  }

  // Specialist & Gender Preference
  if (requirements.requiredSpecialist) {
    const s = breakdown.specialist.score;
    const rec = facility.specialists.find(
      (sp) => sp.specialization.toUpperCase() === requirements.requiredSpecialist.toUpperCase()
    );
    if (s >= 1.0 && rec) {
      let specStr = `${formatSpecialist(requirements.requiredSpecialist)} available`;
      
      // Check gender preference
      if (requirements.preferredSpecialistGender && requirements.preferredSpecialistGender !== 'ANY') {
        const pref = requirements.preferredSpecialistGender.toUpperCase();
        const hasMale = rec.maleDoctorCount > 0;
        const hasFemale = rec.femaleDoctorCount > 0;
        
        if (pref === 'FEMALE' && hasFemale) {
          reasons.push(`Gender preference matched: Female specialist available`);
        } else if (pref === 'MALE' && hasMale) {
          reasons.push(`Gender preference matched: Male specialist available`);
        } else {
          reasons.push(`No matching-gender specialist available; showing best available specialist`);
        }
      } else {
        if (rec.doctorCount > 1) specStr += ` (${rec.doctorCount} on staff)`;
        reasons.push(specStr);
      }
    } else if (s === 0.5) {
      reasons.push(`${formatSpecialist(requirements.requiredSpecialist)} availability not confirmed`);
    } else {
      reasons.push(`${formatSpecialist(requirements.requiredSpecialist)} currently unavailable`);
    }
  }

  // Emergency
  if (facility.emergencyCapability) {
    reasons.push('Emergency capability available');
  } else {
    reasons.push('No emergency capability');
  }

  // Distance
  if (distanceKm != null) {
    reasons.push(`${distanceKm} km from patient location`);
  }

  // Waiting time
  if (facility.waitingTimeMinutes != null) {
    if (facility.waitingTimeMinutes <= 30) {
      reasons.push(`Short estimated waiting time (~${facility.waitingTimeMinutes} min)`);
    } else if (facility.waitingTimeMinutes <= 90) {
      reasons.push(`Moderate estimated waiting time (~${facility.waitingTimeMinutes} min)`);
    } else {
      reasons.push(`Long estimated waiting time (~${facility.waitingTimeMinutes} min)`);
    }
  } else {
    reasons.push('Waiting time not reported');
  }

  // Diagnostics / Resources
  const diags = requirements.requiredDiagnostics || [];
  if (diags.length > 0) {
    const available = [];
    const unavailable = [];
    for (const diag of diags) {
      const rec = facility.resources.find(
        (r) => r.resourceName.toUpperCase() === diag.toUpperCase()
      );
      if (rec && rec.available) {
        available.push(diag);
      } else {
        unavailable.push(diag);
      }
    }
    if (available.length > 0) {
      reasons.push(`Available diagnostics: ${available.join(', ')}`);
    }
    if (unavailable.length > 0) {
      reasons.push(`Diagnostics not confirmed: ${unavailable.join(', ')}`);
    }
  }

  // Data freshness
  const hoursAgo = Math.floor(
    (Date.now() - new Date(facility.lastUpdated).getTime()) / (1000 * 60 * 60)
  );
  if (hoursAgo < 24) {
    reasons.push(`Facility data updated ${hoursAgo}h ago`);
  } else {
    reasons.push(`Facility data may be stale (updated ${Math.floor(hoursAgo / 24)}d ago)`);
  }

  return reasons;
}

/**
 * Formats a specialist string for display.
 * "CARDIOLOGIST" → "Cardiologist"
 */
function formatSpecialist(spec) {
  return spec.charAt(0).toUpperCase() + spec.slice(1).toLowerCase();
}

/**
 * Checks if a facility has a specialist of the requested gender.
 */
function hasPreferredGenderSpecialist(facility, requiredSpecialist, preferredGender) {
  if (!requiredSpecialist || !preferredGender || preferredGender === 'ANY') return false;
  
  const rec = facility.specialists.find(
    (sp) => sp.specialization.toUpperCase() === requiredSpecialist.toUpperCase()
  );
  
  if (!rec || !rec.available) return false;
  
  const pref = preferredGender.toUpperCase();
  if (pref === 'FEMALE' && rec.femaleDoctorCount > 0) return true;
  if (pref === 'MALE' && rec.maleDoctorCount > 0) return true;
  
  return false;
}

// =============================================================================
// ReferralRankingService – Clean ML Interface Boundary
// =============================================================================
/**
 * ReferralRankingService provides the ranking layer between raw facility data
 * and the final recommendation.
 *
 * Currently: only `rankWithRules` is implemented (rule-based + weighted scoring).
 * Future: `rankWithML` can be added when a verified training dataset is available.
 */
const ReferralRankingService = {
  /**
   * Rank facilities using rule-based eligibility filtering + weighted scoring.
   * This is the default production implementation.
   */
  rankWithRules(facilities, requirements, weightProfile, patLat, patLon) {
    // Phase 1: Filter
    const { eligible, excluded } = filterEligibleFacilities(facilities, requirements);

    if (eligible.length === 0) {
      return { ranked: [], excluded };
    }

    // Phase 2: Score each eligible facility
    const scored = eligible.map((facility) => {
      const distanceKm = calculateDistanceKm(
        patLat, patLon, facility.latitude, facility.longitude
      );
      const { score, breakdown, reasons } = scoreFacility(
        facility, distanceKm, requirements, weightProfile
      );
      return { facility, score, distanceKm, breakdown, reasons };
    });

    // Sort descending by score (highest score = best recommendation)
    scored.sort((a, b) => b.score - a.score);

    return { ranked: scored, excluded };
  },

  rankWithML(/* facilities, requirements, weightProfile, patLat, patLon */) {
    throw new Error(
      'ML ranking not yet implemented. Use rankWithRules() for production.'
    );
  },

  rankFacilities(facilities, requirements, weightProfile, patLat, patLon) {
    return this.rankWithRules(facilities, requirements, weightProfile, patLat, patLon);
  },
};

// =============================================================================
// Main exported function: getSmartReferralRecommendation
// =============================================================================
/**
 * The primary Smart Referral AI entry point.
 */
async function getSmartReferralRecommendation(params) {
  const {
    patientLatitude,
    patientLongitude,
    requiredService,
    requiredSpecialist,
    preferredSpecialistGender,
    priority = 'MEDIUM',
    emergency = false,
    requiredDiagnostics = [],
  } = params;

  // ── Determine scoring profile ─────────────────────────────────────────────
  const isEmergency = emergency === true || priority === 'EMERGENCY';
  const weightProfile = isEmergency ? 'EMERGENCY' : 'STANDARD';

  const requirements = {
    requiredService,
    requiredSpecialist,
    preferredSpecialistGender,
    emergency: isEmergency,
    requiredDiagnostics,
  };

  const facilities = await prisma.facility.findMany({
    include: {
      services:    true,
      specialists: true,
      resources:   true,
    },
  });

  if (facilities.length === 0) {
    return {
      recommendation: null,
      alternatives: [],
      excludedCount: 0,
      eligibleCount: 0,
      weightProfile,
      noEligibleFacilities: true,
      message: 'No facilities are registered in the system. Please seed facility data.',
    };
  }

  // ── Run ranking ───────────────────────────────────────────────────────────
  const { ranked, excluded } = ReferralRankingService.rankFacilities(
    facilities,
    requirements,
    weightProfile,
    patientLatitude,
    patientLongitude
  );

  if (ranked.length === 0) {
    return {
      recommendation: null,
      alternatives: [],
      excludedCount: excluded.length,
      eligibleCount: 0,
      weightProfile,
      noEligibleFacilities: true,
      message: 'No eligible facilities found for the given requirements.',
    };
  }

  // ── Format recommendation ─────────────────────────────────────────────────
  const formatFacilityResult = (item) => ({
    facilityId:   item.facility.id,
    facilityName: item.facility.name,
    facilityType: item.facility.type,
    address:      item.facility.address,
    district:     item.facility.district,
    state:        item.facility.state,
    score:        item.score,
    distanceKm:   item.distanceKm,
    waitingTimeMinutes: item.facility.waitingTimeMinutes,
    emergencyCapability: item.facility.emergencyCapability,
    reasons:      item.reasons,
  });

  const bestOverall = ranked[0];
  let bestMatchingGender = null;

  // Find the highest ranked facility that actually matches the gender preference
  if (preferredSpecialistGender && preferredSpecialistGender !== 'ANY') {
    bestMatchingGender = ranked.find((item) => 
      hasPreferredGenderSpecialist(item.facility, requiredSpecialist, preferredSpecialistGender)
    );
  }

  // The primary recommendation prioritizes gender match if requested and available.
  // Otherwise, falls back to best overall.
  const primaryRec = bestMatchingGender || bestOverall;
  
  // Find alternatives (excluding the primary recommendation)
  const alternatives = ranked
    .filter(item => item.facility.id !== primaryRec.facility.id)
    .slice(0, MAX_ALTERNATIVES)
    .map(formatFacilityResult);

  return {
    recommendation: formatFacilityResult(primaryRec),
    bestOverall: formatFacilityResult(bestOverall),
    bestMatchingGender: bestMatchingGender ? formatFacilityResult(bestMatchingGender) : null,
    alternatives,
    excludedCount:        excluded.length,
    eligibleCount:        ranked.length,
    weightProfile,
    noEligibleFacilities: false,
  };
}

module.exports = {
  getSmartReferralRecommendation,
  ReferralRankingService,
  // Exported for testing
  filterEligibleFacilities,
  scoreFacility,
  calcDistanceScore,
  calcWaitingTimeScore,
  calcServiceScore,
  calcSpecialistScore,
  calcEmergencyScore,
  calcResourceScore,
};
