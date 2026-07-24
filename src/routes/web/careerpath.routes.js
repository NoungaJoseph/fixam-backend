const express = require('express');
const router = express.Router();
const careerpathController = require('../../controllers/web/careerpath.controller');

const { protect } = require('../../middlewares/auth.middleware');

router.post('/onboard', protect, careerpathController.onboardSkills);
router.post('/enroll', protect, careerpathController.enroll);
router.post('/module/complete', protect, careerpathController.completeModuleWithExam);
router.post('/certificate', protect, careerpathController.generateCertificate);
router.get('/dashboard', protect, careerpathController.getUserDashboard);
router.post('/bookmark/:categoryKey', protect, careerpathController.toggleBookmark);

module.exports = router;
