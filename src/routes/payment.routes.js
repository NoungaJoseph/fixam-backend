const express = require('express')
const router = express.Router()
const validate = require('../middlewares/validate.middleware')
const { topupSchema } = require('../validations/payment.validation')
const { protect } = require('../middlewares/auth.middleware')
const idempotencyMiddleware = require('../middlewares/idempotency.middleware')
const {
  topup,
  checkPaymentStatus,
  handleRedirect,
  koraWebhook,
} = require('../controllers/payment.controller')

router.post('/topup', protect, validate(topupSchema), idempotencyMiddleware, topup)
router.get('/status/:reference', protect, checkPaymentStatus)
router.get('/redirect', handleRedirect)
router.post('/webhook/kora', koraWebhook)

module.exports = router
