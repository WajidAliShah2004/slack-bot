const { App } = require('@slack/bolt');
const { WebClient } = require('@slack/web-api');
const crypto = require('crypto');
const logger = require('../utils/logger');
const { PrismaClient } = require('@prisma/client');

class SlackService {
  constructor() {
    this.prisma = new PrismaClient();
    this.app = null;
    this.webClient = null;
    this.isInitialized = false;
  }

  async initialize() {
    try {
      // Initialize Slack app
      this.app = new App({
        token: process.env.SLACK_BOT_TOKEN,
        signingSecret: process.env.SLACK_SIGNING_SECRET,
        socketMode: process.env.NODE_ENV === 'development',
        appToken: process.env.SLACK_APP_TOKEN,
        port: process.env.SLACK_PORT || 3000,
      });

      // Initialize Web API client
      this.webClient = new WebClient(process.env.SLACK_BOT_TOKEN);

      // Register event handlers
      this.registerEventHandlers();
      
      // Register command handlers
      this.registerCommandHandlers();

      // Start the app
      await this.app.start();
      
      this.isInitialized = true;
      logger.info('Slack service initialized successfully');
      
      // Test connection
      const authTest = await this.webClient.auth.test();
      logger.info(`Connected to Slack workspace: ${authTest.team}`);
      
    } catch (error) {
      logger.error('Failed to initialize Slack service:', error);
      throw error;
    }
  }

  registerEventHandlers() {
    // Handle app mentions
    this.app.event('app_mention', async ({ event, say, client }) => {
      try {
        logger.info(`App mentioned in channel ${event.channel} by ${event.user}`);
        
        // Process the mention with LLM
        const response = await this.processMessageWithLLM(event.text, event.user, event.channel);
        
        await say({
          text: response,
          thread_ts: event.thread_ts || event.ts
        });
        
        // Log the interaction
        await this.logInteraction(event, 'app_mention', response);
        
      } catch (error) {
        logger.error('Error handling app mention:', error);
        await say({
          text: 'Sorry, I encountered an error processing your request. Please try again.',
          thread_ts: event.thread_ts || event.ts
        });
      }
    });

    // Handle direct messages
    this.app.event('message', async ({ event, say, client }) => {
      try {
        // Only handle direct messages (not in channels)
        if (event.channel_type === 'im' && !event.bot_id) {
          logger.info(`Direct message from ${event.user}: ${event.text}`);
          
          const response = await this.processMessageWithLLM(event.text, event.user, event.channel);
          
          await say({
            text: response
          });
          
          await this.logInteraction(event, 'direct_message', response);
        }
      } catch (error) {
        logger.error('Error handling direct message:', error);
        await say({
          text: 'Sorry, I encountered an error. Please try again.'
        });
      }
    });

    // Handle file uploads
    this.app.event('file_shared', async ({ event, say, client }) => {
      try {
        logger.info(`File shared: ${event.file.name} by ${event.user_id}`);
        
        const response = await this.processFileUpload(event.file, event.user_id, event.channel_id);
        
        await say({
          text: response,
          thread_ts: event.thread_ts
        });
        
        await this.logInteraction(event, 'file_shared', response);
        
      } catch (error) {
        logger.error('Error handling file upload:', error);
      }
    });

    // Handle reactions
    this.app.event('reaction_added', async ({ event, say, client }) => {
      try {
        logger.info(`Reaction added: ${event.reaction} by ${event.user}`);
        
        // Handle specific reactions
        if (event.reaction === 'thumbsup') {
          await this.handleThumbsUpReaction(event, say);
        }
        
      } catch (error) {
        logger.error('Error handling reaction:', error);
      }
    });

    // Handle team join events
    this.app.event('team_join', async ({ event, say, client }) => {
      try {
        logger.info(`New team member joined: ${event.user.name}`);
        
        // Send welcome message
        await this.sendWelcomeMessage(event.user.id);
        
      } catch (error) {
        logger.error('Error handling team join:', error);
      }
    });
  }

