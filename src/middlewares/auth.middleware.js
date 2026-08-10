const jwt = require('jsonwebtoken');
const prisma = require('../config/prisma');
const debugLog = (...args) => {
  if (process.env.NODE_ENV !== 'production') console.log(...args);
};

// Simple in-memory cache for user sessions
const userCache = new Map();
const CACHE_TTL_MS = 30 * 1000; // 30 seconds

const protect = async (req, res, next) => {
  let token;

  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    token = req.headers.authorization.split(' ')[1];
  } else if (req.cookies) {
    token = req.cookies.jwt || req.cookies.token;
  }

  if (token) {
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const userId = decoded.id || decoded.userId;
      debugLog('Token decoded:', userId, decoded.role);

      try {
        const now = Date.now();
        const cached = userCache.get(userId);

        if (cached && (now - cached.timestamp < CACHE_TTL_MS)) {
          req.user = cached.user;
        } else {
          req.user = await prisma.user.findUnique({
            where: { id: userId },
            include: { wallet: true, providerProfile: true }
          });

          if (req.user) {
            userCache.set(userId, { user: req.user, timestamp: now });
          }
        }

        if (!req.user) {
          debugLog('User from token not found in DB:', userId);
          userCache.delete(userId);
          return res.status(401).json({ success: false, message: 'User not found' });
        }

        if (req.user.isBlocked) {
          userCache.delete(userId);
          return res.status(403).json({
            success: false,
            message: req.user.blockedReason || 'This account has been blocked. Please contact Fixam support.'
          });
        }

        next();
      } catch (dbError) {
        console.error('Database error during user lookup:', dbError.message);
        return res.status(503).json({ success: false, message: 'Service temporarily unavailable' });
      }
    } catch (error) {
      console.error('Token verification failed:', error.message);
      return res.status(401).json({ success: false, message: 'Not authorized, token failed' });
    }
  } else {
    return res.status(401).json({ success: false, message: 'Not authorized, no token' });
  }
};

const authorize = (...roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: `Role ${req.user.role} is not authorized to access this route`
      });
    }
    next();
  };
};

const clearUserCache = (userId) => {
  userCache.delete(userId);
  debugLog('Cleared session cache for user:', userId);
};

module.exports = { protect, authorize, clearUserCache };
