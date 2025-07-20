const OpenAI = require('openai');
const logger = require('../utils/logger');
const { PrismaClient } = require('@prisma/client');
const Redis = require('redis');

class LLMService {
  constructor() {
    this.prisma = new PrismaClient();
    this.openai = null;
    this.redis = null;
    this.isInitialized = false;
    this.defaultModel = process.env.OPENAI_MODEL || 'gpt-4';
    this.maxTokens = 1000;
    this.temperature = 0.7;
  }

  async initialize() {
    try {
      // Validate OpenAI API key
      if (!process.env.OPENAI_API_KEY) {
        throw new Error('OpenAI API key is required');
      }

      // Initialize OpenAI client
      this.openai = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY,
      });

      // Initialize Redis for caching
      if (process.env.REDIS_URL) {
        this.redis = Redis.createClient({
          url: process.env.REDIS_URL
        });
        await this.redis.connect();
        logger.info('Redis connected for LLM caching');
      }

      this.isInitialized = true;
      logger.info('LLM service initialized successfully');
      
    } catch (error) {
      logger.error('Failed to initialize LLM service:', error);
      throw error;
    }
  }

  async generateResponse(prompt, options = {}) {
    try {
      const cacheKey = this.generateCacheKey(prompt, options);
      
      // Check cache first
      if (this.redis) {
        const cached = await this.redis.get(cacheKey);
        if (cached) {
          logger.info('LLM response served from cache');
          return JSON.parse(cached);
        }
      }

      const model = options.model || this.defaultModel;
      const maxTokens = options.maxTokens || this.maxTokens;
      const temperature = options.temperature || this.temperature;

      const completion = await this.openai.chat.completions.create({
        model: model,
        messages: [
          {
            role: 'system',
            content: this.getSystemPrompt(options.context)
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        max_tokens: maxTokens,
        temperature: temperature,
        top_p: 1,
        frequency_penalty: 0,
        presence_penalty: 0,
      });

      const response = completion.choices[0]?.message?.content || 'I apologize, but I was unable to generate a response.';

      // Cache the response
      if (this.redis) {
        await this.redis.setex(cacheKey, 3600, JSON.stringify(response)); // Cache for 1 hour
      }

      // Log the interaction
      await this.logLLMInteraction(prompt, response, model, options);

      return response;
      
    } catch (error) {
      logger.error('Error generating LLM response:', error);
      
      // Log the error
      await this.logLLMError(prompt, error, options);
      
      return this.getFallbackResponse(error);
    }
  }

  async summarizeText(text, options = {}) {
    try {
      const prompt = `Please provide a concise summary of the following text. Focus on the key points and main ideas:

${text}

Summary:`;

      const response = await this.generateResponse(prompt, {
        ...options,
        maxTokens: 300,
        temperature: 0.3,
        context: 'summarization'
      });

      return response;
      
    } catch (error) {
      logger.error('Error summarizing text:', error);
      return 'I apologize, but I encountered an error while summarizing the text.';
    }
  }

  async translateText(text, targetLanguage, options = {}) {
    try {
      const prompt = `Please translate the following text to ${targetLanguage}. Maintain the original meaning and tone:

${text}

Translation:`;

      const response = await this.generateResponse(prompt, {
        ...options,
        maxTokens: Math.max(text.length * 2, 500),
        temperature: 0.3,
        context: 'translation'
      });

      return response;
      
    } catch (error) {
      logger.error('Error translating text:', error);
      return 'I apologize, but I encountered an error while translating the text.';
    }
  }

  async analyzeSentiment(text, options = {}) {
    try {
      const prompt = `Please analyze the sentiment of the following text and provide:
1. Overall sentiment (positive, negative, neutral)
2. Confidence level (0-100%)
3. Key emotional indicators
4. Brief explanation

Text: ${text}

Analysis:`;

      const response = await this.generateResponse(prompt, {
        ...options,
        maxTokens: 400,
        temperature: 0.2,
        context: 'sentiment_analysis'
      });

      return response;
      
    } catch (error) {
      logger.error('Error analyzing sentiment:', error);
      return 'I apologize, but I encountered an error while analyzing the sentiment.';
    }
  }

  async extractKeyPoints(text, options = {}) {
    try {
      const prompt = `Please extract the key points from the following text. Present them as a numbered list:

${text}

Key Points:`;

      const response = await this.generateResponse(prompt, {
        ...options,
        maxTokens: 500,
        temperature: 0.2,
        context: 'key_points_extraction'
      });

      return response;
      
    } catch (error) {
      logger.error('Error extracting key points:', error);
      return 'I apologize, but I encountered an error while extracting key points.';
    }
  }

  async generateCodeExplanation(code, language, options = {}) {
    try {
      const prompt = `Please explain the following ${language} code in simple terms:

\`\`\`${language}
${code}
\`\`\`

Explanation:`;

      const response = await this.generateResponse(prompt, {
        ...options,
        maxTokens: 600,
        temperature: 0.3,
        context: 'code_explanation'
      });

      return response;
      
    } catch (error) {
      logger.error('Error generating code explanation:', error);
      return 'I apologize, but I encountered an error while explaining the code.';
    }
  }

  async generateMeetingSummary(transcript, options = {}) {
    try {
      const prompt = `Please create a comprehensive meeting summary from the following transcript. Include:
1. Main topics discussed
2. Key decisions made
3. Action items and assignments
4. Next steps
5. Important deadlines

Transcript:
${transcript}

Meeting Summary:`;

      const response = await this.generateResponse(prompt, {
        ...options,
        maxTokens: 800,
        temperature: 0.3,
        context: 'meeting_summary'
      });

      return response;
      
    } catch (error) {
      logger.error('Error generating meeting summary:', error);
      return 'I apologize, but I encountered an error while generating the meeting summary.';
    }
  }

  async answerQuestion(question, context = '', options = {}) {
    try {
      const prompt = context 
        ? `Context: ${context}\n\nQuestion: ${question}\n\nAnswer:`
        : `Question: ${question}\n\nAnswer:`;

      const response = await this.generateResponse(prompt, {
        ...options,
        maxTokens: 600,
        temperature: 0.4,
        context: 'qa'
      });

      return response;
      
    } catch (error) {
      logger.error('Error answering question:', error);
      return 'I apologize, but I encountered an error while answering your question.';
    }
  }

  async generateCreativeContent(prompt, contentType = 'general', options = {}) {
    try {
      const systemPrompts = {
        'email': 'You are a professional email writer. Write clear, concise, and professional emails.',
        'blog': 'You are a creative blog writer. Write engaging and informative blog content.',
        'social': 'You are a social media expert. Write engaging social media posts.',
        'presentation': 'You are a presentation expert. Create compelling presentation content.',
        'general': 'You are a creative content writer. Generate engaging and useful content.'
      };

      const systemPrompt = systemPrompts[contentType] || systemPrompts.general;

      const response = await this.generateResponse(prompt, {
        ...options,
        maxTokens: 800,
        temperature: 0.8,
        context: `creative_${contentType}`,
        systemPrompt
      });

      return response;
      
    } catch (error) {
      logger.error('Error generating creative content:', error);
      return 'I apologize, but I encountered an error while generating creative content.';
    }
  }

  getSystemPrompt(context = 'general') {
    const basePrompt = `You are a helpful AI assistant integrated into a Slack workspace. You help users with various tasks including answering questions, summarizing text, translating content, analyzing sentiment, and providing intelligent responses.

Guidelines:
- Be helpful, friendly, and professional
- Provide concise but comprehensive responses
- Use appropriate formatting for Slack (bold, italic, lists)
- If you're unsure about something, say so
- Always be respectful and inclusive
- Provide actionable advice when appropriate`;

    const contextPrompts = {
      'summarization': 'Focus on extracting the most important information and presenting it clearly.',
      'translation': 'Provide accurate translations while maintaining the original meaning and tone.',
      'sentiment_analysis': 'Provide objective analysis with clear reasoning for your assessment.',
      'key_points_extraction': 'Identify and list the most important points in a clear, organized manner.',
      'code_explanation': 'Explain code in simple terms that non-technical users can understand.',
      'meeting_summary': 'Create structured summaries that highlight decisions, action items, and next steps.',
      'qa': 'Provide accurate, helpful answers based on available information.',
      'creative_general': 'Be creative and engaging while maintaining professionalism.'
    };

    const contextPrompt = contextPrompts[context] || '';
    
    return `${basePrompt}\n\n${contextPrompt}`;
  }

  generateCacheKey(prompt, options) {
    const keyData = {
      prompt: prompt.substring(0, 100), // Limit prompt length for cache key
      model: options.model || this.defaultModel,
      maxTokens: options.maxTokens || this.maxTokens,
      temperature: options.temperature || this.temperature,
      context: options.context || 'general'
    };
    
    return `llm:${Buffer.from(JSON.stringify(keyData)).toString('base64')}`;
  }

  async logLLMInteraction(prompt, response, model, options) {
    try {
      await this.prisma.llmInteraction.create({
        data: {
          prompt: prompt.substring(0, 2000), // Limit length
          response: response.substring(0, 2000), // Limit length
          model: model,
          context: options.context || 'general',
          tokensUsed: response.length / 4, // Rough estimate
          processingTime: options.processingTime || 0,
          userId: options.userId || null,
          channelId: options.channelId || null,
          success: true,
          metadata: JSON.stringify(options)
        }
      });
    } catch (error) {
      logger.error('Error logging LLM interaction:', error);
    }
  }

  async logLLMError(prompt, error, options) {
    try {
      await this.prisma.llmInteraction.create({
        data: {
          prompt: prompt.substring(0, 2000),
          response: error.message,
          model: options.model || this.defaultModel,
          context: options.context || 'general',
          tokensUsed: 0,
          processingTime: 0,
          userId: options.userId || null,
          channelId: options.channelId || null,
          success: false,
          metadata: JSON.stringify({ error: error.message, ...options })
        }
      });
    } catch (logError) {
      logger.error('Error logging LLM error:', logError);
    }
  }

  getFallbackResponse(error) {
    const fallbackResponses = [
      "I apologize, but I'm having trouble processing your request right now. Please try again in a moment.",
      "I encountered an error while processing your request. Please rephrase your question or try again later.",
      "I'm experiencing some technical difficulties. Please try again or contact support if the issue persists.",
      "I apologize for the inconvenience. There was an error processing your request. Please try again."
    ];

    const randomIndex = Math.floor(Math.random() * fallbackResponses.length);
    return fallbackResponses[randomIndex];
  }

  async getUsageStats(days = 30) {
    try {
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);

      const stats = await this.prisma.llmInteraction.groupBy({
        by: ['model', 'context', 'success'],
        where: {
          createdAt: {
            gte: startDate
          }
        },
        _count: {
          id: true
        },
        _sum: {
          tokensUsed: true
        }
      });

      return stats;
      
    } catch (error) {
      logger.error('Error getting usage stats:', error);
      return [];
    }
  }

  async clearCache() {
    try {
      if (this.redis) {
        const keys = await this.redis.keys('llm:*');
        if (keys.length > 0) {
          await this.redis.del(keys);
          logger.info(`Cleared ${keys.length} LLM cache entries`);
        }
      }
    } catch (error) {
      logger.error('Error clearing cache:', error);
    }
  }

  async shutdown() {
    try {
      if (this.redis) {
        await this.redis.quit();
        logger.info('Redis connection closed');
      }
      
      if (this.prisma) {
        await this.prisma.$disconnect();
        logger.info('Database connection closed');
      }
      
    } catch (error) {
      logger.error('Error during LLM service shutdown:', error);
    }
  }
}

module.exports = LLMService; 