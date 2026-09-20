/**
 * src/controllers/facilityController.js
 * ──────────────────────────────────────
 * Person 4: Smart Referral AI – Facility CRUD Controller
 *
 * Handles all CRUD operations for healthcare facilities.
 * Facilities are the data foundation for the Smart Referral recommendation engine.
 *
 * Routes (all under /api/facilities):
 *   GET    /                   – List all facilities (with optional filters)
 *   POST   /                   – Create a new facility
 *   GET    /:id                 – Get a single facility with full details
 *   PUT    /:id                 – Update facility core fields
 *   DELETE /:id                 – Delete a facility (SYSTEM_ADMIN only)
 *   POST   /:id/services        – Add/update a service for this facility
 *   DELETE /:id/services/:name  – Remove a service
 *   POST   /:id/specialists     – Add/update a specialist
 *   DELETE /:id/specialists/:specialization – Remove a specialist
 *   POST   /:id/resources       – Add/update a resource/diagnostic
 *   DELETE /:id/resources/:name – Remove a resource
 *
 * Auth: HOSPITAL_ADMIN or SYSTEM_ADMIN for write operations
 *       Any authenticated user can read facility data
 */

const prisma = require('../config/db');
const { successResponse, errorResponse } = require('../utils/responseHelper');

// =============================================================================
// listFacilities
// =============================================================================
/**
 * GET /api/facilities
 * Returns a list of all facilities with optional filtering.
 *
 * @query type             – Filter by FacilityType
 * @query district         – Filter by district
 * @query state            – Filter by state
 * @query operationalStatus – Filter by operational status
 * @query emergencyCapability – "true" or "false"
 */
