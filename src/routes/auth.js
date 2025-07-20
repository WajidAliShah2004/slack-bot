const express = require('express');
const { body, validationResult } = require('express-validator');
const logger = require('../utils/logger');
const { asyncHandler } = require('../middleware/errorHandler');
const AzureAuthService = require('../services/azureAuthService');

const router = express.Router();
const azureAuthService = new AzureAuthService();

// Middleware to check if user is authenticated
const requireAuth = async (req, res, next) => {
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

    req.user = decoded;
    next();
  } catch (error) {
    logger.error('Authentication middleware error:', error);
    return res.status(401).json({
      success: false,
      error: 'Authentication failed'
    });
  }
};

// Middleware to check admin permissions
const requireAdmin = async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required'
      });
    }

    const hasPermission = await azureAuthService.checkUserPermission(req.user.userId, 'admin');
    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        error: 'Admin permission required'
      });
    }

    next();
  } catch (error) {
    logger.error('Admin permission check error:', error);
    return res.status(403).json({
      success: false,
      error: 'Permission check failed'
    });
  }
};

// Initiate Azure AD login
router.get('/azure', asyncHandler(async (req, res) => {
  try {
    const redirectUri = process.env.AZURE_REDIRECT_URI || `${req.protocol}://${req.get('host')}/auth/callback`;
    const state = req.query.state || req.session?.state;
    
    const authUrl = await azureAuthService.getAuthUrl(redirectUri, state);
    
    logger.azure('login_initiated', 'anonymous', {
      redirectUri,
      state: authUrl.state
    });

    // Store state in session for verification
    if (req.session) {
      req.session.state = authUrl.state;
    }

    res.json({
      success: true,
      data: {
        authUrl: authUrl.url,
        state: authUrl.state
      }
    });
  } catch (error) {
    logger.error('Error initiating Azure AD login:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to initiate authentication'
    });
  }
}));

// Handle Azure AD callback
router.get('/callback', asyncHandler(async (req, res) => {
  const { code, state, error } = req.query;

  if (error) {
    logger.error('Azure AD callback error:', { error, state });
    return res.redirect('/auth/error?error=' + encodeURIComponent(error));
  }

  if (!code) {
    logger.error('Azure AD callback missing code');
    return res.redirect('/auth/error?error=missing_code');
  }

  try {
    const redirectUri = process.env.AZURE_REDIRECT_URI || `${req.protocol}://${req.get('host')}/auth/callback`;
    const result = await azureAuthService.handleAuthCallback(code, redirectUri);
    
    logger.azure('login_successful', result.user.email, {
      userId: result.user.id,
      azureId: result.user.azureId
    });

    // Set JWT token in cookie
    res.cookie('jwt', result.jwtToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 24 * 60 * 60 * 1000 // 24 hours
    });

    // Redirect to success page or return token
    if (req.query.redirect) {
      res.redirect(req.query.redirect);
    } else {
      res.json({
        success: true,
        data: {
          user: {
            id: result.user.id,
            email: result.user.email,
            displayName: result.user.displayName,
            department: result.user.department,
            jobTitle: result.user.jobTitle
          },
          token: result.jwtToken,
          expiresIn: result.expiresIn
        }
      });
    }
  } catch (error) {
    logger.error('Azure AD callback processing error:', error);
    res.redirect('/auth/error?error=callback_failed');
  }
}));

// Logout
router.post('/logout', requireAuth, asyncHandler(async (req, res) => {
  try {
    await azureAuthService.logout(req.user.userId);
    
    logger.azure('logout_successful', req.user.email, {
      userId: req.user.userId
    });

    // Clear JWT cookie
    res.clearCookie('jwt');

    res.json({
      success: true,
      message: 'Logged out successfully'
    });
  } catch (error) {
    logger.error('Logout error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to logout'
    });
  }
}));

// Refresh token
router.post('/refresh', asyncHandler(async (req, res) => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      return res.status(400).json({
        success: false,
        error: 'Refresh token is required'
      });
    }

    const result = await azureAuthService.refreshToken(refreshToken);
    
    logger.azure('token_refreshed', 'user', {
      refreshToken: '***'
    });

    res.json({
      success: true,
      data: {
        accessToken: result.accessToken,
        expiresIn: result.expiresIn
      }
    });
  } catch (error) {
    logger.error('Token refresh error:', error);
    res.status(401).json({
      success: false,
      error: 'Failed to refresh token'
    });
  }
}));

// Get current user profile
router.get('/profile', requireAuth, asyncHandler(async (req, res) => {
  try {
    const user = await azureAuthService.getUserById(req.user.userId);
    
    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    res.json({
      success: true,
      data: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        givenName: user.givenName,
        surname: user.surname,
        jobTitle: user.jobTitle,
        department: user.department,
        officeLocation: user.officeLocation,
        mobilePhone: user.mobilePhone,
        lastLoginAt: user.lastLoginAt,
        createdAt: user.createdAt
      }
    });
  } catch (error) {
    logger.error('Error getting user profile:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get user profile'
    });
  }
}));

