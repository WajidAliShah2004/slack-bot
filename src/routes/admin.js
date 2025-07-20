const express = require('express');
const { body, validationResult } = require('express-validator');
const logger = require('../utils/logger');
const { asyncHandler } = require('../middleware/errorHandler');
const AzureAuthService = require('../services/azureAuthService');
const SlackService = require('../services/slackService');
const LLMService = require('../services/llmService');

const router = express.Router();
const azureAuthService = new AzureAuthService();
const slackService = new SlackService();
const llmService = new LLMService();

// Middleware to check if user is authenticated and has admin permissions
const requireAdmin = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '') || 
                  req.cookies?.jwt || 
                  req.query?.token;

    if (!token) {
      return res.status(401).json({
        success: false,
        error: 'Authentication token required'
      });
    }

    const decoded = azureAuthService.verifyJWT(token);
    if (!decoded) {
      return res.status(401).json({
        success: false,
        error: 'Invalid or expired token'
      });
    }

    // Check if user is still active
    const isValid = await azureAuthService.validateToken(token);
    if (!isValid) {
      return res.status(401).json({
        success: false,
        error: 'User account is inactive or revoked'
      });
    }

    // Check admin permissions
    const hasPermission = await azureAuthService.checkUserPermission(decoded.userId, 'admin');
    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        error: 'Admin permission required'
      });
    }

    req.user = decoded;
    next();
  } catch (error) {
    logger.error('Admin authentication middleware error:', error);
    return res.status(401).json({
      success: false,
      error: 'Authentication failed'
    });
  }
};

// Apply admin middleware to all routes
router.use(requireAdmin);

// Get system overview
router.get('/overview', asyncHandler(async (req, res) => {
  try {
    const overview = await getSystemOverview();
    
    res.json({
      success: true,
      data: overview
    });
  } catch (error) {
    logger.error('Error getting system overview:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get system overview'
    });
  }
}));

// Get workspace information
router.get('/workspaces', asyncHandler(async (req, res) => {
  try {
    const workspaces = await slackService.getWorkspaceInfo();
    
    res.json({
      success: true,
      data: workspaces
    });
  } catch (error) {
    logger.error('Error getting workspace info:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get workspace information'
    });
  }
}));

// Get system metrics
router.get('/metrics', asyncHandler(async (req, res) => {
  try {
    const { days = 30 } = req.query;
    const metrics = await getSystemMetrics(parseInt(days));
    
    res.json({
      success: true,
      data: metrics
    });
  } catch (error) {
    logger.error('Error getting system metrics:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get system metrics'
    });
  }
}));

// Broadcast message to channels
router.post('/broadcast',
  [
    body('message').notEmpty().withMessage('Message is required'),
    body('channels').optional().isArray(),
    body('exclude_channels').optional().isArray(),
    body('scheduled_at').optional().isISO8601()
  ],
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        errors: errors.array()
      });
    }

    try {
      const { message, channels, exclude_channels, scheduled_at } = req.body;
      
      let result;
      if (scheduled_at) {
        result = await slackService.scheduleBroadcast(message, channels, exclude_channels, new Date(scheduled_at));
      } else {
        result = await slackService.broadcastMessage(message, channels, exclude_channels);
      }

      logger.audit('broadcast_message', req.user.email, 'slack', {
        messageLength: message.length,
        channels: channels?.length || 'all',
        scheduled: !!scheduled_at
      });

      res.json({
        success: true,
        data: result
      });
    } catch (error) {
      logger.error('Error broadcasting message:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to broadcast message'
      });
    }
  })
);

// Get user statistics
router.get('/users/stats', asyncHandler(async (req, res) => {
  try {
    const { days = 30 } = req.query;
    const stats = await azureAuthService.getUserStats(parseInt(days));
    
    res.json({
      success: true,
      data: stats
    });
  } catch (error) {
    logger.error('Error getting user stats:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get user statistics'
    });
  }
}));

// Get LLM usage statistics
router.get('/llm/stats', asyncHandler(async (req, res) => {
  try {
    const { days = 30 } = req.query;
    const stats = await llmService.getUsageStats(parseInt(days));
    
    res.json({
      success: true,
      data: stats
    });
  } catch (error) {
    logger.error('Error getting LLM stats:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get LLM statistics'
    });
  }
}));

// Clear LLM cache
router.post('/llm/clear-cache', asyncHandler(async (req, res) => {
  try {
    await llmService.clearCache();
    
    logger.audit('clear_llm_cache', req.user.email, 'llm', {});
    
    res.json({
      success: true,
      message: 'LLM cache cleared successfully'
    });
  } catch (error) {
    logger.error('Error clearing LLM cache:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to clear LLM cache'
    });
  }
}));

