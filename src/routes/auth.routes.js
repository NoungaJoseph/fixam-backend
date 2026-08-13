const express = require('express');
const router = express.Router();
const authController = require('../controllers/auth.controller');
const { authLimiter, otpLimiter } = require('../middlewares/rateLimit.middleware');
const { protect } = require('../middlewares/auth.middleware');
const validate = require('../middlewares/validate.middleware');
const { registerSchema, loginSchema, forgotPasswordSchema } = require('../validations/auth.validation');

router.use(authLimiter);

router.post('/register', validate(registerSchema), authController.register);
router.post('/login', validate(loginSchema), authController.login);
// OTP endpoints use the strict limiter (5 attempts per 15 min) to prevent brute-force
router.post('/request-otp', otpLimiter, authController.requestOTP);
router.post('/verify-otp', otpLimiter, authController.verifyOTP);
router.post('/verify-email-otp', otpLimiter, authController.verifyEmailOTP);
router.post('/logout', authController.logout);
router.get('/me', protect, authController.me);

router.post('/forgot-password', validate(forgotPasswordSchema), authController.forgotPassword);
router.post('/verify-reset-otp', otpLimiter, authController.verifyResetOtp);
router.post('/reset-password', authController.resetPassword);

// 2FA Routes
router.post('/2fa/send-otp', protect, authController.enableTwoFactorOTP);
router.post('/2fa/enable', protect, otpLimiter, authController.enableTwoFactor);
router.post('/2fa/disable', protect, authController.disableTwoFactor);
router.post('/2fa/verify-login', otpLimiter, authController.verifyLoginTwoFactor);
router.post('/2fa/resend-login-otp', otpLimiter, authController.resendLoginOTP);

module.exports = router;
