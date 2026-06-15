const express = require('express');
const router = express.Router();
const userController = require('../controllers/user.controller');
const { protect } = require('../middlewares/auth.middleware');

router.get('/me', protect, userController.getMe);
router.put('/profile', protect, userController.updateProfile);
router.post('/change-password', protect, userController.changePassword);
router.post('/feedback', protect, userController.submitFeedback);
router.post('/reports', protect, userController.reportUser);
router.put('/fcm-token', protect, userController.updateFcmToken);
router.delete('/me', protect, userController.deleteAccount);
router.get('/referral-stats', protect, userController.getReferralStats);

module.exports = router;
