const NodeCache = require('node-cache');

// Standard TTL of 5 minutes (300 seconds) for standard GET routes
const apiCache = new NodeCache({ stdTTL: 300, checkperiod: 60 });

/**
 * Middleware to cache GET requests to reduce database load.
 * @param {number} durationInSeconds - Custom TTL in seconds. Defaults to 300 (5 minutes).
 */
const cacheMiddleware = (durationInSeconds = 300) => {
  return (req, res, next) => {
    // We only cache GET requests
    if (req.method !== 'GET') {
      return next();
    }

    // Construct a unique cache key based on the URL and query params
    // If the route returns user-specific data, we must include the user ID in the cache key
    const isUserSpecific = req.user && req.user.id;
    const cacheKey = isUserSpecific 
      ? `__express__${req.user.id}__${req.originalUrl || req.url}`
      : `__express__${req.originalUrl || req.url}`;

    const cachedBody = apiCache.get(cacheKey);

    if (cachedBody) {
      return res.status(200).json(cachedBody);
    }

    // Intercept res.json to cache the response
    const originalJson = res.json;
    res.json = function (body) {
      // Only cache successful responses
      if (res.statusCode >= 200 && res.statusCode < 300) {
        apiCache.set(cacheKey, body, durationInSeconds);
      }
      return originalJson.call(this, body);
    };

    next();
  };
};

module.exports = cacheMiddleware;
