const NodeCache = require('node-cache');

// Standard TTL of 24 hours for idempotency keys
const idempotencyCache = new NodeCache({ stdTTL: 86400, checkperiod: 120 });

/**
 * Middleware to ensure a request is idempotent.
 * Clients should send an 'Idempotency-Key' header (usually a UUID) for POST/PUT requests.
 * 
 * If a request with the same key is seen again:
 * 1. If it's currently processing -> returns 409 Conflict.
 * 2. If it was already completed -> returns the cached response.
 * 3. If it's new -> processes it and caches the response.
 */
const idempotencyMiddleware = (req, res, next) => {
  const idempotencyKey = req.header('Idempotency-Key');

  // If no key is provided, just proceed (or we could enforce it by returning 400)
  // For backwards compatibility, we'll allow requests without it for now.
  if (!idempotencyKey) {
    return next();
  }

  const cachedData = idempotencyCache.get(idempotencyKey);

  if (cachedData) {
    if (cachedData.status === 'PROCESSING') {
      return res.status(409).json({
        success: false,
        message: 'A request with this Idempotency-Key is currently being processed. Please wait.',
      });
    }

    // Return the cached completed response
    return res.status(cachedData.statusCode).json(cachedData.body);
  }

  // Mark as processing
  idempotencyCache.set(idempotencyKey, { status: 'PROCESSING' });

  // Intercept res.json to cache the final response
  const originalJson = res.json;
  res.json = function (body) {
    // Cache the completed response
    idempotencyCache.set(idempotencyKey, {
      status: 'COMPLETED',
      statusCode: res.statusCode,
      body: body,
    });
    
    // Call the original res.json
    return originalJson.call(this, body);
  };

  next();
};

module.exports = idempotencyMiddleware;
