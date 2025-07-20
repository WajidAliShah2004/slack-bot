const express = require('express');
const { body, validationResult } = require('express-validator');
const logger = require('../utils/logger');
const { asyncHandler } = require('../middleware/errorHandler');
const SlackService = require('../services/slackService');

const router = express.Router();
const slackService = new SlackService();

// Middleware to verify Slack webhook signature
const verifySlackSignature = (req, res, next) => {
  try {
    const signature = req.headers['x-slack-signature'];
    const timestamp = req.headers['x-slack-request-timestamp'];
    const body = JSON.stringify(req.body);

    if (!signature || !timestamp) {
      logger.security('Slack signature verification failed - missing headers', {
        signature: !!signature,
        timestamp: !!timestamp,
        ip: req.ip
      });
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const isValid = slackService.verifyWebhookSignature(signature, timestamp, body);
    
    if (!isValid) {
      logger.security('Slack signature verification failed - invalid signature', {
        ip: req.ip,
        userAgent: req.get('User-Agent')
      });
      return res.status(401).json({ error: 'Unauthorized' });
    }

    next();
  } catch (error) {
    logger.error('Error verifying Slack signature:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

// Handle Slack Events API
router.post('/events', 
  verifySlackSignature,
  asyncHandler(async (req, res) => {
    const { type, challenge, event } = req.body;

    logger.slack('webhook_received', 'events', 'slack', { type, event_type: event?.type });

    // Handle URL verification challenge
    if (type === 'url_verification') {
      logger.info('Slack URL verification challenge received');
      return res.json({ challenge });
    }

    // Handle events
    if (type === 'event_callback') {
      try {
        // Process the event
        await slackService.handleEvent(event);
        
        logger.slack('event_processed', event.channel || 'unknown', event.user || 'unknown', {
          event_type: event.type,
          event_id: event.event_id
        });

        res.status(200).json({ ok: true });
      } catch (error) {
        logger.error('Error processing Slack event:', error);
        res.status(500).json({ error: 'Event processing failed' });
      }
    } else {
      res.status(200).json({ ok: true });
    }
  })
);

// Handle Slack slash commands
router.post('/commands',
  verifySlackSignature,
  [
    body('command').notEmpty().withMessage('Command is required'),
    body('text').optional(),
    body('user_id').notEmpty().withMessage('User ID is required'),
    body('channel_id').notEmpty().withMessage('Channel ID is required'),
    body('response_url').optional(),
    body('trigger_id').optional()
  ],
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      logger.warn('Slack command validation failed', {
        errors: errors.array(),
        body: req.body
      });
      return res.status(400).json({ 
        response_type: 'ephemeral',
        text: 'Invalid command format'
      });
    }

    const { command, text, user_id, channel_id, response_url, trigger_id } = req.body;

    logger.slack('slash_command', channel_id, user_id, {
      command,
      text,
      response_url: !!response_url,
      trigger_id: !!trigger_id
    });

    try {
      // Process the slash command
      const response = await slackService.handleSlashCommand({
        command,
        text,
        user_id,
        channel_id,
        response_url,
        trigger_id
      });

      res.json(response);
    } catch (error) {
      logger.error('Error processing slash command:', error);
      res.json({
        response_type: 'ephemeral',
        text: 'Sorry, I encountered an error processing your command. Please try again.'
      });
    }
  })
);

// Handle Slack interactive components (buttons, menus, etc.)
router.post('/interactive',
  verifySlackSignature,
  asyncHandler(async (req, res) => {
    const payload = JSON.parse(req.body.payload);
    
    logger.slack('interactive_component', payload.channel?.id || 'unknown', payload.user?.id || 'unknown', {
      type: payload.type,
      callback_id: payload.callback_id,
      action_id: payload.actions?.[0]?.action_id
    });

    try {
      // Process the interactive component
      const response = await slackService.handleInteractiveComponent(payload);
      
      res.json(response);
    } catch (error) {
      logger.error('Error processing interactive component:', error);
      res.json({
        response_type: 'ephemeral',
        text: 'Sorry, I encountered an error processing your request.'
      });
    }
  })
);

// Handle Slack OAuth callback
router.get('/oauth/callback', asyncHandler(async (req, res) => {
  const { code, state, error } = req.query;

  if (error) {
    logger.error('Slack OAuth error:', { error, state });
    return res.redirect('/auth/error?provider=slack&error=' + encodeURIComponent(error));
  }

  if (!code) {
    logger.error('Slack OAuth missing code');
    return res.redirect('/auth/error?provider=slack&error=missing_code');
  }

  try {
    // Exchange code for access token
    const result = await slackService.handleOAuthCallback(code, state);
    
    logger.info('Slack OAuth successful', {
      team_id: result.team_id,
      team_name: result.team_name,
      user_id: result.user_id
    });

    // Redirect to success page or dashboard
    res.redirect('/auth/success?provider=slack&team=' + encodeURIComponent(result.team_name));
  } catch (error) {
    logger.error('Slack OAuth callback error:', error);
    res.redirect('/auth/error?provider=slack&error=oauth_failed');
  }
}));

// Get workspace information
router.get('/workspace', asyncHandler(async (req, res) => {
  try {
    const workspaceInfo = await slackService.getWorkspaceInfo();
    res.json({
      success: true,
      data: workspaceInfo
    });
  } catch (error) {
    logger.error('Error getting workspace info:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get workspace information'
    });
  }
}));