// Update user profile
router.put('/profile', 
  requireAuth,
  [
    body('displayName').optional().isLength({ min: 1, max: 100 }),
    body('jobTitle').optional().isLength({ min: 1, max: 100 }),
    body('department').optional().isLength({ min: 1, max: 100 }),
    body('officeLocation').optional().isLength({ min: 1, max: 100 }),
    body('mobilePhone').optional().isMobilePhone()
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
      const updatedUser = await azureAuthService.updateUserProfile(req.user.userId, req.body);
      
      logger.azure('profile_updated', req.user.email, {
        userId: req.user.userId,
        updatedFields: Object.keys(req.body)
      });

      res.json({
        success: true,
        data: updatedUser
      });
    } catch (error) {
      logger.error('Error updating user profile:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to update profile'
      });
    }
  })
);

// Get user permissions
router.get('/permissions', requireAuth, asyncHandler(async (req, res) => {
  try {
    const permissions = await azureAuthService.getUserPermissions(req.user.userId);
    
    res.json({
      success: true,
      data: permissions
    });
  } catch (error) {
    logger.error('Error getting user permissions:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get permissions'
    });
  }
}));

// Check specific permission
router.post('/check-permission',
  requireAuth,
  [
    body('permission').notEmpty().withMessage('Permission name is required')
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
      const { permission } = req.body;
      const hasPermission = await azureAuthService.checkUserPermission(req.user.userId, permission);
      
      res.json({
        success: true,
        data: {
          permission,
          hasPermission
        }
      });
    } catch (error) {
      logger.error('Error checking permission:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to check permission'
      });
    }
  })
);

// Admin routes
// Get all active users (admin only)
router.get('/users', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  try {
    const { page = 1, limit = 20, search, department } = req.query;
    
    const users = await azureAuthService.getActiveUsers({
      page: parseInt(page),
      limit: parseInt(limit),
      search,
      department
    });
    
    res.json({
      success: true,
      data: users
    });
  } catch (error) {
    logger.error('Error getting users:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get users'
    });
  }
}));

// Get user by ID (admin only)
router.get('/users/:userId', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  try {
    const { userId } = req.params;
    const user = await azureAuthService.getUserById(userId);
    
    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    res.json({
      success: true,
      data: user
    });
  } catch (error) {
    logger.error('Error getting user by ID:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get user'
    });
  }
}));

// Revoke user access (admin only)
router.post('/users/:userId/revoke', 
  requireAuth, 
  requireAdmin,
  asyncHandler(async (req, res) => {
    try {
      const { userId } = req.params;
      const { reason } = req.body;
      
      await azureAuthService.revokeUserAccess(userId, reason);
      
      logger.azure('user_revoked', 'admin', {
        targetUserId: userId,
        reason,
        adminUserId: req.user.userId
      });

      res.json({
        success: true,
        message: 'User access revoked successfully'
      });
    } catch (error) {
      logger.error('Error revoking user access:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to revoke user access'
      });
    }
  })
);

// Get authentication logs (admin only)
router.get('/logs', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  try {
    const { userId, action, limit = 100, page = 1 } = req.query;
    
    const logs = await azureAuthService.getAuthLogs(userId, {
      action,
      limit: parseInt(limit),
      page: parseInt(page)
    });
    
    res.json({
      success: true,
      data: logs
    });
  } catch (error) {
    logger.error('Error getting auth logs:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get authentication logs'
    });
  }
}));

// Get authentication statistics (admin only)
router.get('/stats', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  try {
    const { days = 30 } = req.query;
    
    const stats = await azureAuthService.getAuthStats(parseInt(days));
    
    res.json({
      success: true,
      data: stats
    });
  } catch (error) {
    logger.error('Error getting auth stats:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get authentication statistics'
    });
  }
}));

// Health check for auth service
router.get('/health', asyncHandler(async (req, res) => {
  try {
    const health = await azureAuthService.getHealthStatus();
    res.json({
      success: true,
      data: health
    });
  } catch (error) {
    logger.error('Error checking auth service health:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to check authentication service health'
    });
  }
}));

// Error page route
router.get('/error', (req, res) => {
  const { error } = req.query;
  
  logger.azure('auth_error', 'anonymous', {
    error: error || 'unknown'
  });

  res.status(400).json({
    success: false,
    error: error || 'Authentication failed',
    message: 'Please try logging in again'
  });
});

// Success page route
router.get('/success', (req, res) => {
  const { provider } = req.query;
  
  logger.azure('auth_success', 'user', {
    provider: provider || 'azure'
  });

  res.json({
    success: true,
    message: 'Authentication successful',
    provider: provider || 'azure'
  });
});

module.exports = router; 