const logger = require('../utils/logger');

class AppError extends Error {
  constructor(message, statusCode, isOperational = true) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = isOperational;
    this.status = `${statusCode}`.startsWith('4') ? 'fail' : 'error';
    
    Error.captureStackTrace(this, this.constructor);
  }
}

const errorHandler = (err, req, res, next) => {
  let error = { ...err };
  error.message = err.message;

  // Log error
  logger.structuredError(err, {
    url: req.originalUrl,
    method: req.method,
    ip: req.ip,
    userAgent: req.get('User-Agent'),
    userId: req.user?.id,
    correlationId: req.correlationId
  });

  // Mongoose bad ObjectId
  if (err.name === 'CastError') {
    const message = 'Resource not found';
    error = new AppError(message, 404);
  }

  // Mongoose duplicate key
  if (err.code === 11000) {
    const message = 'Duplicate field value entered';
    error = new AppError(message, 400);
  }

  // Mongoose validation error
  if (err.name === 'ValidationError') {
    const message = Object.values(err.errors).map(val => val.message).join(', ');
    error = new AppError(message, 400);
  }

  // JWT errors
  if (err.name === 'JsonWebTokenError') {
    const message = 'Invalid token';
    error = new AppError(message, 401);
  }

  if (err.name === 'TokenExpiredError') {
    const message = 'Token expired';
    error = new AppError(message, 401);
  }

  // Prisma errors
  if (err.code === 'P2002') {
    const message = 'Duplicate entry';
    error = new AppError(message, 400);
  }

  if (err.code === 'P2025') {
    const message = 'Record not found';
    error = new AppError(message, 404);
  }

  if (err.code === 'P2003') {
    const message = 'Foreign key constraint failed';
    error = new AppError(message, 400);
  }

  // Slack API errors
  if (err.code === 'slack_webapi_platform_error') {
    const message = `Slack API error: ${err.data?.error || err.message}`;
    error = new AppError(message, 400);
  }

  // Azure AD errors
  if (err.name === 'ClientAuthError') {
    const message = 'Authentication failed';
    error = new AppError(message, 401);
  }

  // OpenAI API errors
  if (err.type === 'openai_error') {
    const message = `OpenAI API error: ${err.message}`;
    error = new AppError(message, 500);
  }

  // Rate limiting errors
  if (err.type === 'rate_limit') {
    const message = 'Too many requests, please try again later';
    error = new AppError(message, 429);
  }

  // Network errors
  if (err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND') {
    const message = 'Service temporarily unavailable';
    error = new AppError(message, 503);
  }

  // Timeout errors
  if (err.code === 'ETIMEDOUT') {
    const message = 'Request timeout';
    error = new AppError(message, 408);
  }

  // File upload errors
  if (err.code === 'LIMIT_FILE_SIZE') {
    const message = 'File too large';
    error = new AppError(message, 400);
  }

  if (err.code === 'LIMIT_UNEXPECTED_FILE') {
    const message = 'Unexpected file field';
    error = new AppError(message, 400);
  }

  // Default error
  if (!error.statusCode) {
    error.statusCode = 500;
    error.message = 'Internal server error';
  }

  // Determine if we should send detailed error information
  const isDevelopment = process.env.NODE_ENV === 'development';
  const isProduction = process.env.NODE_ENV === 'production';

  let errorResponse = {
    success: false,
    error: {
      message: error.message,
      statusCode: error.statusCode,
      status: error.status,
      correlationId: req.correlationId || 'unknown'
    }
  };

  // Add stack trace in development
  if (isDevelopment && error.stack) {
    errorResponse.error.stack = error.stack;
  }

  // Add additional details for specific error types
  if (error.details) {
    errorResponse.error.details = error.details;
  }

  // Add validation errors if present
  if (error.validationErrors) {
    errorResponse.error.validationErrors = error.validationErrors;
  }

  // Add retry information for certain errors
  if (error.statusCode === 429 || error.statusCode === 503) {
    errorResponse.error.retryAfter = error.retryAfter || 60;
  }

  // Set appropriate headers
  res.status(error.statusCode);

  // Set retry-after header for rate limiting
  if (error.statusCode === 429) {
    res.set('Retry-After', errorResponse.error.retryAfter);
  }

  // Set cache control headers for error responses
  res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');

  // Send error response
  res.json(errorResponse);

  // Log additional information for non-operational errors
  if (!error.isOperational) {
    logger.error('Non-operational error occurred', {
      error: error.message,
      stack: error.stack,
      url: req.originalUrl,
      method: req.method,
      userId: req.user?.id,
      correlationId: req.correlationId
    });
  }
};

// Async error wrapper
const asyncHandler = (fn) => {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};

// Validation error handler
const handleValidationError = (err) => {
  const errors = Object.values(err.errors).map(el => el.message);
  const message = `Invalid input data. ${errors.join('. ')}`;
  return new AppError(message, 400);
};

// JWT error handler
const handleJWTError = () => {
  return new AppError('Invalid token. Please log in again!', 401);
};

const handleJWTExpiredError = () => {
  return new AppError('Your token has expired! Please log in again.', 401);
};

// Cast error handler
const handleCastErrorDB = (err) => {
  const message = `Invalid ${err.path}: ${err.value}`;
  return new AppError(message, 400);
};

// Duplicate fields error handler
const handleDuplicateFieldsDB = (err) => {
  const value = err.errmsg.match(/(["'])(\\?.)*?\1/)[0];
  const message = `Duplicate field value: ${value}. Please use another value!`;
  return new AppError(message, 400);
};

// Send error in development
const sendErrorDev = (err, req, res) => {
  // API
  if (req.originalUrl.startsWith('/api')) {
    return res.status(err.statusCode).json({
      status: err.status,
      error: err,
      message: err.message,
      stack: err.stack
    });
  }
  // RENDERED WEBSITE
  logger.error('ERROR 💥', err);
  return res.status(err.statusCode).render('error', {
    title: 'Something went wrong!',
    msg: err.message
  });
};

// Send error in production
const sendErrorProd = (err, req, res) => {
  // API
  if (req.originalUrl.startsWith('/api')) {
    // A) Operational, trusted error: send message to client
    if (err.isOperational) {
      return res.status(err.statusCode).json({
        status: err.status,
        message: err.message
      });
    }
    // B) Programming or other unknown error: don't leak error details
    logger.error('ERROR 💥', err);
    return res.status(500).json({
      status: 'error',
      message: 'Something went very wrong!'
    });
  }

  // RENDERED WEBSITE
  // A) Operational, trusted error: send message to client
  if (err.isOperational) {
    return res.status(err.statusCode).render('error', {
      title: 'Something went wrong!',
      msg: err.message
    });
  }
  // B) Programming or other unknown error: don't leak error details
  logger.error('ERROR 💥', err);
  return res.status(err.statusCode).render('error', {
    title: 'Something went wrong!',
    msg: 'Please try again later.'
  });
};

module.exports = {
  AppError,
  errorHandler,
  asyncHandler,
  handleValidationError,
  handleJWTError,
  handleJWTExpiredError,
  handleCastErrorDB,
  handleDuplicateFieldsDB,
  sendErrorDev,
  sendErrorProd
}; 