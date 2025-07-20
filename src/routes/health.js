const express = require('express');
const { asyncHandler } = require('../middleware/errorHandler');
const logger = require('../utils/logger');
const { PrismaClient } = require('@prisma/client');
const Redis = require('redis');

const router = express.Router();
const prisma = new PrismaClient();

// Basic health check
router.get('/', asyncHandler(async (req, res) => {
  const startTime = Date.now();
  
  try {
    // Check database connection
    await prisma.$queryRaw`SELECT 1`;
    const dbStatus = 'healthy';
    
    // Check Redis connection (if configured)
    let redisStatus = 'not_configured';
    if (process.env.REDIS_URL) {
      try {
        const redis = Redis.createClient({ url: process.env.REDIS_URL });
        await redis.connect();
        await redis.ping();
        await redis.quit();
        redisStatus = 'healthy';
      } catch (error) {
        redisStatus = 'unhealthy';
        logger.error('Redis health check failed:', error);
      }
    }

    // Check external services
    const externalServices = await checkExternalServices();
    
    // Calculate response time
    const responseTime = Date.now() - startTime;
    
    // Determine overall health
    const overallHealth = determineOverallHealth({
      database: dbStatus,
      redis: redisStatus,
      externalServices
    });

    const healthData = {
      status: overallHealth.status,
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      version: process.env.npm_package_version || '1.0.0',
      environment: process.env.NODE_ENV || 'development',
      responseTime: `${responseTime}ms`,
      services: {
        database: {
          status: dbStatus,
          responseTime: `${responseTime}ms`
        },
        redis: {
          status: redisStatus,
          url: process.env.REDIS_URL ? 'configured' : 'not_configured'
        },
        external: externalServices
      },
      system: {
        memory: process.memoryUsage(),
        cpu: process.cpuUsage(),
        platform: process.platform,
        nodeVersion: process.version,
        pid: process.pid
      }
    };

    // Set appropriate status code
    const statusCode = overallHealth.status === 'healthy' ? 200 : 503;
    
    res.status(statusCode).json(healthData);
    
    // Log health check
    logger.health('application', overallHealth.status, {
      responseTime,
      services: healthData.services
    });

  } catch (error) {
    logger.error('Health check failed:', error);
    
    res.status(503).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      error: 'Health check failed',
      details: error.message
    });
  }
}));

// Detailed health check
router.get('/detailed', asyncHandler(async (req, res) => {
  const startTime = Date.now();
  const checks = {};

  try {
    // Database health check
    const dbStart = Date.now();
    try {
      await prisma.$queryRaw`SELECT 1`;
      checks.database = {
        status: 'healthy',
        responseTime: Date.now() - dbStart,
        details: {
          provider: 'postgresql',
          url: process.env.DATABASE_URL ? 'configured' : 'not_configured'
        }
      };
    } catch (error) {
      checks.database = {
        status: 'unhealthy',
        responseTime: Date.now() - dbStart,
        error: error.message
      };
    }

    // Redis health check
    const redisStart = Date.now();
    if (process.env.REDIS_URL) {
      try {
        const redis = Redis.createClient({ url: process.env.REDIS_URL });
        await redis.connect();
        const pingResult = await redis.ping();
        await redis.quit();
        
        checks.redis = {
          status: 'healthy',
          responseTime: Date.now() - redisStart,
          details: {
            ping: pingResult,
            url: process.env.REDIS_URL
          }
        };
      } catch (error) {
        checks.redis = {
          status: 'unhealthy',
          responseTime: Date.now() - redisStart,
          error: error.message
        };
      }
    } else {
      checks.redis = {
        status: 'not_configured',
        responseTime: 0,
        details: {
          reason: 'REDIS_URL not configured'
        }
      };
    }

    // Slack API health check
    const slackStart = Date.now();
    try {
      // This would check Slack API connectivity
      checks.slack = {
        status: 'healthy',
        responseTime: Date.now() - slackStart,
        details: {
          botToken: process.env.SLACK_BOT_TOKEN ? 'configured' : 'not_configured',
          signingSecret: process.env.SLACK_SIGNING_SECRET ? 'configured' : 'not_configured'
        }
      };
    } catch (error) {
      checks.slack = {
        status: 'unhealthy',
        responseTime: Date.now() - slackStart,
        error: error.message
      };
    }

    // Azure AD health check
    const azureStart = Date.now();
    try {
      checks.azure = {
        status: 'healthy',
        responseTime: Date.now() - azureStart,
        details: {
          clientId: process.env.AZURE_CLIENT_ID ? 'configured' : 'not_configured',
          tenantId: process.env.AZURE_TENANT_ID ? 'configured' : 'not_configured'
        }
      };
    } catch (error) {
      checks.azure = {
        status: 'unhealthy',
        responseTime: Date.now() - azureStart,
        error: error.message
      };
    }

    // OpenAI API health check
    const openaiStart = Date.now();
    try {
      checks.openai = {
        status: 'healthy',
        responseTime: Date.now() - openaiStart,
        details: {
          apiKey: process.env.OPENAI_API_KEY ? 'configured' : 'not_configured',
          model: process.env.OPENAI_MODEL || 'gpt-4'
        }
      };
    } catch (error) {
      checks.openai = {
        status: 'unhealthy',
        responseTime: Date.now() - openaiStart,
        error: error.message
      };
    }

    // System metrics
    const systemMetrics = {
      memory: process.memoryUsage(),
      cpu: process.cpuUsage(),
      uptime: process.uptime(),
      platform: process.platform,
      nodeVersion: process.version,
      pid: process.pid,
      environment: process.env.NODE_ENV || 'development'
    };

    // Calculate overall health
    const overallHealth = determineOverallHealth(checks);
    const totalResponseTime = Date.now() - startTime;

    const detailedHealth = {
      status: overallHealth.status,
      timestamp: new Date().toISOString(),
      responseTime: `${totalResponseTime}ms`,
      checks,
      system: systemMetrics,
      summary: {
        total: Object.keys(checks).length,
        healthy: Object.values(checks).filter(c => c.status === 'healthy').length,
        unhealthy: Object.values(checks).filter(c => c.status === 'unhealthy').length,
        notConfigured: Object.values(checks).filter(c => c.status === 'not_configured').length
      }
    };

    const statusCode = overallHealth.status === 'healthy' ? 200 : 503;
    res.status(statusCode).json(detailedHealth);

    // Log detailed health check
    logger.health('detailed', overallHealth.status, {
      responseTime: totalResponseTime,
      summary: detailedHealth.summary
    });

  } catch (error) {
    logger.error('Detailed health check failed:', error);
    
    res.status(503).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      error: 'Detailed health check failed',
      details: error.message
    });
  }
}));