// Get interaction logs
router.get('/interactions', asyncHandler(async (req, res) => {
  try {
    const { 
      type, 
      userId, 
      channelId, 
      startDate, 
      endDate, 
      page = 1, 
      limit = 50 
    } = req.query;

    const interactions = await getInteractionLogs({
      type,
      userId,
      channelId,
      startDate: startDate ? new Date(startDate) : undefined,
      endDate: endDate ? new Date(endDate) : undefined,
      page: parseInt(page),
      limit: parseInt(limit)
    });

    res.json({
      success: true,
      data: interactions
    });
  } catch (error) {
    logger.error('Error getting interaction logs:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get interaction logs'
    });
  }
}));

// Get error logs
router.get('/errors', asyncHandler(async (req, res) => {
  try {
    const { 
      level, 
      startDate, 
      endDate, 
      page = 1, 
      limit = 50 
    } = req.query;

    const errors = await getErrorLogs({
      level,
      startDate: startDate ? new Date(startDate) : undefined,
      endDate: endDate ? new Date(endDate) : undefined,
      page: parseInt(page),
      limit: parseInt(limit)
    });

    res.json({
      success: true,
      data: errors
    });
  } catch (error) {
    logger.error('Error getting error logs:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get error logs'
    });
  }
}));

// Update bot configuration
router.put('/config',
  [
    body('slack.enabled').optional().isBoolean(),
    body('llm.enabled').optional().isBoolean(),
    body('llm.model').optional().isString(),
    body('llm.maxTokens').optional().isInt({ min: 1, max: 4000 }),
    body('llm.temperature').optional().isFloat({ min: 0, max: 2 }),
    body('azure.enabled').optional().isBoolean(),
    body('monitoring.enabled').optional().isBoolean(),
    body('rateLimit.enabled').optional().isBoolean(),
    body('rateLimit.maxRequests').optional().isInt({ min: 1 })
  ],
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        errors: errors.array()
      });
    }

    try {
      const config = await updateBotConfiguration(req.body);
      
      logger.audit('update_config', req.user.email, 'system', {
        changes: Object.keys(req.body)
      });

      res.json({
        success: true,
        data: config
      });
    } catch (error) {
      logger.error('Error updating bot configuration:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to update bot configuration'
      });
    }
  })
);

// Get bot configuration
router.get('/config', asyncHandler(async (req, res) => {
  try {
    const config = await getBotConfiguration();
    
    res.json({
      success: true,
      data: config
    });
  } catch (error) {
    logger.error('Error getting bot configuration:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get bot configuration'
    });
  }
}));

// Restart bot services
router.post('/restart', asyncHandler(async (req, res) => {
  try {
    const { services } = req.body; // Array of services to restart
    
    const results = await restartServices(services);
    
    logger.audit('restart_services', req.user.email, 'system', {
      services: services || 'all'
    });

    res.json({
      success: true,
      data: results
    });
  } catch (error) {
    logger.error('Error restarting services:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to restart services'
    });
  }
}));

// Get system health
router.get('/health', asyncHandler(async (req, res) => {
  try {
    const health = await getSystemHealth();
    
    res.json({
      success: true,
      data: health
    });
  } catch (error) {
    logger.error('Error getting system health:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get system health'
    });
  }
}));

// Export data
router.post('/export',
  [
    body('type').isIn(['users', 'interactions', 'logs', 'metrics']).withMessage('Valid export type required'),
    body('format').isIn(['json', 'csv']).withMessage('Valid format required'),
    body('startDate').optional().isISO8601(),
    body('endDate').optional().isISO8601()
  ],
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        errors: errors.array()
      });
    }

    try {
      const { type, format, startDate, endDate } = req.body;
      
      const exportData = await exportSystemData({
        type,
        format,
        startDate: startDate ? new Date(startDate) : undefined,
        endDate: endDate ? new Date(endDate) : undefined
      });

      logger.audit('export_data', req.user.email, 'system', {
        type,
        format,
        startDate,
        endDate
      });

      res.json({
        success: true,
        data: exportData
      });
    } catch (error) {
      logger.error('Error exporting data:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to export data'
      });
    }
  })
);

// Helper functions
async function getSystemOverview() {
  const [
    userCount,
    interactionCount,
    workspaceInfo,
    llmStats,
    systemHealth
  ] = await Promise.all([
    azureAuthService.getActiveUsers(),
    getInteractionCount(),
    slackService.getWorkspaceInfo(),
    llmService.getUsageStats(7),
    getSystemHealth()
  ]);

  return {
    users: {
      total: userCount.length,
      active: userCount.filter(u => u.isActive).length
    },
    interactions: {
      total: interactionCount.total,
      last24h: interactionCount.last24h
    },
    workspace: workspaceInfo,
    llm: {
      totalRequests: llmStats.totalRequests || 0,
      averageResponseTime: llmStats.averageResponseTime || 0
    },
    system: systemHealth
  };
}

