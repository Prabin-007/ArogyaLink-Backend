/**
 * src/controllers/medicineController.js
 * ---------------------------------------
 * Medicine Controller — ArogyaLink Person 6
 *
 * Manages:
 *   - Medicine master records
 *   - Medicine stock at facilities
 *   - Medicine availability lookup
 */

const prisma = require('../config/db');
const { successResponse, errorResponse } = require('../utils/responseHelper');
const { createNotification } = require('../utils/notificationService');

// =============================================================================
// CREATE MEDICINE
// =============================================================================

/**
 * POST /api/medicines
 *
 * Creates a medicine in the master medicine list.
 *
 * Body:
 * {
 *   "name": "Amoxicillin",
 *   "strength": "500mg",
 *   "form": "Tablet",
 *   "description": "Antibiotic"
 * }
 */
const createMedicine = async (req, res, next) => {
  try {
    const {
      name,
      strength,
      form,
      description,
    } = req.body;

    if (!name || !name.trim()) {
      return errorResponse(res, 'Medicine name is required', 400);
    }

    const medicine = await prisma.medicine.create({
      data: {
        name: name.trim(),
        strength: strength || null,
        form: form || null,
        description: description || null,
      },
    });

    return successResponse(
      res,
      { medicine },
      'Medicine created successfully',
      201
    );
  } catch (error) {
    next(error);
  }
};

// =============================================================================
// GET ALL MEDICINES
// =============================================================================

/**
 * GET /api/medicines
 */
const getMedicines = async (req, res, next) => {
  try {
    const medicines = await prisma.medicine.findMany({
      orderBy: {
        name: 'asc',
      },
    });

    return successResponse(
      res,
      { medicines },
      'Medicines fetched successfully'
    );
  } catch (error) {
    next(error);
  }
};

// =============================================================================
// GET SINGLE MEDICINE
// =============================================================================

/**
 * GET /api/medicines/:id
 *
 * Returns one medicine together with its facility inventory.
 */
const getMedicine = async (req, res, next) => {
  try {
    const { id } = req.params;

    const medicine = await prisma.medicine.findUnique({
      where: { id },
      include: {
        inventory: {
          include: {
            facility: {
              select: {
                id: true,
                name: true,
                type: true,
                district: true,
                state: true,
                latitude: true,
                longitude: true,
                phone: true,
              },
            },
          },
        },
      },
    });

    if (!medicine) {
      return errorResponse(
        res,
        `Medicine with ID "${id}" not found`,
        404
      );
    }

    return successResponse(
      res,
      { medicine },
      'Medicine fetched successfully'
    );
  } catch (error) {
    next(error);
  }
};

// =============================================================================
// ADD / UPDATE MEDICINE INVENTORY
// =============================================================================

/**
 * POST /api/medicines/inventory
 *
 * Body:
 * {
 *   "medicineId": "...",
 *   "facilityId": "...",
 *   "quantity": 25
 * }
 */
const updateMedicineInventory = async (req, res, next) => {
  try {
    const {
      medicineId,
      facilityId,
      quantity,
    } = req.body;

    const missingFields = [];

    if (!medicineId) missingFields.push('medicineId');
    if (!facilityId) missingFields.push('facilityId');
    if (quantity === undefined || quantity === null) {
      missingFields.push('quantity');
    }

    if (missingFields.length > 0) {
      return errorResponse(
        res,
        `Missing required fields: ${missingFields.join(', ')}`,
        400
      );
    }

    if (!Number.isInteger(quantity) || quantity < 0) {
      return errorResponse(
        res,
        'quantity must be a non-negative integer',
        400
      );
    }

    // Verify medicine
    const medicine = await prisma.medicine.findUnique({
      where: { id: medicineId },
    });

    if (!medicine) {
      return errorResponse(
        res,
        `Medicine with ID "${medicineId}" not found`,
        404
      );
    }

    // Verify facility
    const facility = await prisma.facility.findUnique({
      where: { id: facilityId },
    });

    if (!facility) {
      return errorResponse(
        res,
        `Facility with ID "${facilityId}" not found`,
        404
      );
    }

    // Create or update stock
    const inventory = await prisma.medicineInventory.upsert({
      where: {
        medicineId_facilityId: {
          medicineId,
          facilityId,
        },
      },
      create: {
        medicineId,
        facilityId,
        quantity,
      },
      update: {
        quantity,
      },
      include: {
        medicine: true,
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
    if (inventory.quantity === 0) {
      await createNotification({
        type: 'MEDICINE_UNAVAILABLE',
        priority: 'HIGH',
        title: 'Medicine Unavailable',
        message: `${inventory.medicine.name}${inventory.medicine.strength ? ` ${inventory.medicine.strength}` : ''} is now out of stock at ${inventory.facility.name}.`,
      });
    }


    return successResponse(
      res,
      { inventory },
      'Medicine inventory updated successfully'
    );
  } catch (error) {
    next(error);
  }
};

// =============================================================================
// CHECK MEDICINE AVAILABILITY
// =============================================================================

/**
 * GET /api/medicines/:id/availability
 *
 * Returns facilities where the medicine currently has stock.
 *
 * Optional:
 *   ?district=Cachar
 */
const getMedicineAvailability = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { district } = req.query;

    const medicine = await prisma.medicine.findUnique({
      where: { id },
    });

    if (!medicine) {
      return errorResponse(
        res,
        `Medicine with ID "${id}" not found`,
        404
      );
    }

    const inventory = await prisma.medicineInventory.findMany({
      where: {
        medicineId: id,
        quantity: {
          gt: 0,
        },
        ...(district
          ? {
              facility: {
                district: {
                  equals: district,
                  mode: 'insensitive',
                },
              },
            }
          : {}),
      },
      include: {
        facility: {
          select: {
            id: true,
            name: true,
            type: true,
            district: true,
            state: true,
            latitude: true,
            longitude: true,
            phone: true,
          },
        },
      },
      orderBy: {
        quantity: 'desc',
      },
    });

    return successResponse(
      res,
      {
        medicine: {
          id: medicine.id,
          name: medicine.name,
          strength: medicine.strength,
          form: medicine.form,
        },
        availability: inventory,
      },
      'Medicine availability fetched successfully'
    );
  } catch (error) {
    next(error);
  }
};

// =============================================================================
// EXPORTS
// =============================================================================

module.exports = {
  createMedicine,
  getMedicines,
  getMedicine,
  updateMedicineInventory,
  getMedicineAvailability,
};