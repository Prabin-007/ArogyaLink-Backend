const prisma = require('../config/db');

/**
 * Create a notification for a user and/or patient.
 *
 * This is a reusable service so other modules can create
 * notifications without directly handling Prisma logic.
 */
const createNotification = async ({
  userId = null,
  patientId = null,
  type,
  priority = 'MEDIUM',
  title,
  message,
}) => {
  if (!type || !title || !message) {
    throw new Error('Notification type, title and message are required');
  }

  const notification = await prisma.notification.create({
    data: {
      userId,
      patientId,
      type,
      priority,
      title,
      message,
    },
  });

  return notification;
};

module.exports = {
  createNotification,
};