  registerCommandHandlers() {
    // Help command
    this.app.command('/help', async ({ command, ack, say }) => {
      await ack();
      
      const helpText = `🤖 *Smart Slack Bot Help*

*Available Commands:*
• \`/help\` - Show this help message
• \`/ask <question>\` - Ask me anything
• \`/summarize <text>\` - Summarize text or conversation
• \`/translate <text> <language>\` - Translate text
• \`/analyze <text>\` - Analyze sentiment and key points
• \`/remind <time> <message>\` - Set a reminder

*Features:*
• Mention me (@bot) in any channel for assistance
• Send me direct messages for private conversations
• I can process files, analyze text, and provide intelligent responses
• Azure AD integration for secure authentication

*Examples:*
• \`/ask What's the weather like today?\`
• \`/summarize This is a long text that needs summarization\`
• \`/translate Hello world to Spanish\`

Need more help? Contact your administrator.`;
      
      await say({
        text: helpText,
        response_type: 'ephemeral'
      });
    });

    // Ask command
    this.app.command('/ask', async ({ command, ack, say }) => {
      await ack();
      
      try {
        const question = command.text;
        if (!question) {
          await say({
            text: 'Please provide a question. Usage: `/ask <your question>`',
            response_type: 'ephemeral'
          });
          return;
        }
        
        const response = await this.processMessageWithLLM(question, command.user_id, command.channel_id);
        
        await say({
          text: response,
          response_type: 'in_channel'
        });
        
        await this.logInteraction(command, 'slash_command', response);
        
      } catch (error) {
        logger.error('Error handling /ask command:', error);
        await say({
          text: 'Sorry, I encountered an error processing your question.',
          response_type: 'ephemeral'
        });
      }
    });

    // Summarize command
    this.app.command('/summarize', async ({ command, ack, say }) => {
      await ack();
      
      try {
        const text = command.text;
        if (!text) {
          await say({
            text: 'Please provide text to summarize. Usage: `/summarize <text>`',
            response_type: 'ephemeral'
          });
          return;
        }
        
        const prompt = `Please provide a concise summary of the following text:\n\n${text}`;
        const response = await this.processMessageWithLLM(prompt, command.user_id, command.channel_id);
        
        await say({
          text: `📝 *Summary:*\n${response}`,
          response_type: 'in_channel'
        });
        
        await this.logInteraction(command, 'slash_command', response);
        
      } catch (error) {
        logger.error('Error handling /summarize command:', error);
        await say({
          text: 'Sorry, I encountered an error summarizing the text.',
          response_type: 'ephemeral'
        });
      }
    });
  }

  async processMessageWithLLM(message, userId, channelId) {
    try {
      // Get user context
      const user = await this.getUserInfo(userId);
      const channel = await this.getChannelInfo(channelId);
      
      // Create context-aware prompt
      const context = `You are a helpful AI assistant in a Slack workspace. 
User: ${user?.real_name || 'Unknown'} (${user?.email || 'No email'})
Channel: ${channel?.name || 'Direct message'}
Current time: ${new Date().toISOString()}

Please provide a helpful, concise response to the following message:`;

      const fullPrompt = `${context}\n\nUser message: ${message}`;
      
      // Call LLM service (this would be implemented in LLMService)
      const LLMService = require('./llmService');
      const llmService = new LLMService();
      const response = await llmService.generateResponse(fullPrompt);
      
      return response;
      
    } catch (error) {
      logger.error('Error processing message with LLM:', error);
      return 'I apologize, but I encountered an error processing your request. Please try again.';
    }
  }

  async processFileUpload(file, userId, channelId) {
    try {
      const fileInfo = await this.webClient.files.info({ file: file.id });
      
      if (fileInfo.file.filetype === 'text') {
        // Process text files
        const content = await this.downloadFileContent(file.url_private);
        return `📄 I've processed the text file "${file.name}". Here's what I found:\n\n${content.substring(0, 500)}...`;
      } else if (fileInfo.file.filetype.startsWith('image/')) {
        // Process images
        return `🖼️ I can see you've uploaded an image: "${file.name}". I'm working on image processing capabilities!`;
      } else {
        return `📎 I've received your file: "${file.name}". I'm still learning to process this file type.`;
      }
      
    } catch (error) {
      logger.error('Error processing file upload:', error);
      return 'Sorry, I encountered an error processing your file.';
    }
  }