// Get channel list
router.get('/channels', asyncHandler(async (req, res) => {
  try {
    const channels = await slackService.getAllChannels();
    res.json({
      success: true,
      data: channels
    });
  } catch (error) {
    logger.error('Error getting channels:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get channels'
    });
  }
}));

// Send message to channel
router.post('/message',
  [
    body('channel').notEmpty().withMessage('Channel is required'),
    body('text').notEmpty().withMessage('Message text is required'),
    body('thread_ts').optional(),
    body('attachments').optional().isArray(),
    body('blocks').optional().isArray()
  ],
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        errors: errors.array()
      });
    }

    const { channel, text, thread_ts, attachments, blocks } = req.body;

    try {
      const result = await slackService.sendMessage({
        channel,
        text,
        thread_ts,
        attachments,
        blocks
      });

      logger.slack('message_sent', channel, 'bot', {
        thread_ts: !!thread_ts,
        has_attachments: !!attachments,
        has_blocks: !!blocks
      });

      res.json({
        success: true,
        data: result
      });
    } catch (error) {
      logger.error('Error sending message:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to send message'
      });
    }
  })
);

// Broadcast message to multiple channels
router.post('/broadcast',
  [
    body('message').notEmpty().withMessage('Message is required'),
    body('channels').optional().isArray(),
    body('exclude_channels').optional().isArray()
  ],
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        errors: errors.array()
      });
    }

    const { message, channels, exclude_channels } = req.body;

    try {
      const result = await slackService.broadcastMessage(message, channels, exclude_channels);
      
      logger.slack('broadcast_sent', 'multiple', 'admin', {
        message_length: message.length,
        channels_count: channels?.length || 'all',
        successful: result.successful,
        failed: result.failed
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

// Get user information
router.get('/users/:userId', asyncHandler(async (req, res) => {
  const { userId } = req.params;

  try {
    const userInfo = await slackService.getUserInfo(userId);
    
    if (!userInfo) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    res.json({
      success: true,
      data: userInfo
    });
  } catch (error) {
    logger.error('Error getting user info:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get user information'
    });
  }
}));

// Get conversation history
router.get('/conversations/:channelId/history', asyncHandler(async (req, res) => {
  const { channelId } = req.params;
  const { limit = 100, latest, oldest, inclusive = false } = req.query;

  try {
    const history = await slackService.getConversationHistory(channelId, {
      limit: parseInt(limit),
      latest,
      oldest,
      inclusive: inclusive === 'true'
    });

    res.json({
      success: true,
      data: history
    });
  } catch (error) {
    logger.error('Error getting conversation history:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get conversation history'
    });
  }
}));

// Upload file
router.post('/files/upload',
  asyncHandler(async (req, res) => {
    // This would typically use multer for file uploads
    // For now, we'll handle it as a simplified version
    
    const { channel, title, content, filetype = 'text' } = req.body;

    if (!channel || (!title && !content)) {
      return res.status(400).json({
        success: false,
        error: 'Channel and either title or content are required'
      });
    }

    try {
      const result = await slackService.uploadFile({
        channel,
        title,
        content,
        filetype
      });

      logger.slack('file_uploaded', channel, 'bot', {
        title,
        filetype,
        content_length: content?.length || 0
      });

      res.json({
        success: true,
        data: result
      });
    } catch (error) {
      logger.error('Error uploading file:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to upload file'
      });
    }
  })
);

// Get bot statistics
router.get('/stats', asyncHandler(async (req, res) => {
  try {
    const stats = await slackService.getBotStats();
    res.json({
      success: true,
      data: stats
    });
  } catch (error) {
    logger.error('Error getting bot stats:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get bot statistics'
    });
  }
}));

// Health check for Slack service
router.get('/health', asyncHandler(async (req, res) => {
  try {
    const health = await slackService.getHealthStatus();
    res.json({
      success: true,
      data: health
    });
  } catch (error) {
    logger.error('Error checking Slack service health:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to check Slack service health'
    });
  }
}));

module.exports = router; 