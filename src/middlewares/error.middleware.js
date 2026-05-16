const errorHandler = (err, req, res, next) => {
  console.error('[Error Middleware]', {
    message: err.message,
    code: err.code,
    status: err.statusCode || 500,
    path: req.path,
    method: req.method,
    userId: req.user?.id,
    stack: err.stack
  });

  const statusCode = err.statusCode || 500;
  const message = err.message || 'Internal Server Error';

  res.status(statusCode).json({
    success: false,
    message,
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
  });
};

module.exports = { errorHandler };
