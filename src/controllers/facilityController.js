/**
 * src/controllers/facilityController.js
 * ---------------------------------------
 * Read-only list of health facilities (sub-centres, PHCs, CHCs, hospitals).
 *
 * The mobile app caches this list so an ASHA can pick a facility offline; web
 * clients can use it to populate referral dropdowns.
 *
 * NOTE: Referral / Encounter facility fields are still plain strings — they are
 * deliberately NOT foreign keys to this table, so existing web code that sends
 * free-form facility IDs keeps working.
 *
 *   prisma.facility → model Facility
 */

const prisma = require('../config/db');
const { successResponse } = require('../utils/responseHelper');

/**
 * GET /api/facilities
 * Lists facilities, ordered by name.
 *
 * @optional Query: district — exact match, case-insensitive (e.g. ?district=pune)
 * @requires Auth: any authenticated role
 */
const listFacilities = async (req, res, next) => {
  try {
    const { district } = req.query;

    const facilities = await prisma.facility.findMany({
      where: district ? { district: { equals: district, mode: 'insensitive' } } : {},
      orderBy: { name: 'asc' },
    });

    return successResponse(
      res,
      { count: facilities.length, facilities },
      'Facilities fetched successfully.'
    );
  } catch (error) {
    next(error);
  }
};

module.exports = { listFacilities };
