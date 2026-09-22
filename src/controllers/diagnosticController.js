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

    const result = await prisma.diagnosticAvailability.upsert({
      where: {
        testId_facilityId: {
          testId,
          facilityId,
        },
      },
      update: {
        available: Boolean(available),
      },
      create: {
        testId,
        facilityId,
        available: Boolean(available),
      },
    });

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