// middlewares/superadmin.auth.js
import jwt from 'jsonwebtoken';
import SuperAdmin from '../models/superadmin.model.js';

export const authenticateSuperAdmin = async (req, res, next) => {
  try {
    console.log('🔐 [AUTH] Authentication middleware called for:', req.url);
    console.log('🔐 [AUTH] Authorization header:', req.header('Authorization'));
    
    const token = req.header('Authorization')?.replace('Bearer ', '');
    
    if (!token) {
      console.log('❌ [AUTH] No token provided');
      return res.status(401).json({
        success: false,
        message: 'Access denied. No token provided.'
      });
    }

    console.log('✅ [AUTH] Token found');

    // Verify token
    const decoded = jwt.verify(token, process.env.SUPERADMIN_JWT_SECRET);
    console.log('✅ [AUTH] Token decoded. Mobile:', decoded.mobile);
    
    // Find super admin
    const superadmin = await SuperAdmin.findOne({ mobile: decoded.mobile });
    
    if (!superadmin) {
      console.log('❌ [AUTH] SuperAdmin not found for mobile:', decoded.mobile);
      return res.status(401).json({
        success: false,
        message: 'Invalid token or account deactivated'
      });
    }

    if (!superadmin.isActive) {
      console.log('❌ [AUTH] SuperAdmin account inactive');
      return res.status(401).json({
        success: false,
        message: 'Account is deactivated'
      });
    }

    console.log('✅ [AUTH] SuperAdmin found:', superadmin.mobile);

    // Single Session Validation
    if (!superadmin.currentSession) {
      console.log('❌ [AUTH] No current session found');
      return res.status(401).json({
        success: false,
        message: 'Session expired. Please login again.'
      });
    }

    if (superadmin.currentSession.token !== decoded.sessionId) {
      console.log('❌ [AUTH] Session ID mismatch');
      return res.status(401).json({
        success: false,
        message: 'Session expired. Please login again.'
      });
    }

    console.log('✅ [AUTH] Authentication successful, attaching superadmin to request');
    
    // Attach to request
    req.superadmin = superadmin;
    next();
    
  } catch (error) {
    console.error('❌ [AUTH] Authentication error:', error.message);
    
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        message: 'Token expired. Please login again.'
      });
    }
    
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        success: false,
        message: 'Invalid token'
      });
    }
    
    res.status(401).json({
      success: false,
      message: 'Authentication failed'
    });
  }
};