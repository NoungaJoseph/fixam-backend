const rateLimit = require('express-rate-limit');

// Login and registration are rate-limited at the Cloudflare edge. Exempt only
// those exact endpoints here so shared mobile-carrier IPs are not limited twice.
const EDGE_RATE_LIMITED_AUTH_PATHS = new Set([
  '/api/auth/login',
  '/api/auth/register',
  '/api/v1/web-auth/login',
  '/api/v1/web-auth/signup',
]);

const isEdgeRateLimitedAuthRequest = (req) => {
  const path = String(req.originalUrl || req.url || '').split('?')[0].replace(/\/+$/, '');
  return EDGE_RATE_LIMITED_AUTH_PATHS.has(path);
};

// General API Rate Limiter
// 300 requests per 15 minutes per IP (reduced from 2000 to limit data scraping)
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  skip: isEdgeRateLimitedAuthRequest,
  message: {
    success: false,
    message: 'Too many requests from this IP, please try again after 15 minutes.'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Strict Auth Rate Limiter
// 100 requests per 15 minutes per IP
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: {
    success: false,
    message: 'Too many authentication attempts, please try again after 15 minutes.'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// OTP-Specific Strict Limiter
// 5 requests per 15 minutes per IP to prevent OTP brute-force
const otpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: {
    success: false,
    message: 'Too many OTP attempts, please try again after 15 minutes.'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Broadcast/System Level Limiter
// 500 requests per 15 minutes (for internal/trusted paths)
const lenientLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 500,
  message: {
    success: false,
    message: 'Too many requests, please slow down.'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

module.exports = {
  apiLimiter,
  authLimiter,
  otpLimiter,
  lenientLimiter,
  isEdgeRateLimitedAuthRequest,
};
