const prisma = require('../config/db');
const { successResponse, errorResponse } = require('../utils/responseHelper');

const createNotification = async (req, res, next) => {
  try {
    const {
      userId,
      patientId,
      type,
      priority,
      title,
      message,
    } = req.body;

    if (!title || !message || !type) {
      return errorResponse(
        res,
        'Missing required fields: type, title, message',
        400
      );
    }

    const notification = await prisma.notification.create({
      data: {
        userId: userId || null,
        patientId: patientId || null,
        type,
        priority: priority || 'MEDIUM',
        title,
        message,
      },
    });

    return successResponse(
      res,
      notification,
      'Notification created successfully',
      201
    );
  } catch (error) {
    next(error);
  }
};

const getNotifications = async (req, res, next) => {
  try {
    const { userId, patientId, unread } = req.query;

    const where = {};

    if (userId) {
      where.userId = userId;
    }

    if (patientId) {
      where.patientId = patientId;
    }

    if (unread === 'true') {
      where.readAt = null;
    }

    const notifications = await prisma.notification.findMany({
      where,
      orderBy: {
        createdAt: 'desc',
      },
    });

    return successResponse(
      res,
      { notifications },
      'Notifications fetched successfully'
    );
  } catch (error) {
    next(error);
  }
};

const markNotificationRead = async (req, res, next) => {
  try {
    const { id } = req.params;

    const notification = await prisma.notification.update({
      where: { id },
      data: {
        readAt: new Date(),
      },
    });

    return successResponse(
      res,
      notification,
      'Notification marked as read'
    );
  } catch (error) {
    next(error);
  }
};

module.exports = {
  createNotification,
  getNotifications,
  markNotificationRead,
};