const listFacilities = async (req, res, next) => {
  try {
    const { type, district, state, operationalStatus, emergencyCapability } = req.query;

    const where = {};
    if (type)              where.type = type;
    if (district)          where.district = { contains: district, mode: 'insensitive' };
    if (state)             where.state = { contains: state, mode: 'insensitive' };
    if (operationalStatus) where.operationalStatus = operationalStatus;
    if (emergencyCapability !== undefined) {
      where.emergencyCapability = emergencyCapability === 'true';
    }

    const facilities = await prisma.facility.findMany({
      where,
      include: {
        services:    { select: { serviceName: true, available: true } },
        specialists: { select: { specialization: true, available: true, doctorCount: true } },
        resources:   { select: { resourceName: true, available: true, quantity: true } },
      },
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

// =============================================================================
// getFacility
// =============================================================================
/**
 * GET /api/facilities/:id
 * Returns a single facility with all its services, specialists, and resources.
 */
const getFacility = async (req, res, next) => {
  try {
    const { id } = req.params;

    const facility = await prisma.facility.findUnique({
      where: { id },
      include: {
        services:    true,
        specialists: true,
        resources:   true,
      },
    });

    if (!facility) {
      return errorResponse(res, `Facility with ID "${id}" not found.`, 404);
    }

    return successResponse(res, { facility }, 'Facility fetched successfully.');
  } catch (error) {
    next(error);
  }
};

// =============================================================================
// createFacility
// =============================================================================
/**
 * POST /api/facilities
 * Creates a new healthcare facility.
 *
 * @requires Body: { name, type, address, district, state, latitude, longitude }
 * @optional Body: { emergencyCapability, waitingTimeMinutes, phone, operationalStatus }
 * @requires Auth: HOSPITAL_ADMIN or SYSTEM_ADMIN
 */
const createFacility = async (req, res, next) => {
  try {
    const {
      name,
      type,
      address,
      district,
      state,
      latitude,
      longitude,
      emergencyCapability = false,
      waitingTimeMinutes,
      phone,
      operationalStatus = 'OPERATIONAL',
    } = req.body;

    // ── Validate required fields ──────────────────────────────────────────────
    if (!name || !type || !address || !district || !state || latitude == null || longitude == null) {
      return errorResponse(
        res,
        'Missing required fields: name, type, address, district, state, latitude, longitude',
        400
      );
    }

    // ── Validate enum values ──────────────────────────────────────────────────
    const VALID_TYPES = ['PHC', 'CHC', 'DISTRICT_HOSPITAL', 'TERTIARY', 'PRIVATE', 'AYUSHMAN'];
    if (!VALID_TYPES.includes(type)) {
      return errorResponse(
        res,
        `Invalid facility type. Must be one of: ${VALID_TYPES.join(', ')}`,
        400
      );
    }

    const VALID_STATUSES = ['OPERATIONAL', 'PARTIALLY_OPERATIONAL', 'CLOSED', 'MAINTENANCE'];
    if (!VALID_STATUSES.includes(operationalStatus)) {
      return errorResponse(
        res,
        `Invalid operationalStatus. Must be one of: ${VALID_STATUSES.join(', ')}`,
        400
      );
    }

    // ── Validate coordinates ──────────────────────────────────────────────────
    const lat = parseFloat(latitude);
    const lon = parseFloat(longitude);
    if (isNaN(lat) || lat < -90 || lat > 90) {
      return errorResponse(res, 'latitude must be a number between -90 and 90.', 400);
    }
    if (isNaN(lon) || lon < -180 || lon > 180) {
      return errorResponse(res, 'longitude must be a number between -180 and 180.', 400);
    }

    const facility = await prisma.facility.create({
      data: {
        name,
        type,
        address,
        district,
        state,
        latitude: lat,
        longitude: lon,
        emergencyCapability: Boolean(emergencyCapability),
        waitingTimeMinutes: waitingTimeMinutes ? parseInt(waitingTimeMinutes, 10) : null,
        phone: phone || null,
        operationalStatus,
        lastUpdated: new Date(),
      },
    });

    return successResponse(res, { facility }, 'Facility created successfully.', 201);
  } catch (error) {
    next(error);
  }
};

// =============================================================================
// updateFacility
// =============================================================================
/**
 * PUT /api/facilities/:id
 * Updates facility core fields.
 * Always sets lastUpdated to now() so data freshness is tracked.
 *
 * @requires Auth: HOSPITAL_ADMIN or SYSTEM_ADMIN
 */
const updateFacility = async (req, res, next) => {
  try {
    const { id } = req.params;

    const existing = await prisma.facility.findUnique({ where: { id } });
    if (!existing) {
      return errorResponse(res, `Facility with ID "${id}" not found.`, 404);
    }

    const {
      name,
      type,
      address,
      district,
      state,
      latitude,
      longitude,
      emergencyCapability,
      waitingTimeMinutes,
      phone,
      operationalStatus,
    } = req.body;

    const updateData = { lastUpdated: new Date() };

    if (name !== undefined)              updateData.name = name;
    if (type !== undefined)              updateData.type = type;
    if (address !== undefined)           updateData.address = address;
    if (district !== undefined)          updateData.district = district;
    if (state !== undefined)             updateData.state = state;
    if (latitude !== undefined)          updateData.latitude = parseFloat(latitude);
    if (longitude !== undefined)         updateData.longitude = parseFloat(longitude);
    if (emergencyCapability !== undefined) updateData.emergencyCapability = Boolean(emergencyCapability);
    if (waitingTimeMinutes !== undefined)  updateData.waitingTimeMinutes = parseInt(waitingTimeMinutes, 10);
    if (phone !== undefined)             updateData.phone = phone;
    if (operationalStatus !== undefined) updateData.operationalStatus = operationalStatus;

    const facility = await prisma.facility.update({
      where: { id },
      data: updateData,
    });

    return successResponse(res, { facility }, 'Facility updated successfully.');
  } catch (error) {
    next(error);
  }
};

// =============================================================================
// deleteFacility
// =============================================================================
/**
 * DELETE /api/facilities/:id
 * Permanently deletes a facility and all its related services/specialists/resources.
 * Cascading deletes are configured in the Prisma schema.
 *
 * @requires Auth: SYSTEM_ADMIN only
 */
const deleteFacility = async (req, res, next) => {
  try {
    const { id } = req.params;

    const existing = await prisma.facility.findUnique({ where: { id } });
    if (!existing) {
      return errorResponse(res, `Facility with ID "${id}" not found.`, 404);
    }

    await prisma.facility.delete({ where: { id } });

    return successResponse(res, null, 'Facility deleted successfully.');
  } catch (error) {
    next(error);
  }
};

// =============================================================================
// upsertFacilityService
// =============================================================================
/**
 * POST /api/facilities/:id/services
 * Adds or updates a service for a facility (upsert by facilityId + serviceName).
 *
 * @requires Body: { serviceName, available }
 * @requires Auth: HOSPITAL_ADMIN or SYSTEM_ADMIN
 */
const upsertFacilityService = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { serviceName, available = true } = req.body;

    if (!serviceName) {
      return errorResponse(res, 'serviceName is required.', 400);
    }

    const facility = await prisma.facility.findUnique({ where: { id } });
    if (!facility) {
      return errorResponse(res, `Facility with ID "${id}" not found.`, 404);
    }

    const service = await prisma.facilityService.upsert({
      where: { facilityId_serviceName: { facilityId: id, serviceName: serviceName.toUpperCase() } },
      update: { available: Boolean(available), updatedAt: new Date() },
      create: { facilityId: id, serviceName: serviceName.toUpperCase(), available: Boolean(available) },
    });

    // Refresh facility lastUpdated
    await prisma.facility.update({ where: { id }, data: { lastUpdated: new Date() } });

    return successResponse(res, { service }, 'Facility service updated successfully.');
  } catch (error) {
    next(error);
  }
};

// =============================================================================
// deleteFacilityService
// =============================================================================
/**
 * DELETE /api/facilities/:id/services/:serviceName
 * Removes a service from a facility.
 *
 * @requires Auth: HOSPITAL_ADMIN or SYSTEM_ADMIN
 */
const deleteFacilityService = async (req, res, next) => {
  try {
    const { id, serviceName } = req.params;

    const service = await prisma.facilityService.findUnique({
      where: { facilityId_serviceName: { facilityId: id, serviceName: serviceName.toUpperCase() } },
    });

    if (!service) {
      return errorResponse(res, `Service "${serviceName}" not found for facility "${id}".`, 404);
    }

    await prisma.facilityService.delete({
      where: { facilityId_serviceName: { facilityId: id, serviceName: serviceName.toUpperCase() } },
    });

    return successResponse(res, null, 'Facility service removed successfully.');
  } catch (error) {
    next(error);
  }
};

// =============================================================================
// upsertFacilitySpecialist
// =============================================================================
/**
 * POST /api/facilities/:id/specialists
 * Adds or updates a specialist for a facility (upsert).
 *
 * @requires Body: { specialization, available, doctorCount }
 * @requires Auth: HOSPITAL_ADMIN or SYSTEM_ADMIN
 */
const upsertFacilitySpecialist = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { specialization, available = true, doctorCount = 1 } = req.body;

    if (!specialization) {
      return errorResponse(res, 'specialization is required.', 400);
    }

    const facility = await prisma.facility.findUnique({ where: { id } });
    if (!facility) {
      return errorResponse(res, `Facility with ID "${id}" not found.`, 404);
    }

    const specialist = await prisma.facilitySpecialist.upsert({
      where: {
        facilityId_specialization: {
          facilityId: id,
          specialization: specialization.toUpperCase(),
        },
      },
      update: {
        available: Boolean(available),
        doctorCount: parseInt(doctorCount, 10),
        updatedAt: new Date(),
      },
      create: {
        facilityId: id,
        specialization: specialization.toUpperCase(),
        available: Boolean(available),
        doctorCount: parseInt(doctorCount, 10),
      },
    });

    await prisma.facility.update({ where: { id }, data: { lastUpdated: new Date() } });

    return successResponse(res, { specialist }, 'Facility specialist updated successfully.');
  } catch (error) {
    next(error);
  }
};

