const express = require('express');
const router = express.Router();
const userController = require('../controllers/user.controller');
const { protect } = require('../middlewares/auth.middleware');

router.get('/me', protect, userController.getMe);
router.put('/profile', protect, userController.updateProfile);
router.post('/feedback', protect, userController.submitFeedback);
router.post('/reports', protect, userController.reportUser);

module.exports = router;
