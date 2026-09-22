/**
 * src/utils/geoDistance.js
 * ─────────────────────────
 * Haversine formula for calculating great-circle distance between two
 * geographic coordinates.
 *
 * Used by the Smart Referral AI (Person 4) to compute the distance between
 * a patient's current location and candidate healthcare facilities.
 *
 * The Haversine formula gives an accurate approximation of the straight-line
 * (as-the-crow-flies) distance. Road distance is typically 1.2–1.5× longer,
 * but without a mapping API this is the most reliable approach for relative
 * ranking of facilities.
 */

const EARTH_RADIUS_KM = 6371;

/**
 * Converts degrees to radians.
 * @param {number} degrees
 * @returns {number} radians
 */
function toRad(degrees) {
  return (degrees * Math.PI) / 180;
}

/**
 * Calculates the Haversine distance between two geographic points.
 *
 * @param {number} lat1 - Latitude of point 1 (decimal degrees)
 * @param {number} lon1 - Longitude of point 1 (decimal degrees)
 * @param {number} lat2 - Latitude of point 2 (decimal degrees)
 * @param {number} lon2 - Longitude of point 2 (decimal degrees)
 * @returns {number} Distance in kilometres, rounded to 2 decimal places
 *
 * @example
 * const km = calculateDistanceKm(24.82, 92.76, 25.57, 91.88);
 * // → ~106.4
 */
function calculateDistanceKm(lat1, lon1, lat2, lon2) {
  if (
    lat1 == null || lon1 == null ||
    lat2 == null || lon2 == null
  ) {
    return null;
  }

  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const distanceKm = EARTH_RADIUS_KM * c;

  return Math.round(distanceKm * 100) / 100; // 2 decimal places
}

module.exports = { calculateDistanceKm };
