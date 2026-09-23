/**
 * src/controllers/serviceController.js
 * --------------------------------------
 * Service availability controller.
 */

const prisma = require('../config/db');
const { successResponse, errorResponse } = require('../utils/responseHelper');
const { createNotification } = require('../utils/notificationService');

// =============================================================================
// CREATE SERVICE
// =============================================================================

/**
 * POST /api/services
 *
 * Body:
 * {
 *   "name": "General Consultation",
 *   "category": "Clinical",
 *   "description": "Outpatient consultations"
 * }
 */
const createService = async (req, res, next) => {
  try {
    const { name, category, description } = req.body;

    if (!name || !name.trim()) {
      return errorResponse(res, 'Service name is required', 400);
    }

    const service = await prisma.service.create({
      data: {
        name: name.trim(),
        category: category || null,
        description: description || null,
      },
    });

    return successResponse(
      res,
      { service },
      'Service created successfully',
      201
    );
  } catch (error) {
    next(error);
  }
};

// =============================================================================
// GET ALL SERVICES
// =============================================================================

/**
 * GET /api/services
 */
const getServices = async (req, res, next) => {
  try {
    const services = await prisma.service.findMany({
      orderBy: {
        name: 'asc',
      },
    });

    return successResponse(
      res,
      { services },
      'Services fetched successfully'
    );
  } catch (error) {
    next(error);
  }
};

// =============================================================================
// ADD / UPDATE SERVICE AVAILABILITY
// =============================================================================

/**
 * POST /api/services/availability
 *
 * Body:
 * {
 *   "serviceId": "...",
 *   "facilityId": "...",
 *   "available": true
 * }
 */
const updateServiceAvailability = async (req, res, next) => {
  try {
    const { serviceId, facilityId, available } = req.body;

    const missingFields = [];

    if (!serviceId) missingFields.push('serviceId');
    if (!facilityId) missingFields.push('facilityId');
    if (available === undefined || available === null) {
      missingFields.push('available');
    }

    if (missingFields.length > 0) {
      return errorResponse(
        res,
        'Missing required fields: ' + missingFields.join(', '),
        400
      );
    }

    if (typeof available !== 'boolean') {
      return errorResponse(res, 'available must be a boolean', 400);
    }

    const [service, facility] = await Promise.all([
      prisma.service.findUnique({
        where: { id: serviceId },
        select: {
          id: true,
          name: true,
        },
      }),
      prisma.facility.findUnique({
        where: { id: facilityId },
        select: {
          id: true,
          name: true,
        },
      }),
    ]);

    if (!service) {
      return errorResponse(
        res,
        'Service with ID "' + serviceId + '" not found',
        404
      );
    }

    if (!facility) {
      return errorResponse(
        res,
        'Facility with ID "' + facilityId + '" not found',
        404
      );
    }
    const existingAvailability = await prisma.serviceAvailability.findUnique({
  where: {
    serviceId_facilityId: {
      serviceId,
      facilityId,
    },
  },
  select: {
    available: true,
  },
});

const serviceAvailability = await prisma.serviceAvailability.upsert({
  where: {
    serviceId_facilityId: {
      serviceId,
      facilityId,
    },
  },
  create: {
    serviceId,
    facilityId,
    available,
  },
  update: {
    available,
  },
  include: {
    service: {
      select: {
        id: true,
        name: true,
      },
    },
    facility: {
      select: {
        id: true,
        name: true,
        type: true,
        district: true,
        state: true,
      },
    },
  },
});

    // ── Synchronize with Person 4 FacilityService table ─────────────────────
    try {
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
          available,
        },
        update: {
          available,
        },
      });
    } catch (fsErr) {
      // Non-fatal if table not present
    }

    if (existingAvailability?.available && !serviceAvailability.available) {
      await createNotification({
        type: 'GENERAL',
        priority: 'HIGH',
        title: 'Service Unavailable',
        message:
          service.name +
          ' is no longer available at ' +
          facility.name +
          '. Referral routing updated.',
      });
    }

    return successResponse(
      res,
      { serviceAvailability },
      'Service availability updated successfully'
    );
  } catch (error) {
    next(error);

  }
};

// =============================================================================
// CHECK SERVICE AVAILABILITY
// =============================================================================

/**
 * GET /api/services/:id/availability
 *
 * Returns facilities where the requested service is currently available.
 */
const getServiceAvailability = async (req, res, next) => {
  try {
    const { id } = req.params;

    const service = await prisma.service.findUnique({
      where: { id },
    });

    if (!service) {
      return errorResponse(
        res,
        'Service with ID "' + id + '" not found',
        404
      );
    }

    const availability = await prisma.serviceAvailability.findMany({
     where: {
  serviceId: id,
  available: true,
},
      select: {
        available: true,
        lastUpdated: true,
        facility: {
          select: {
            id: true,
            name: true,
            type: true,
            district: true,
            state: true,
            phone: true,
            latitude: true,
            longitude: true,
          },
        },
      },
      orderBy: {
        facility: {
          name: 'asc',
        },
      },
    });

    return successResponse(
      res,
      {
        service: {
          id: service.id,
          name: service.name,
          category: service.category,
          description: service.description,
        },
        availability,
      },
      'Service availability fetched successfully'
    );
  } catch (error) {
    next(error);
  }
};

module.exports = {
  createService,
  getServices,
  updateServiceAvailability,
  getServiceAvailability,
};
