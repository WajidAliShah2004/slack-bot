const { ConfidentialClientApplication } = require('@azure/msal-node');
const jwt = require('jsonwebtoken');
const axios = require('axios');
const logger = require('../utils/logger');
const { PrismaClient } = require('@prisma/client');

class AzureAuthService {
  constructor() {
    this.prisma = new PrismaClient();
    this.msalConfig = {
      auth: {
        clientId: process.env.AZURE_CLIENT_ID,
        clientSecret: process.env.AZURE_CLIENT_SECRET,
        authority: `https://login.microsoftonline.com/${process.env.AZURE_TENANT_ID}`,
      },
      system: {
        loggerOptions: {
          loggerCallback: (level, message, containsPii) => {
            if (containsPii) {
              return;
            }
            switch (level) {
              case 0:
                logger.error(message);
                break;
              case 1:
                logger.warn(message);
                break;
              case 2:
                logger.info(message);
                break;
              case 3:
                logger.debug(message);
                break;
              default:
                logger.debug(message);
                break;
            }
          },
          logLevel: 2,
        },
      },
    };
    
    this.msalClient = null;
    this.isInitialized = false;
  }

  async initialize() {
    try {
      // Validate required environment variables
      if (!process.env.AZURE_CLIENT_ID || !process.env.AZURE_CLIENT_SECRET || !process.env.AZURE_TENANT_ID) {
        throw new Error('Azure AD configuration is incomplete. Please check environment variables.');
      }

      // Initialize MSAL client
      this.msalClient = new ConfidentialClientApplication(this.msalConfig);
      
      this.isInitialized = true;
      logger.info('Azure AD service initialized successfully');
      
    } catch (error) {
      logger.error('Failed to initialize Azure AD service:', error);
      throw error;
    }
  }

  async getAuthUrl(redirectUri, state = null, scopes = ['User.Read', 'email', 'profile']) {
    try {
      const authUrlParameters = {
        scopes: scopes,
        redirectUri: redirectUri,
        state: state || this.generateState(),
        prompt: 'select_account',
      };

      const response = await this.msalClient.getAuthCodeUrl(authUrlParameters);
      
      logger.info('Generated Azure AD authorization URL');
      return {
        url: response,
        state: authUrlParameters.state
      };
      
    } catch (error) {
      logger.error('Error generating auth URL:', error);
      throw error;
    }
  }

  async handleAuthCallback(authCode, redirectUri) {
    try {
      const tokenRequest = {
        code: authCode,
        scopes: ['User.Read', 'email', 'profile'],
        redirectUri: redirectUri,
      };

      const response = await this.msalClient.acquireTokenByCode(tokenRequest);
      
      if (response && response.account) {
        // Get user profile from Microsoft Graph
        const userProfile = await this.getUserProfile(response.accessToken);
        
        // Store or update user in database
        const user = await this.upsertUser(response.account, userProfile, response.accessToken);
        
        // Generate JWT token for our application
        const jwtToken = this.generateJWT(user, response.accessToken);
        
        logger.info(`User authenticated successfully: ${user.email}`);
        
        return {
          user,
          accessToken: response.accessToken,
          jwtToken,
          expiresIn: response.expiresIn
        };
      } else {
        throw new Error('Failed to acquire token from Azure AD');
      }
      
    } catch (error) {
      logger.error('Error handling auth callback:', error);
      throw error;
    }
  }

