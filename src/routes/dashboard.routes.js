const express = require('express');
const router = express.Router();
const { getDashboardData } = require('../controllers/dashboard.controller');
const { protect } = require('../middlewares/auth.middleware');
const cacheMiddleware = require('../middlewares/cache.middleware');

// Cache dashboard data for 60 seconds to significantly reduce DB load
router.get('/', protect, cacheMiddleware(60), getDashboardData);

module.exports = router;
