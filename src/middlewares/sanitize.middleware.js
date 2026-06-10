const xss = require('xss');

/**
 * Recursively sanitize strings in an object or array to prevent XSS attacks.
 * @param {any} data The data to sanitize
 * @returns {any} The sanitized data
 */
const clean = (data) => {
  if (typeof data === 'string') {
    return xss(data);
  }
  
  if (Array.isArray(data)) {
    return data.map(item => clean(item));
  }
  
  if (data !== null && typeof data === 'object') {
    const cleanedObj = {};
    for (const key in data) {
      if (Object.prototype.hasOwnProperty.call(data, key)) {
        cleanedObj[key] = clean(data[key]);
      }
    }
    return cleanedObj;
  }
  
  return data;
};

/**
 * Express middleware to sanitize incoming user inputs.
 */
const sanitizeMiddleware = (req, res, next) => {
  if (req.body) req.body = clean(req.body);
  if (req.query) req.query = clean(req.query);
  if (req.params) req.params = clean(req.params);
  next();
};

module.exports = sanitizeMiddleware;
