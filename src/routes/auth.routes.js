const express = require('express');
const router = express.Router();
const authController = require('../controllers/auth.controller');
const { authLimiter } = require('../middlewares/rateLimit.middleware');
const { protect } = require('../middlewares/auth.middleware');
const validate = require('../middlewares/validate.middleware');
const { registerSchema, loginSchema, forgotPasswordSchema } = require('../validations/auth.validation');

router.use(authLimiter);

router.post('/register', validate(registerSchema), authController.register);
router.post('/login', validate(loginSchema), authController.login);
router.post('/request-otp', authController.requestOTP);
router.post('/verify-otp', authController.verifyOTP);
router.post('/verify-email-otp', authController.verifyEmailOTP);
router.post('/logout', authController.logout);
router.get('/me', protect, authController.me);

router.post('/forgot-password', validate(forgotPasswordSchema), authController.forgotPassword);
router.post('/verify-reset-otp', authController.verifyResetOtp);
router.post('/reset-password', authController.resetPassword);

// 2FA Routes
router.post('/2fa/send-otp', protect, authController.enableTwoFactorOTP);
router.post('/2fa/enable', protect, authController.enableTwoFactor);
router.post('/2fa/disable', protect, authController.disableTwoFactor);
router.post('/2fa/verify-login', authController.verifyLoginTwoFactor);
router.post('/2fa/resend-login-otp', authController.resendLoginOTP);

module.exports = router;
