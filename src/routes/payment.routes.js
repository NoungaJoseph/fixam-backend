const express = require('express');
const router = express.Router();
const paymentController = require('../controllers/payment.controller');
const { protect } = require('../middlewares/auth.middleware');

// POST /api/payments/topup — authenticated user initiates mobile money top-up
router.post('/topup', protect, paymentController.topup);

// POST /api/payments/webhook/kora — public webhook from Kora Pay (no auth)
// NOTE: express.raw() for this route is mounted in app.js BEFORE express.json()
router.post('/webhook/kora', paymentController.koraWebhook);

// GET /api/payments/history — authenticated user payment history
router.get('/history', protect, paymentController.getHistory);

// GET /api/payments/:paymentId/status — poll individual payment status
router.get('/:paymentId/status', protect, paymentController.getStatus);

module.exports = router;