async function getSystemMetrics(days) {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  const [
    userStats,
    interactionStats,
    llmStats,
    errorStats
  ] = await Promise.all([
    azureAuthService.getUserStats(days),
    getInteractionStats(startDate),
    llmService.getUsageStats(days),
    getErrorStats(startDate)
  ]);

  return {
    users: userStats,
    interactions: interactionStats,
    llm: llmStats,
    errors: errorStats,
    period: {
      days,
      startDate: startDate.toISOString(),
      endDate: new Date().toISOString()
    }
  };
}

async function getInteractionLogs(filters) {
  // This would query the database for interaction logs
  // Implementation depends on your database schema
  return {
    interactions: [],
    pagination: {
      page: filters.page,
      limit: filters.limit,
      total: 0
    }
  };
}

async function getErrorLogs(filters) {
  // This would query the error logs
  // Implementation depends on your logging setup
  return {
    errors: [],
    pagination: {
      page: filters.page,
      limit: filters.limit,
      total: 0
    }
  };
}

async function updateBotConfiguration(config) {
  // This would update the bot configuration
  // Implementation depends on your configuration management
  return {
    ...config,
    updatedAt: new Date().toISOString(),
    updatedBy: 'admin'
  };
}

async function getBotConfiguration() {
  // This would retrieve the current bot configuration
  return {
    slack: {
      enabled: true,
      botToken: 'configured',
      signingSecret: 'configured'
    },
    llm: {
      enabled: true,
      model: process.env.OPENAI_MODEL || 'gpt-4',
      maxTokens: 1000,
      temperature: 0.7
    },
    azure: {
      enabled: true,
      clientId: 'configured',
      tenantId: 'configured'
    },
    monitoring: {
      enabled: true
    },
    rateLimit: {
      enabled: true,
      maxRequests: 100
    }
  };
}

async function restartServices(services) {
  // This would restart the specified services
  const results = {};
  
  if (!services || services.includes('slack')) {
    try {
      await slackService.shutdown();
      await slackService.initialize();
      results.slack = 'restarted';
    } catch (error) {
      results.slack = 'failed';
    }
  }

  if (!services || services.includes('llm')) {
    try {
      await llmService.shutdown();
      await llmService.initialize();
      results.llm = 'restarted';
    } catch (error) {
      results.llm = 'failed';
    }
  }

  return results;
}

async function getSystemHealth() {
  const [
    dbHealth,
    redisHealth,
    slackHealth,
    azureHealth,
    llmHealth
  ] = await Promise.all([
    checkDatabaseHealth(),
    checkRedisHealth(),
    checkSlackHealth(),
    checkAzureHealth(),
    checkLLMHealth()
  ]);

  return {
    database: dbHealth,
    redis: redisHealth,
    slack: slackHealth,
    azure: azureHealth,
    llm: llmHealth,
    overall: determineOverallHealth([dbHealth, redisHealth, slackHealth, azureHealth, llmHealth])
  };
}

async function exportSystemData(options) {
  // This would export the specified data in the requested format
  // Implementation depends on your data structure
  return {
    type: options.type,
    format: options.format,
    data: [],
    exportedAt: new Date().toISOString()
  };
}

async function getInteractionCount() {
  // This would query the database for interaction counts
  return {
    total: 0,
    last24h: 0
  };
}

async function getInteractionStats(startDate) {
  // This would query the database for interaction statistics
  return {
    total: 0,
    byType: {},
    byChannel: {},
    byUser: {}
  };
}

async function getErrorStats(startDate) {
  // This would query the error logs for statistics
  return {
    total: 0,
    byLevel: {},
    byService: {}
  };
}

async function checkDatabaseHealth() {
  try {
    // Check database connection
    return { status: 'healthy' };
  } catch (error) {
    return { status: 'unhealthy', error: error.message };
  }
}

async function checkRedisHealth() {
  try {
    // Check Redis connection
    return { status: 'healthy' };
  } catch (error) {
    return { status: 'unhealthy', error: error.message };
  }
}

async function checkSlackHealth() {
  try {
    // Check Slack API connection
    return { status: 'healthy' };
  } catch (error) {
    return { status: 'unhealthy', error: error.message };
  }
}

async function checkAzureHealth() {
  try {
    // Check Azure AD connection
    return { status: 'healthy' };
  } catch (error) {
    return { status: 'unhealthy', error: error.message };
  }
}

async function checkLLMHealth() {
  try {
    // Check OpenAI API connection
    return { status: 'healthy' };
  } catch (error) {
    return { status: 'unhealthy', error: error.message };
  }
}

function determineOverallHealth(checks) {
  const healthyChecks = checks.filter(check => check.status === 'healthy');
  const totalChecks = checks.length;

  if (healthyChecks.length === totalChecks) {
    return 'healthy';
  } else if (healthyChecks.length > totalChecks / 2) {
    return 'degraded';
  } else {
    return 'unhealthy';
  }
}

module.exports = router; 