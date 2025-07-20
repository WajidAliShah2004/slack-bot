const logger = require('../utils/logger');
const { v4: uuidv4 } = require('uuid');

const requestLogger = (req, res, next) => {
  // Generate correlation ID if not present
  if (!req.correlationId) {
    req.correlationId = req.headers['x-correlation-id'] || uuidv4();
  }

  // Add correlation ID to response headers
  res.setHeader('X-Correlation-ID', req.correlationId);

  // Capture start time
  const startTime = Date.now();

  // Log request start
  logger.api(
    req.method,
    req.originalUrl,
    null, // Status code will be logged when response finishes
    0, // Duration will be calculated when response finishes
    {
      correlationId: req.correlationId,
      ip: req.ip || req.connection.remoteAddress,
      userAgent: req.get('User-Agent'),
      userId: req.user?.id,
      requestId: req.correlationId,
      timestamp: new Date().toISOString()
    }
  );

  // Log request details in debug mode
  if (process.env.NODE_ENV === 'development') {
    logger.debug('Request details', {
      method: req.method,
      url: req.originalUrl,
      headers: {
        'content-type': req.get('Content-Type'),
        'authorization': req.get('Authorization') ? '[REDACTED]' : undefined,
        'user-agent': req.get('User-Agent'),
        'x-forwarded-for': req.get('X-Forwarded-For'),
        'x-real-ip': req.get('X-Real-IP')
      },
      query: req.query,
      body: req.method !== 'GET' ? '[REDACTED]' : undefined,
      correlationId: req.correlationId
    });
  }

  // Override res.end to capture response details
  const originalEnd = res.end;
  res.end = function(chunk, encoding) {
    const duration = Date.now() - startTime;
    const statusCode = res.statusCode;

    // Log response
    logger.api(
      req.method,
      req.originalUrl,
      statusCode,
      duration,
      {
        correlationId: req.correlationId,
        ip: req.ip || req.connection.remoteAddress,
        userAgent: req.get('User-Agent'),
        userId: req.user?.id,
        responseSize: chunk ? chunk.length : 0,
        timestamp: new Date().toISOString()
      }
    );

    // Log slow requests
    if (duration > 1000) {
      logger.warn('Slow request detected', {
        method: req.method,
        url: req.originalUrl,
        duration,
        statusCode,
        correlationId: req.correlationId,
        userId: req.user?.id
      });
    }

    // Log errors
    if (statusCode >= 400) {
      logger.error('Request error', {
        method: req.method,
        url: req.originalUrl,
        statusCode,
        duration,
        correlationId: req.correlationId,
        userId: req.user?.id,
        error: statusCode >= 500 ? 'Server Error' : 'Client Error'
      });
    }

    // Log successful requests in debug mode
    if (process.env.NODE_ENV === 'development' && statusCode < 400) {
      logger.debug('Request completed successfully', {
        method: req.method,
        url: req.originalUrl,
        statusCode,
        duration,
        correlationId: req.correlationId
      });
    }

    // Call original end method
    originalEnd.call(this, chunk, encoding);
  };

  // Add performance monitoring
  req.startTime = startTime;
  req.correlationId = req.correlationId;

  next();
};

// Middleware to add correlation ID to all responses
const addCorrelationId = (req, res, next) => {
  const correlationId = req.headers['x-correlation-id'] || uuidv4();
  req.correlationId = correlationId;
  res.setHeader('X-Correlation-ID', correlationId);
  next();
};

// Middleware to log request body (for debugging)
const logRequestBody = (req, res, next) => {
  if (process.env.NODE_ENV === 'development' && req.body) {
    logger.debug('Request body', {
      method: req.method,
      url: req.originalUrl,
      body: req.body,
      correlationId: req.correlationId
    });
  }
  next();
};

// Middleware to log response body (for debugging)
const logResponseBody = (req, res, next) => {
  if (process.env.NODE_ENV === 'development') {
    const originalSend = res.send;
    res.send = function(body) {
      logger.debug('Response body', {
        method: req.method,
        url: req.originalUrl,
        statusCode: res.statusCode,
        body: typeof body === 'string' ? body : JSON.stringify(body),
        correlationId: req.correlationId
      });
      originalSend.call(this, body);
    };
  }
  next();
};

// Middleware to track request metrics
const trackMetrics = (req, res, next) => {
  const startTime = process.hrtime();

  res.on('finish', () => {
    const [seconds, nanoseconds] = process.hrtime(startTime);
    const duration = seconds * 1000 + nanoseconds / 1000000; // Convert to milliseconds

    // Log performance metrics
    logger.performance(
      `${req.method} ${req.originalUrl}`,
      Math.round(duration),
      {
        statusCode: res.statusCode,
        correlationId: req.correlationId,
        userId: req.user?.id,
        ip: req.ip
      }
    );

    // Track specific metrics based on endpoint
    if (req.originalUrl.startsWith('/slack')) {
      logger.metrics('slack_requests_total', 1, {
        method: req.method,
        endpoint: req.originalUrl,
        status: res.statusCode < 400 ? 'success' : 'error'
      });
    }

    if (req.originalUrl.startsWith('/auth')) {
      logger.metrics('auth_requests_total', 1, {
        method: req.method,
        endpoint: req.originalUrl,
        status: res.statusCode < 400 ? 'success' : 'error'
      });
    }

    if (req.originalUrl.startsWith('/admin')) {
      logger.metrics('admin_requests_total', 1, {
        method: req.method,
        endpoint: req.originalUrl,
        status: res.statusCode < 400 ? 'success' : 'error'
      });
    }
  });

  next();
};

// Middleware to sanitize sensitive data
const sanitizeRequest = (req, res, next) => {
  // Create a sanitized version of the request for logging
  req.sanitizedForLogging = {
    method: req.method,
    url: req.originalUrl,
    headers: { ...req.headers },
    query: { ...req.query },
    body: req.body ? { ...req.body } : undefined
  };

  // Remove sensitive headers
  delete req.sanitizedForLogging.headers.authorization;
  delete req.sanitizedForLogging.headers.cookie;
  delete req.sanitizedForLogging.headers['x-api-key'];

  // Remove sensitive body fields
  if (req.sanitizedForLogging.body) {
    delete req.sanitizedForLogging.body.password;
    delete req.sanitizedForLogging.body.token;
    delete req.sanitizedForLogging.body.secret;
    delete req.sanitizedForLogging.body.apiKey;
  }

  next();
};

// Middleware to log request context
const logRequestContext = (req, res, next) => {
  const context = {
    correlationId: req.correlationId,
    timestamp: new Date().toISOString(),
    method: req.method,
    url: req.originalUrl,
    ip: req.ip || req.connection.remoteAddress,
    userAgent: req.get('User-Agent'),
    userId: req.user?.id,
    sessionId: req.session?.id,
    referer: req.get('Referer'),
    origin: req.get('Origin')
  };

  logger.debug('Request context', context);
  next();
};

module.exports = {
  requestLogger,
  addCorrelationId,
  logRequestBody,
  logResponseBody,
  trackMetrics,
  sanitizeRequest,
  logRequestContext
}; 