const express = require('express');
const router = express.Router();
const sportsController = require('../controllers/sports.controller');
const { apiLimiter } = require('../middlewares/rateLimit.middleware');

// GET /api/sports/ticker - Returns the formatted sports ticker data
router.get('/ticker', apiLimiter, sportsController.getTickerData);

module.exports = router;
