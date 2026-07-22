const express = require('express');
const router = express.Router();
const careerpathController = require('../../controllers/web/careerpath.controller');

// Need a middleware to verify JWT from cookies/headers, stubbing for now.
const requireAuth = (req, res, next) => {
  // auth stub
  req.user = { userId: "stub-id" }; 
  next();
};

router.post('/onboard', requireAuth, careerpathController.onboardSkills);
router.post('/enroll', requireAuth, careerpathController.enroll);
router.post('/module/complete', requireAuth, careerpathController.completeModuleWithExam);
router.post('/certificate', requireAuth, careerpathController.generateCertificate);
router.get('/dashboard', requireAuth, careerpathController.getUserDashboard);

module.exports = router;
