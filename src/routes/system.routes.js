const express = require('express');
const router = express.Router();
const { getSystemStatus } = require('../controllers/system.controller');

// Public — no auth required. App calls this before login.
router.get('/status', getSystemStatus);

module.exports = router;
