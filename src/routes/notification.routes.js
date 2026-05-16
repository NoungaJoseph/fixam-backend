const express = require('express');
const router = express.Router();
const notificationController = require('../controllers/notification.controller');
const { protect } = require('../middlewares/auth.middleware');

router.use(protect);

router.get('/', notificationController.getNotifications);
router.put('/:id/read', notificationController.markAsRead);
router.put('/:id/archive', notificationController.archiveNotification);
router.delete('/clear', notificationController.clearNotifications);

module.exports = router;
