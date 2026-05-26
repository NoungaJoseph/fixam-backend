const jwt = require('jsonwebtoken');
const prisma = require('../config/db.config');
const debugLog = (...args) => {
  if (process.env.NODE_ENV !== 'production') console.log(...args);
};

const protect = async (req, res, next) => {
  let token;

  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    try {
      token = req.headers.authorization.split(' ')[1];
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      debugLog('Token decoded:', decoded.id, decoded.role);

      try {
        req.user = await prisma.user.findUnique({
          where: { id: decoded.id },
          include: { wallet: true, providerProfile: true }
        });

        if (!req.user) {
          debugLog('User from token not found in DB:', decoded.id);
          return res.status(401).json({ success: false, message: 'User not found' });
        }

        if (req.user.isBlocked) {
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
  }

  if (!token) {
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

module.exports = { protect, authorize };
