const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const prometheusMiddleware = require('express-prometheus-middleware');
require('dotenv').config();

const logger = require('./utils/logger');
const errorHandler = require('./middleware/errorHandler');
const requestLogger = require('./middleware/requestLogger');
const { PrismaClient } = require('@prisma/client');

// Import routes
const slackRoutes = require('./routes/slack');
const authRoutes = require('./routes/auth');
const adminRoutes = require('./routes/admin');
const healthRoutes = require('./routes/health');

// Import services
const SlackService = require('./services/slackService');
const AzureAuthService = require('./services/azureAuthService');
const LLMService = require('./services/llmService');

class App {
  constructor() {
    this.app = express();
    this.port = process.env.PORT || 3000;
    this.prisma = new PrismaClient();
    
    this.initializeMiddleware();
    this.initializeRoutes();
    this.initializeErrorHandling();
    this.initializeServices();
  }

  initializeMiddleware() {
    // Security middleware
    this.app.use(helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          scriptSrc: ["'self'"],
          imgSrc: ["'self'", "data:", "https:"],
        },
      },
    }));

    // CORS configuration
    this.app.use(cors({
      origin: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000'],
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    }));

    // Compression
    this.app.use(compression());

    // Body parsing
    this.app.use(express.json({ limit: '10mb' }));
    this.app.use(express.urlencoded({ extended: true, limit: '10mb' }));

    // Rate limiting
    const limiter = rateLimit({
      windowMs: 15 * 60 * 1000, // 15 minutes
      max: 100, // limit each IP to 100 requests per windowMs
      message: 'Too many requests from this IP, please try again later.',
      standardHeaders: true,
      legacyHeaders: false,
    });
    this.app.use(limiter);

    // Prometheus metrics
    this.app.use(prometheusMiddleware({
      metricsPath: '/metrics',
      collectDefaultMetrics: true,
      requestDurationBuckets: [0.1, 0.5, 1, 2, 5],
      requestLengthBuckets: [512, 1024, 5120, 10240, 51200],
      responseLengthBuckets: [512, 1024, 5120, 10240, 51200],
    }));

    // Request logging
    this.app.use(requestLogger);
  }

  initializeRoutes() {
    // Health check route
    this.app.use('/health', healthRoutes);
    
    // Slack webhook and events
    this.app.use('/slack', slackRoutes);
    
    // Azure AD authentication
    this.app.use('/auth', authRoutes);
    
    // Admin endpoints
    this.app.use('/admin', adminRoutes);

    // Root endpoint
    this.app.get('/', (req, res) => {
      res.json({
        message: 'Smart Slack Bot API',
        version: '1.0.0',
        status: 'running',
        timestamp: new Date().toISOString(),
        endpoints: {
          health: '/health',
          slack: '/slack',
          auth: '/auth',
          admin: '/admin',
          metrics: '/metrics'
        }
      });
    });

    // 404 handler
    this.app.use('*', (req, res) => {
      res.status(404).json({
        error: 'Endpoint not found',
        path: req.originalUrl,
        method: req.method
      });
    });
  }

  initializeErrorHandling() {
    this.app.use(errorHandler);
  }

  async initializeServices() {
    try {
      // Initialize services
      this.slackService = new SlackService();
      this.azureAuthService = new AzureAuthService();
      this.llmService = new LLMService();

      // Test database connection
      await this.prisma.$connect();
      logger.info('Database connection established');

      // Initialize Slack bot
      await this.slackService.initialize();
      logger.info('Slack service initialized');

      // Initialize Azure AD
      await this.azureAuthService.initialize();
      logger.info('Azure AD service initialized');

      // Initialize LLM service
      await this.llmService.initialize();
      logger.info('LLM service initialized');

    } catch (error) {
      logger.error('Failed to initialize services:', error);
      process.exit(1);
    }
  }

  async start() {
    try {
      this.server = this.app.listen(this.port, () => {
        logger.info(`🚀 Smart Slack Bot server running on port ${this.port}`);
        logger.info(`📊 Metrics available at http://localhost:${this.port}/metrics`);
        logger.info(`🏥 Health check at http://localhost:${this.port}/health`);
      });

      // Graceful shutdown
      process.on('SIGTERM', () => this.gracefulShutdown());
      process.on('SIGINT', () => this.gracefulShutdown());

    } catch (error) {
      logger.error('Failed to start server:', error);
      process.exit(1);
    }
  }

  async gracefulShutdown() {
    logger.info('🛑 Received shutdown signal, starting graceful shutdown...');
    
    try {
      // Close server
      if (this.server) {
        await new Promise((resolve) => this.server.close(resolve));
        logger.info('✅ HTTP server closed');
      }

      // Close database connection
      if (this.prisma) {
        await this.prisma.$disconnect();
        logger.info('✅ Database connection closed');
      }

      // Close services
      if (this.slackService) {
        await this.slackService.shutdown();
        logger.info('✅ Slack service shutdown');
      }

      logger.info('✅ Graceful shutdown completed');
      process.exit(0);
    } catch (error) {
      logger.error('❌ Error during graceful shutdown:', error);
      process.exit(1);
    }
  }
}

// Start the application
const app = new App();
app.start().catch((error) => {
  logger.error('Failed to start application:', error);
  process.exit(1);
});

module.exports = app; 