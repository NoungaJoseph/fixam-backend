const express = require('express');
const router = express.Router();
const { getSystemStatus, getPlatformPublicStats } = require('../controllers/system.controller');

// Public — no auth required. App calls this before login.
router.get('/status', getSystemStatus);
router.get('/public-stats', getPlatformPublicStats);
router.get('/stats', getPlatformPublicStats);

module.exports = router;
