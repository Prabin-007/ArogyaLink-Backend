const express = require('express');
const { authenticate, authorize } = require('../middleware/auth');

const {
  createNotification,
  getNotifications,
  markNotificationRead,
} = require('../controllers/notificationController');

const router = express.Router();

router.use(authenticate);

router.post(
  '/',
  authorize('SYSTEM_ADMIN', 'HOSPITAL_ADMIN', 'DOCTOR', 'SPECIALIST'),
  createNotification
);

router.get('/', getNotifications);

router.patch('/:id/read', markNotificationRead);

module.exports = router;