// =============================================================================
// deleteFacilitySpecialist
// =============================================================================
/**
 * DELETE /api/facilities/:id/specialists/:specialization
 * Removes a specialist from a facility.
 *
 * @requires Auth: HOSPITAL_ADMIN or SYSTEM_ADMIN
 */
const deleteFacilitySpecialist = async (req, res, next) => {
  try {
    const { id, specialization } = req.params;

    const specialist = await prisma.facilitySpecialist.findUnique({
      where: {
        facilityId_specialization: {
          facilityId: id,
          specialization: specialization.toUpperCase(),
        },
      },
    });

    if (!specialist) {
      return errorResponse(
        res,
        `Specialist "${specialization}" not found for facility "${id}".`,
        404
      );
    }

    await prisma.facilitySpecialist.delete({
      where: {
        facilityId_specialization: {
          facilityId: id,
          specialization: specialization.toUpperCase(),
        },
      },
    });

    return successResponse(res, null, 'Facility specialist removed successfully.');
  } catch (error) {
    next(error);
  }
};

// =============================================================================
// upsertFacilityResource
// =============================================================================
/**
 * POST /api/facilities/:id/resources
 * Adds or updates a diagnostic/resource for a facility (upsert).
 *
 * @requires Body: { resourceName, available, quantity (optional) }
 * @requires Auth: HOSPITAL_ADMIN or SYSTEM_ADMIN
 */
