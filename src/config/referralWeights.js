/**
 * src/config/referralWeights.js
 * ──────────────────────────────
 * Scoring weights for the Smart Referral AI (Person 4).
 *
 * These weights determine how much each factor contributes to the final
 * facility recommendation score (0–100).
 *
 * Two profiles are defined:
 *   STANDARD  – used for routine / urgent referrals
 *   EMERGENCY – used when emergency = true or priority = EMERGENCY
 *
 * IMPORTANT: All weights in each profile MUST sum to 1.0
 *
 * HOW TO TUNE:
 *   - Increase a weight to make that factor more important.
 *   - Decrease a weight to make it less important.
 *   - Do NOT change the keys (they are referenced by name in smartReferralService.js).
 *
 * FUTURE ML LAYER:
 *   This config file serves as the fallback when no ML model is deployed.
 *   When an ML model is available, it can be injected into ReferralRankingService
 *   without changing these weights — they will only apply to the rule-based path.
 */

const REFERRAL_WEIGHTS = {
  /**
   * STANDARD profile
   * ─────────────────
   * Used for LOW, MEDIUM, HIGH priority referrals.
   *
   * service     30% – Does the facility offer the required medical service?
   * specialist  25% – Is the required specialist available?
   * distance    15% – How close is the facility to the patient?
   * waitingTime 10% – What is the current estimated waiting time?
   * emergency   10% – Does the facility have emergency capability?
   * resources   10% – Are required diagnostics/resources available?
   */
  STANDARD: {
    service:     0.30,
    specialist:  0.25,
    distance:    0.15,
    waitingTime: 0.10,
    emergency:   0.10,
    resources:   0.10,
  },

  /**
   * EMERGENCY profile
   * ──────────────────
   * Used when emergency = true or priority = EMERGENCY.
   *
   * In emergencies:
   *   - Emergency capability is the most critical factor (25%)
   *   - Specialist availability is equally critical (25%)
   *   - Service availability is still very important (25%)
   *   - Distance is critical for time-sensitive cases (15%)
   *   - Waiting time matters more in emergencies (10%)
   *   - Resources are a secondary concern (0%) — handled via eligibility filter
   *
   * NOTE: Non-emergency facilities are excluded BEFORE scoring in emergency mode.
   *       These weights apply only AMONG eligible emergency-capable facilities.
   */
  EMERGENCY: {
    service:     0.25,
    specialist:  0.25,
    emergency:   0.25,
    distance:    0.15,
    waitingTime: 0.10,
    resources:   0.00,
  },
};

/**
 * Maximum distance (km) beyond which facilities receive a score of 0 for distance.
 * Facilities farther than this are not excluded — they still participate in scoring,
 * but their distance score becomes 0.
 *
 * Can be overridden per-request in the future.
 */
const MAX_DISTANCE_KM = parseInt(process.env.REFERRAL_MAX_DISTANCE_KM || '200', 10);

/**
 * Maximum waiting time (minutes) beyond which facilities receive a score of 0 for waiting.
 */
const MAX_WAITING_TIME_MINUTES = parseInt(
  process.env.REFERRAL_MAX_WAITING_TIME_MINUTES || '240',
  10
);

/**
 * Maximum number of alternative facilities to return in the recommendation.
 */
const MAX_ALTERNATIVES = parseInt(process.env.REFERRAL_MAX_ALTERNATIVES || '3', 10);

module.exports = {
  REFERRAL_WEIGHTS,
  MAX_DISTANCE_KM,
  MAX_WAITING_TIME_MINUTES,
  MAX_ALTERNATIVES,
};
