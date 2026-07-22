const express = require('express');
const router = express.Router();
const analyticsController = require('../../controllers/web/analytics.controller');

router.post('/track', analyticsController.trackPageView);
router.get('/stats', analyticsController.getStats);

module.exports = router;
