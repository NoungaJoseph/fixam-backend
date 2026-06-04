const express = require('express');
const router = express.Router();
const notificationController = require('../controllers/notification.controller');
const { protect, authorize } = require('../middlewares/auth.middleware');
const adminOnly = authorize('ADMIN');

router.use(protect);

router.get('/', notificationController.getNotifications);
router.put('/:id/read', notificationController.markAsRead);
router.patch('/:id/read', notificationController.markAsRead);
router.put('/:id/archive', notificationController.archiveNotification);
router.delete('/clear', notificationController.clearNotifications);
router.post('/test-push', protect, adminOnly, notificationController.testPush);

module.exports = router;
