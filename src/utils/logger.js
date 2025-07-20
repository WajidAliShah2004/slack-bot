const winston = require('winston');
const DailyRotateFile = require('winston-daily-rotate-file');
const path = require('path');

// Define log levels
const levels = {
  error: 0,
  warn: 1,
  info: 2,
  http: 3,
  debug: 4,
};

// Define colors for each level
const colors = {
  error: 'red',
  warn: 'yellow',
  info: 'green',
  http: 'magenta',
  debug: 'white',
};

// Tell winston that you want to link the colors
winston.addColors(colors);

// Define which level to log based on environment
const level = () => {
  const env = process.env.NODE_ENV || 'development';
  const isDevelopment = env === 'development';
  return isDevelopment ? 'debug' : 'warn';
};

// Define format for logs
const format = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss:ms' }),
  winston.format.colorize({ all: true }),
  winston.format.printf(
    (info) => `${info.timestamp} ${info.level}: ${info.message}`,
  ),
);

// Define format for file logs (without colors)
const fileFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss:ms' }),
  winston.format.errors({ stack: true }),
  winston.format.json(),
  winston.format.printf(
    (info) => {
      const { timestamp, level, message, stack, ...meta } = info;
      let log = `${timestamp} [${level.toUpperCase()}]: ${message}`;
      
      if (stack) {
        log += `\n${stack}`;
      }
      
      if (Object.keys(meta).length > 0) {
        log += `\n${JSON.stringify(meta, null, 2)}`;
      }
      
      return log;
    }
  ),
);

// Define transports
const transports = [
  // Console transport
  new winston.transports.Console({
    format: winston.format.combine(
      winston.format.colorize(),
      winston.format.simple()
    )
  }),
  
  // Error log file
  new DailyRotateFile({
    filename: path.join('logs', 'error-%DATE%.log'),
    datePattern: 'YYYY-MM-DD',
    level: 'error',
    format: fileFormat,
    maxSize: '20m',
    maxFiles: '14d',
    zippedArchive: true,
  }),
  
  // Combined log file
  new DailyRotateFile({
    filename: path.join('logs', 'combined-%DATE%.log'),
    datePattern: 'YYYY-MM-DD',
    format: fileFormat,
    maxSize: '20m',
    maxFiles: '14d',
    zippedArchive: true,
  }),
  
  // HTTP requests log file
  new DailyRotateFile({
    filename: path.join('logs', 'http-%DATE%.log'),
    datePattern: 'YYYY-MM-DD',
    level: 'http',
    format: fileFormat,
    maxSize: '20m',
    maxFiles: '7d',
    zippedArchive: true,
  }),
];

// Create the logger
const logger = winston.createLogger({
  level: level(),
  levels,
  format,
  transports,
  exitOnError: false,
});

// Create a stream object for Morgan HTTP logging
logger.stream = {
  write: (message) => {
    logger.http(message.trim());
  },
};

// Add correlation ID support
logger.addCorrelationId = (correlationId) => {
  return winston.format.printf((info) => {
    if (correlationId) {
      info.correlationId = correlationId;
    }
    return `${info.timestamp} [${info.level.toUpperCase()}] [${info.correlationId || 'NO-ID'}]: ${info.message}`;
  });
};

// Add request context support
logger.addRequestContext = (req) => {
  return winston.format.printf((info) => {
    const context = {
      method: req?.method,
      url: req?.url,
      ip: req?.ip,
      userAgent: req?.get('User-Agent'),
      userId: req?.user?.id,
    };
    
    info.requestContext = context;
    return `${info.timestamp} [${info.level.toUpperCase()}] [${info.correlationId || 'NO-ID'}]: ${info.message} ${JSON.stringify(context)}`;
  });
};

// Performance logging helper
logger.performance = (operation, duration, metadata = {}) => {
  logger.info(`Performance: ${operation} completed in ${duration}ms`, {
    operation,
    duration,
    ...metadata
  });
};

// Security logging helper
logger.security = (event, details, metadata = {}) => {
  logger.warn(`Security Event: ${event}`, {
    event,
    details,
    ...metadata
  });
};

// Business logic logging helper
logger.business = (action, details, metadata = {}) => {
  logger.info(`Business Logic: ${action}`, {
    action,
    details,
    ...metadata
  });
};

// API logging helper
logger.api = (method, endpoint, statusCode, duration, metadata = {}) => {
  const level = statusCode >= 400 ? 'warn' : 'info';
  logger[level](`API ${method} ${endpoint} - ${statusCode} (${duration}ms)`, {
    method,
    endpoint,
    statusCode,
    duration,
    ...metadata
  });
};

// Database logging helper
logger.database = (operation, table, duration, metadata = {}) => {
  logger.debug(`Database ${operation} on ${table} (${duration}ms)`, {
    operation,
    table,
    duration,
    ...metadata
  });
};

// External service logging helper
logger.external = (service, operation, status, duration, metadata = {}) => {
  const level = status === 'error' ? 'error' : status === 'warning' ? 'warn' : 'info';
  logger[level](`External Service ${service}: ${operation} - ${status} (${duration}ms)`, {
    service,
    operation,
    status,
    duration,
    ...metadata
  });
};

// Slack specific logging helper
logger.slack = (event, channel, user, details, metadata = {}) => {
  logger.info(`Slack Event: ${event} in ${channel} by ${user}`, {
    event,
    channel,
    user,
    details,
    ...metadata
  });
};

// Azure AD specific logging helper
logger.azure = (action, user, details, metadata = {}) => {
  logger.info(`Azure AD: ${action} for user ${user}`, {
    action,
    user,
    details,
    ...metadata
  });
};

// LLM specific logging helper
logger.llm = (operation, model, tokens, duration, metadata = {}) => {
  logger.info(`LLM ${operation} using ${model} (${tokens} tokens, ${duration}ms)`, {
    operation,
    model,
    tokens,
    duration,
    ...metadata
  });
};

// Error logging with stack trace
logger.errorWithStack = (message, error, metadata = {}) => {
  logger.error(message, {
    error: error.message,
    stack: error.stack,
    ...metadata
  });
};

// Structured error logging
logger.structuredError = (error, context = {}) => {
  logger.error('Application Error', {
    message: error.message,
    stack: error.stack,
    name: error.name,
    code: error.code,
    context
  });
};

// Health check logging
logger.health = (component, status, details = {}) => {
  const level = status === 'healthy' ? 'info' : 'warn';
  logger[level](`Health Check: ${component} is ${status}`, {
    component,
    status,
    details
  });
};

// Metrics logging
logger.metrics = (metric, value, tags = {}) => {
  logger.info(`Metric: ${metric} = ${value}`, {
    metric,
    value,
    tags
  });
};

// Audit logging
logger.audit = (action, user, resource, details = {}) => {
  logger.info(`Audit: ${action} by ${user} on ${resource}`, {
    action,
    user,
    resource,
    details,
    timestamp: new Date().toISOString()
  });
};

module.exports = logger; 