const upsertFacilityResource = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { resourceName, available = true, quantity } = req.body;

    if (!resourceName) {
      return errorResponse(res, 'resourceName is required.', 400);
    }

    const facility = await prisma.facility.findUnique({ where: { id } });
    if (!facility) {
      return errorResponse(res, `Facility with ID "${id}" not found.`, 404);
    }

    const resource = await prisma.facilityResource.upsert({
      where: {
        facilityId_resourceName: {
          facilityId: id,
          resourceName: resourceName.toUpperCase(),
        },
      },
      update: {
        available: Boolean(available),
        quantity: quantity != null ? parseInt(quantity, 10) : null,
        updatedAt: new Date(),
      },
      create: {
        facilityId: id,
        resourceName: resourceName.toUpperCase(),
        available: Boolean(available),
        quantity: quantity != null ? parseInt(quantity, 10) : null,
      },
    });

    await prisma.facility.update({ where: { id }, data: { lastUpdated: new Date() } });

    return successResponse(res, { resource }, 'Facility resource updated successfully.');
  } catch (error) {
    next(error);
  }
};

// =============================================================================
// deleteFacilityResource
// =============================================================================
/**
 * DELETE /api/facilities/:id/resources/:resourceName
 * Removes a resource/diagnostic from a facility.
 *
 * @requires Auth: HOSPITAL_ADMIN or SYSTEM_ADMIN
 */
const deleteFacilityResource = async (req, res, next) => {
  try {
    const { id, resourceName } = req.params;

    const resource = await prisma.facilityResource.findUnique({
      where: {
        facilityId_resourceName: {
          facilityId: id,
          resourceName: resourceName.toUpperCase(),
        },
      },
    });

    if (!resource) {
      return errorResponse(
        res,
        `Resource "${resourceName}" not found for facility "${id}".`,
        404
      );
    }

    await prisma.facilityResource.delete({
      where: {
        facilityId_resourceName: {
          facilityId: id,
          resourceName: resourceName.toUpperCase(),
        },
      },
    });

    return successResponse(res, null, 'Facility resource removed successfully.');
  } catch (error) {
    next(error);
  }
};

// =============================================================================
// getSmartReferralRecommendationOnly
// =============================================================================
/**
 * POST /api/facilities/recommend
 * Returns facility recommendations WITHOUT creating a referral.
 * Useful for the frontend to preview recommendations before a doctor confirms.
 *
 * @requires Body: { patientLatitude, patientLongitude, requiredService?, requiredSpecialist?, priority?, emergency?, requiredDiagnostics? }
 */
const getSmartReferralRecommendationOnly = async (req, res, next) => {
  try {
    const { getSmartReferralRecommendation } = require('../services/smartReferralService');

    const {
      patientLatitude,
      patientLongitude,
      requiredService,
      requiredSpecialist,
      priority,
      emergency,
      requiredDiagnostics,
    } = req.body;

    if (patientLatitude == null || patientLongitude == null) {
      return errorResponse(
        res,
        'patientLatitude and patientLongitude are required.',
        400
      );
    }

    const result = await getSmartReferralRecommendation({
      patientLatitude: parseFloat(patientLatitude),
      patientLongitude: parseFloat(patientLongitude),
      requiredService,
      requiredSpecialist,
      priority,
      emergency: emergency === true || emergency === 'true',
      requiredDiagnostics: Array.isArray(requiredDiagnostics) ? requiredDiagnostics : [],
    });

    if (result.noEligibleFacilities) {
      return errorResponse(res, result.message, 422);
    }

    return successResponse(res, result, 'Facility recommendation generated successfully.');
  } catch (error) {
    next(error);
  }
};

module.exports = {
  listFacilities,
  getFacility,
  createFacility,
  updateFacility,
  deleteFacility,
  upsertFacilityService,
  deleteFacilityService,
  upsertFacilitySpecialist,
  deleteFacilitySpecialist,
  upsertFacilityResource,
  deleteFacilityResource,
  getSmartReferralRecommendationOnly,
};
