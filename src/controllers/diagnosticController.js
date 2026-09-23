const prisma = require('../config/db');
const { successResponse, errorResponse } = require('../utils/responseHelper');

const createDiagnosticTest = async (req, res, next) => {
  try {
    const { name, category, description } = req.body;

    if (!name) {
      return errorResponse(res, 'Diagnostic test name is required', 400);
    }

    const test = await prisma.diagnosticTest.create({
      data: {
        name,
        category,
        description,
      },
    });

    return successResponse(
      res,
      test,
      'Diagnostic test created successfully',
      201
    );
  } catch (error) {
    next(error);
  }
};

const getDiagnosticTests = async (req, res, next) => {
  try {
    const tests = await prisma.diagnosticTest.findMany({
      orderBy: {
        name: 'asc',
      },
    });

    return successResponse(
      res,
      { diagnosticTests: tests },
      'Diagnostic tests fetched successfully'
    );
  } catch (error) {
    next(error);
  }
};

const getDiagnosticAvailability = async (req, res, next) => {
  try {
    const { id } = req.params;

    const availability = await prisma.diagnosticAvailability.findMany({
      where: {
        testId: id,
        available: true,
      },
      include: {
        facility: true,
      },
    });

    return successResponse(
      res,
      { availability },
      'Diagnostic availability fetched successfully'
    );
  } catch (error) {
    next(error);
  }
};

const updateDiagnosticAvailability = async (req, res, next) => {
  try {
    const { testId, facilityId, available } = req.body;

    if (!testId || !facilityId || available === undefined) {
      return errorResponse(
        res,
        'Missing required fields: testId, facilityId, available',
        400
      );
    }

    const isAvailable = Boolean(available);

    const [result, test, facility] = await Promise.all([
      prisma.diagnosticAvailability.upsert({
        where: {
          testId_facilityId: {
            testId,
            facilityId,
          },
        },
        update: {
          available: isAvailable,
        },
        create: {
          testId,
          facilityId,
          available: isAvailable,
        },
      }),
      prisma.diagnosticTest.findUnique({ where: { id: testId } }),
      prisma.facility.findUnique({ where: { id: facilityId } }),
    ]);

    // ── Synchronize with Person 4 FacilityResource table ─────────────────────
    if (test) {
      try {
        await prisma.facilityResource.upsert({
          where: {
            facilityId_resourceName: {
              facilityId,
              resourceName: test.name,
            },
          },
          create: {
            facilityId,
            resourceName: test.name,
            available: isAvailable,
          },
          update: {
            available: isAvailable,
          },
        });
      } catch (frErr) {
        // Non-fatal if table not present
      }
    }

    // ── If unavailable, create high priority notification ─────────────────────
    if (!isAvailable && test && facility) {
      const { createNotification } = require('../utils/notificationService');
      await createNotification({
        type: 'DIAGNOSTIC_UNAVAILABLE',
        priority: 'HIGH',
        title: 'Diagnostic Machine Out of Order',
        message: `Diagnostic test "${test.name}" is currently unavailable at ${facility.name}. Referral routing updated.`,
      });
    }

    return successResponse(
      res,
      result,
      'Diagnostic availability updated successfully'
    );
  } catch (error) {
    next(error);
  }
};

module.exports = {
  createDiagnosticTest,
  getDiagnosticTests,
  getDiagnosticAvailability,
  updateDiagnosticAvailability,
};