  async handleThumbsUpReaction(event, say) {
    try {
      // Get the message that was reacted to
      const message = await this.webClient.conversations.history({
        channel: event.item.channel,
        latest: event.item.ts,
        limit: 1,
        inclusive: true
      });
      
      if (message.messages && message.messages[0]) {
        const reactedMessage = message.messages[0];
        await say({
          text: `👍 Thanks for the thumbs up! I'm glad I could help with: "${reactedMessage.text.substring(0, 100)}..."`,
          thread_ts: event.item.ts
        });
      }
      
    } catch (error) {
      logger.error('Error handling thumbs up reaction:', error);
    }
  }

  async sendWelcomeMessage(userId) {
    try {
      const welcomeMessage = `🎉 Welcome to the team! I'm your AI assistant, here to help you with:

• Answering questions and providing information
• Summarizing text and conversations
• Translating messages
• Analyzing content and sentiment
• Setting reminders and managing tasks

Just mention me (@bot) in any channel or send me a direct message to get started!

Type \`/help\` to see all available commands.`;

      await this.webClient.chat.postMessage({
        channel: userId,
        text: welcomeMessage
      });
      
    } catch (error) {
      logger.error('Error sending welcome message:', error);
    }
  }

  async getUserInfo(userId) {
    try {
      const user = await this.webClient.users.info({ user: userId });
      return user.user;
    } catch (error) {
      logger.error('Error getting user info:', error);
      return null;
    }
  }

  async getChannelInfo(channelId) {
    try {
      const channel = await this.webClient.conversations.info({ channel: channelId });
      return channel.channel;
    } catch (error) {
      logger.error('Error getting channel info:', error);
      return null;
    }
  }

  async downloadFileContent(url) {
    try {
      const response = await this.webClient.files.getUploadUrlExternalFile({
        external_url: url,
        external_id: 'temp',
        title: 'Downloaded file'
      });
      
      // This is a simplified version - in production you'd handle the actual file download
      return 'File content would be downloaded and processed here.';
      
    } catch (error) {
      logger.error('Error downloading file content:', error);
      return 'Unable to process file content.';
    }
  }

  async logInteraction(event, type, response) {
    try {
      await this.prisma.interaction.create({
        data: {
          type,
          userId: event.user || event.user_id,
          channelId: event.channel || event.channel_id,
          message: event.text || event.message || '',
          response: response.substring(0, 1000), // Limit response length
          timestamp: new Date(),
          metadata: JSON.stringify(event)
        }
      });
    } catch (error) {
      logger.error('Error logging interaction:', error);
    }
  }

  async verifyWebhookSignature(signature, timestamp, body) {
    try {
      const baseString = `v0:${timestamp}:${body}`;
      const expectedSignature = 'v0=' + crypto
        .createHmac('sha256', process.env.SLACK_SIGNING_SECRET)
        .update(baseString)
        .digest('hex');
      
      return crypto.timingSafeEqual(
        Buffer.from(signature),
        Buffer.from(expectedSignature)
      );
    } catch (error) {
      logger.error('Error verifying webhook signature:', error);
      return false;
    }
  }

  async broadcastMessage(message, channels = []) {
    try {
      const targetChannels = channels.length > 0 ? channels : await this.getAllChannels();
      
      const results = await Promise.allSettled(
        targetChannels.map(channel => 
          this.webClient.chat.postMessage({
            channel: channel.id,
            text: message
          })
        )
      );
      
      const successful = results.filter(r => r.status === 'fulfilled').length;
      const failed = results.filter(r => r.status === 'rejected').length;
      
      logger.info(`Broadcast completed: ${successful} successful, ${failed} failed`);
      
      return { successful, failed, results };
      
    } catch (error) {
      logger.error('Error broadcasting message:', error);
      throw error;
    }
  }

  async getAllChannels() {
    try {
      const result = await this.webClient.conversations.list({
        types: 'public_channel,private_channel'
      });
      
      return result.channels || [];
    } catch (error) {
      logger.error('Error getting all channels:', error);
      return [];
    }
  }

  async shutdown() {
    try {
      if (this.app) {
        await this.app.stop();
        logger.info('Slack app stopped');
      }
      
      if (this.prisma) {
        await this.prisma.$disconnect();
        logger.info('Database connection closed');
      }
      
    } catch (error) {
      logger.error('Error during Slack service shutdown:', error);
    }
  }
}

module.exports = SlackService; 