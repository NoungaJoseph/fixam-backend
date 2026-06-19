const errorHandler = (err, req, res, next) => {
  const isDev = process.env.NODE_ENV !== 'production'
  
  // Always log the full error
  console.error('[Error]', {
    message: err.message,
    path: req.path,
    method: req.method,
    userId: req.user?.id || 'unauthenticated',
    timestamp: new Date().toISOString(),
    ...(isDev && { stack: err.stack })
  })
  
  // Prisma: duplicate record
  if (err.code === 'P2002') {
    return res.status(409).json({
      success: false,
      message: 'This record already exists'
    })
  }
  
  // Prisma: record not found
  if (err.code === 'P2025') {
    return res.status(404).json({
      success: false,
      message: 'Record not found'
    })
  }
  
  // Prisma: missing required field
  if (err.code === 'P2011' || err.code === 'P2012') {
    return res.status(400).json({
      success: false,
      message: 'Required field is missing'
    })
  }
  
  // JWT errors
  if (err.name === 'JsonWebTokenError') {
    return res.status(401).json({
      success: false,
      message: 'Invalid token. Please log in again.'
    })
  }
  
  if (err.name === 'TokenExpiredError') {
    return res.status(401).json({
      success: false,
      message: 'Session expired. Please log in again.'
    })
  }
  
  // Validation errors
  if (err.name === 'ValidationError') {
    return res.status(400).json({
      success: false,
      message: err.message
    })
  }

  // Zod Validation errors
  if (err.name === 'ZodError') {
    return res.status(400).json({
      success: false,
      message: err.errors[0]?.message || 'Validation failed',
      errors: err.errors
    })
  }
  
  // Default error response
  const statusCode = err.statusCode || err.status || 500
  return res.status(statusCode).json({
    success: false,
    message: isDev 
      ? err.message 
      : statusCode === 500 
        ? 'Something went wrong. Please try again.'
        : err.message
  })
}

module.exports = { errorHandler };