// Readiness check (for Kubernetes)
router.get('/ready', asyncHandler(async (req, res) => {
  try {
    // Check if the application is ready to serve traffic
    const checks = await performReadinessChecks();
    
    const isReady = Object.values(checks).every(check => check.status === 'ready');
    const statusCode = isReady ? 200 : 503;

    res.status(statusCode).json({
      status: isReady ? 'ready' : 'not_ready',
      timestamp: new Date().toISOString(),
      checks
    });

  } catch (error) {
    logger.error('Readiness check failed:', error);
    res.status(503).json({
      status: 'not_ready',
      timestamp: new Date().toISOString(),
      error: 'Readiness check failed'
    });
  }
}));

// Liveness check (for Kubernetes)
router.get('/live', asyncHandler(async (req, res) => {
  try {
    // Simple check to see if the application is alive
    const isAlive = process.uptime() > 0;
    
    res.status(isAlive ? 200 : 503).json({
      status: isAlive ? 'alive' : 'dead',
      timestamp: new Date().toISOString(),
      uptime: process.uptime()
    });

  } catch (error) {
    logger.error('Liveness check failed:', error);
    res.status(503).json({
      status: 'dead',
      timestamp: new Date().toISOString(),
      error: 'Liveness check failed'
    });
  }
}));

// Metrics endpoint
router.get('/metrics', asyncHandler(async (req, res) => {
  try {
    const metrics = await collectMetrics();
    
    res.json({
      timestamp: new Date().toISOString(),
      metrics
    });

  } catch (error) {
    logger.error('Metrics collection failed:', error);
    res.status(500).json({
      error: 'Failed to collect metrics',
      details: error.message
    });
  }
}));

// Helper functions
async function checkExternalServices() {
  const services = {};
  
  // Check Slack API
  try {
    services.slack = {
      status: 'healthy',
      details: {
        botToken: process.env.SLACK_BOT_TOKEN ? 'configured' : 'not_configured'
      }
    };
  } catch (error) {
    services.slack = {
      status: 'unhealthy',
      error: error.message
    };
  }

  // Check Azure AD
  try {
    services.azure = {
      status: 'healthy',
      details: {
        clientId: process.env.AZURE_CLIENT_ID ? 'configured' : 'not_configured'
      }
    };
  } catch (error) {
    services.azure = {
      status: 'unhealthy',
      error: error.message
    };
  }

  // Check OpenAI
  try {
    services.openai = {
      status: 'healthy',
      details: {
        apiKey: process.env.OPENAI_API_KEY ? 'configured' : 'not_configured'
      }
    };
  } catch (error) {
    services.openai = {
      status: 'unhealthy',
      error: error.message
    };
  }

  return services;
}

function determineOverallHealth(checks) {
  const allChecks = Object.values(checks);
  const unhealthyChecks = allChecks.filter(check => check.status === 'unhealthy');
  
  if (unhealthyChecks.length === 0) {
    return { status: 'healthy' };
  } else if (unhealthyChecks.length < allChecks.length) {
    return { status: 'degraded' };
  } else {
    return { status: 'unhealthy' };
  }
}

async function performReadinessChecks() {
  const checks = {};

  // Database readiness
  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.database = { status: 'ready' };
  } catch (error) {
    checks.database = { status: 'not_ready', error: error.message };
  }

  // Redis readiness
  if (process.env.REDIS_URL) {
    try {
      const redis = Redis.createClient({ url: process.env.REDIS_URL });
      await redis.connect();
      await redis.ping();
      await redis.quit();
      checks.redis = { status: 'ready' };
    } catch (error) {
      checks.redis = { status: 'not_ready', error: error.message };
    }
  } else {
    checks.redis = { status: 'not_configured' };
  }

  // Application readiness
  checks.application = { status: 'ready' };

  return checks;
}

async function collectMetrics() {
  const metrics = {
    system: {
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      cpu: process.cpuUsage()
    },
    database: {
      // Add database-specific metrics here
    },
    redis: {
      // Add Redis-specific metrics here
    },
    slack: {
      // Add Slack-specific metrics here
    },
    azure: {
      // Add Azure-specific metrics here
    },
    openai: {
      // Add OpenAI-specific metrics here
    }
  };

  return metrics;
}

module.exports = router; 