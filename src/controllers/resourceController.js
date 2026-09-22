const prisma = require('../config/db');
const { successResponse, errorResponse } = require('../utils/responseHelper');

const calculateDistanceKm = (lat1, lon1, lat2, lon2) => {
  const toRadians = (degrees) => (degrees * Math.PI) / 180;

  const earthRadiusKm = 6371;

  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.sin(dLon / 2) ** 2;

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return earthRadiusKm * c;
};

const getResourceAvailability = async (req, res, next) => {
  try {
    const {
      medicineIds,
      diagnosticTestIds,
      serviceIds,
      district,
      latitude,
      longitude,
    } = req.query;

    const medicineIdList = medicineIds
      ? medicineIds.split(',').map((id) => id.trim()).filter(Boolean)
      : [];

    const diagnosticTestIdList = diagnosticTestIds
      ? diagnosticTestIds.split(',').map((id) => id.trim()).filter(Boolean)
      : [];

    const serviceIdList = serviceIds
      ? serviceIds.split(',').map((id) => id.trim()).filter(Boolean)
      : [];

    const patientLatitude =
      latitude !== undefined ? Number(latitude) : null;

    const patientLongitude =
      longitude !== undefined ? Number(longitude) : null;

    if (
      (latitude !== undefined &&
        !Number.isFinite(patientLatitude)) ||
      (longitude !== undefined &&
        !Number.isFinite(patientLongitude))
    ) {
      return errorResponse(
        res,
        'latitude and longitude must be valid numbers',
        400
      );
    }

    if (
      (patientLatitude === null) !==
      (patientLongitude === null)
    ) {
      return errorResponse(
        res,
        'Both latitude and longitude are required together',
        400
      );
    }

    if (
      medicineIdList.length === 0 &&
      diagnosticTestIdList.length === 0 &&
      serviceIdList.length === 0
    ) {
      return errorResponse(
        res,
        'Provide at least one medicineIds, diagnosticTestIds, or serviceIds',
        400
      );
    }

    const [facilities, medicines, diagnosticTests, services] =
      await Promise.all([
        prisma.facility.findMany({
          where: district
            ? {
                district: {
                  equals: district,
                  mode: 'insensitive',
                },
              }
            : {},
          select: {
            id: true,
            name: true,
            type: true,
            district: true,
            state: true,
            phone: true,
            latitude: true,
            longitude: true,

            medicineInventory: {
              where: {
                medicineId: {
                  in: medicineIdList,
                },
              },
              select: {
                medicineId: true,
                quantity: true,
              },
            },

            diagnosticAvailability: {
              where: {
                testId: {
                  in: diagnosticTestIdList,
                },
              },
              select: {
                testId: true,
                available: true,
              },
            },

            serviceAvailability: {
              where: {
                serviceId: {
                  in: serviceIdList,
                },
              },
              select: {
                serviceId: true,
                available: true,
                lastUpdated: true,
              },
            },
          },
          orderBy: {
            name: 'asc',
          },
        }),

        prisma.medicine.findMany({
          where: {
            id: {
              in: medicineIdList,
            },
          },
          select: {
            id: true,
            name: true,
            strength: true,
            form: true,
          },
        }),

        prisma.diagnosticTest.findMany({
          where: {
            id: {
              in: diagnosticTestIdList,
            },
          },
          select: {
            id: true,
            name: true,
            category: true,
          },
        }),

        prisma.service.findMany({
          where: {
            id: {
              in: serviceIdList,
            },
          },
          select: {
            id: true,
            name: true,
            category: true,
          },
        }),
      ]);

    const result = facilities.map((facility) => {
      const distanceKm =
        patientLatitude !== null &&
        patientLongitude !== null &&
        facility.latitude !== null &&
        facility.longitude !== null
          ? calculateDistanceKm(
              patientLatitude,
              patientLongitude,
              facility.latitude,
              facility.longitude
            )
          : null;

      return {
        facility: {
          id: facility.id,
          name: facility.name,
          type: facility.type,
          district: facility.district,
          state: facility.state,
          phone: facility.phone,
          latitude: facility.latitude,
          longitude: facility.longitude,
          distanceKm:
            distanceKm !== null
              ? Number(distanceKm.toFixed(2))
              : null,
        },

        medicines: medicineIdList.map((medicineId) => {
          const medicine = medicines.find(
            (item) => item.id === medicineId
          );

          const inventory = facility.medicineInventory.find(
            (item) => item.medicineId === medicineId
          );

          return {
            id: medicineId,
            name: medicine?.name || null,
            strength: medicine?.strength || null,
            form: medicine?.form || null,
            available: Boolean(
              inventory && inventory.quantity > 0
            ),
            quantity: inventory?.quantity || 0,
          };
        }),

        diagnostics: diagnosticTestIdList.map((testId) => {
          const test = diagnosticTests.find(
            (item) => item.id === testId
          );

          const availability =
            facility.diagnosticAvailability.find(
              (item) => item.testId === testId
            );

          return {
            id: testId,
            name: test?.name || null,
            category: test?.category || null,
            available: Boolean(
              availability && availability.available
            ),
          };
        }),

        services: serviceIdList.map((serviceId) => {
          const service = services.find(
            (item) => item.id === serviceId
          );

          const availability = facility.serviceAvailability.find(
            (item) => item.serviceId === serviceId
          );

          return {
            id: serviceId,
            name: service?.name || null,
            category: service?.category || null,
            available: Boolean(
              availability && availability.available
            ),
            lastUpdated: availability?.lastUpdated || null,
          };
        }),
      };
    });

    return successResponse(
      res,
      {
        facilities: result,
      },
      'Resource availability fetched successfully'
    );
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getResourceAvailability,
};
