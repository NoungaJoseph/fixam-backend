const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const walletController = require('../controllers/wallet.controller');
const { protect } = require('../middlewares/auth.middleware');

const receiptDir = path.join('uploads', 'receipts');
fs.mkdirSync(receiptDir, { recursive: true });

const receiptStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, receiptDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || '') || '.jpg';
    cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`);
  }
});

const uploadReceipt = multer({
  storage: receiptStorage,
  limits: { fileSize: 15 * 1024 * 1024 }
});

router.get('/balance', protect, walletController.getBalance);
router.post('/topup', protect, walletController.topUpRequest);
router.post('/mobile-money/initiate', protect, walletController.initiateMobileMoneyPurchase);
router.get('/mobile-money/:paymentId/status', protect, walletController.getPaymentStatus);
router.post('/mobile-money/webhook/:provider', walletController.mobileMoneyWebhook);
router.post('/request-coins', protect, uploadReceipt.single('receipt'), walletController.requestCoinsWithReceipt);
router.get('/transactions', protect, walletController.getCoinTransactions);

module.exports = router;