  async getUserProfile(accessToken) {
    try {
      const response = await axios.get('https://graph.microsoft.com/v1.0/me', {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        }
      });

      return response.data;
      
    } catch (error) {
      logger.error('Error fetching user profile from Microsoft Graph:', error);
      throw error;
    }
  }

  async upsertUser(account, profile, accessToken) {
    try {
      const userData = {
        azureId: account.homeAccountId,
        email: profile.mail || profile.userPrincipalName,
        displayName: profile.displayName,
        givenName: profile.givenName,
        surname: profile.surname,
        jobTitle: profile.jobTitle,
        department: profile.department,
        officeLocation: profile.officeLocation,
        mobilePhone: profile.mobilePhone,
        businessPhones: profile.businessPhones ? JSON.stringify(profile.businessPhones) : null,
        accessToken: this.encryptToken(accessToken),
        lastLoginAt: new Date(),
        isActive: true
      };

      const user = await this.prisma.user.upsert({
        where: { azureId: account.homeAccountId },
        update: userData,
        create: userData
      });

      // Log the authentication
      await this.prisma.authLog.create({
        data: {
          userId: user.id,
          action: 'login',
          ipAddress: 'unknown', // Would be passed from request
          userAgent: 'unknown', // Would be passed from request
          success: true,
          metadata: JSON.stringify({ provider: 'azure_ad', accountId: account.homeAccountId })
        }
      });

      return user;
      
    } catch (error) {
      logger.error('Error upserting user:', error);
      throw error;
    }
  }

  generateJWT(user, azureToken) {
    try {
      const payload = {
        userId: user.id,
        email: user.email,
        displayName: user.displayName,
        azureId: user.azureId,
        permissions: user.permissions || [],
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + (60 * 60 * 24), // 24 hours
        iss: 'smart-slack-bot',
        aud: 'smart-slack-bot-users'
      };

      return jwt.sign(payload, process.env.JWT_SECRET || 'your-secret-key', { algorithm: 'HS256' });
      
    } catch (error) {
      logger.error('Error generating JWT:', error);
      throw error;
    }
  }

  verifyJWT(token) {
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key', {
        algorithms: ['HS256'],
        issuer: 'smart-slack-bot',
        audience: 'smart-slack-bot-users'
      });

      return decoded;
      
    } catch (error) {
      logger.error('Error verifying JWT:', error);
      return null;
    }
  }

  async refreshToken(refreshToken) {
    try {
      const response = await this.msalClient.acquireTokenByRefreshToken({
        refreshToken: refreshToken,
        scopes: ['User.Read', 'email', 'profile']
      });

      if (response && response.account) {
        // Update user's access token in database
        await this.prisma.user.update({
          where: { azureId: response.account.homeAccountId },
          data: {
            accessToken: this.encryptToken(response.accessToken),
            lastLoginAt: new Date()
          }
        });

        return {
          accessToken: response.accessToken,
          expiresIn: response.expiresIn
        };
      } else {
        throw new Error('Failed to refresh token');
      }
      
    } catch (error) {
      logger.error('Error refreshing token:', error);
      throw error;
    }
  }

  async getUserGroups(accessToken) {
    try {
      const response = await axios.get('https://graph.microsoft.com/v1.0/me/memberOf', {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        }
      });

      return response.data.value;
      
    } catch (error) {
      logger.error('Error fetching user groups:', error);
      return [];
    }
  }

  async checkUserPermission(userId, permission) {
    try {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        include: { permissions: true }
      });

      if (!user) {
        return false;
      }

      // Check if user has the specific permission
      const hasPermission = user.permissions.some(p => p.name === permission);
      
      // Also check if user is admin
      const isAdmin = user.permissions.some(p => p.name === 'admin');
      
      return hasPermission || isAdmin;
      
    } catch (error) {
      logger.error('Error checking user permission:', error);
      return false;
    }
  }

  async revokeUserAccess(userId) {
    try {
      await this.prisma.user.update({
        where: { id: userId },
        data: {
          isActive: false,
          accessToken: null,
          revokedAt: new Date()
        }
      });

      // Log the revocation
      await this.prisma.authLog.create({
        data: {
          userId: userId,
          action: 'revoke',
          ipAddress: 'system',
          userAgent: 'system',
          success: true,
          metadata: JSON.stringify({ reason: 'admin_revocation' })
        }
      });

      logger.info(`User access revoked: ${userId}`);
      
    } catch (error) {
      logger.error('Error revoking user access:', error);
      throw error;
    }
  }

  async getActiveUsers() {
    try {
      const users = await this.prisma.user.findMany({
        where: { isActive: true },
        select: {
          id: true,
          email: true,
          displayName: true,
          department: true,
          jobTitle: true,
          lastLoginAt: true,
          createdAt: true
        },
        orderBy: { lastLoginAt: 'desc' }
      });

      return users;
      
    } catch (error) {
      logger.error('Error fetching active users:', error);
      throw error;
    }
  }

  async getAuthLogs(userId = null, limit = 100) {
    try {
      const where = userId ? { userId } : {};
      
      const logs = await this.prisma.authLog.findMany({
        where,
        include: {
          user: {
            select: {
              email: true,
              displayName: true
            }
          }
        },
        orderBy: { createdAt: 'desc' },
        take: limit
      });

      return logs;
      
    } catch (error) {
      logger.error('Error fetching auth logs:', error);
      throw error;
    }
  }

  encryptToken(token) {
    // In production, use a proper encryption library
    // This is a simplified version for demonstration
    return Buffer.from(token).toString('base64');
  }

  decryptToken(encryptedToken) {
    // In production, use a proper decryption library
    // This is a simplified version for demonstration
    return Buffer.from(encryptedToken, 'base64').toString();
  }

  generateState() {
    return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
  }

  async validateToken(token) {
    try {
      // Decode the JWT without verification first to get the payload
      const decoded = jwt.decode(token);
      
      if (!decoded) {
        return false;
      }

      // Check if token is expired
      if (decoded.exp && decoded.exp < Math.floor(Date.now() / 1000)) {
        return false;
      }

      // Verify the token signature
      const verified = this.verifyJWT(token);
      
      if (!verified) {
        return false;
      }

      // Check if user is still active
      const user = await this.prisma.user.findUnique({
        where: { id: verified.userId }
      });

      return user && user.isActive;
      
    } catch (error) {
      logger.error('Error validating token:', error);
      return false;
    }
  }

  async logout(userId) {
    try {
      // Clear the access token
      await this.prisma.user.update({
        where: { id: userId },
        data: {
          accessToken: null,
          lastLogoutAt: new Date()
        }
      });

      // Log the logout
      await this.prisma.authLog.create({
        data: {
          userId: userId,
          action: 'logout',
          ipAddress: 'unknown',
          userAgent: 'unknown',
          success: true,
          metadata: JSON.stringify({ provider: 'azure_ad' })
        }
      });

      logger.info(`User logged out: ${userId}`);
      
    } catch (error) {
      logger.error('Error during logout:', error);
      throw error;
    }
  }
}

module.exports = AzureAuthService; 