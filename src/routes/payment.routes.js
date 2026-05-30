const express = require('express')
const router = express.Router()
const { protect } = require('../middlewares/auth.middleware')
const {
  topup,
  checkPaymentStatus,
  handleRedirect
} = require('../controllers/payment.controller')

router.post('/topup', protect, topup)
router.get('/status/:reference', protect, checkPaymentStatus)
router.get('/redirect', handleRedirect)

module.exports = router
