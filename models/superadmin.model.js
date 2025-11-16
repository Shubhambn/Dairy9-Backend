// models/superadmin.model.js
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';

const superadminSchema = new mongoose.Schema({
  // Hardcoded mobile number - Only one superadmin
  mobile: {
    type: String,
    required: true,
    unique: true,
    default: process.env.SUPERADMIN_MOBILE || "+919876543210"
  },
  
  // OTP Fields
  otp: {
    type: String
  },
  otpExpires: {
    type: Date
  },
  otpAttempts: {
    type: Number,
    default: 0
  },
  otpBlockedUntil: {
    type: Date
  },
  
  // Session Management - Single Session
  currentSession: {
    token: String,
    deviceInfo: String,
    ipAddress: String,
    loggedInAt: Date
  },
  
  // Security
  isActive: {
    type: Boolean,
    default: true
  },
  
  // Dashboard Preferences
  dashboardPreferences: {
    defaultView: {
      type: String,
      enum: ['analytics', 'retailers', 'orders', 'reports'],
      default: 'analytics'
    },
    refreshInterval: {
      type: Number, // minutes
      default: 5
    },
    charts: {
      sales: { type: Boolean, default: true },
      users: { type: Boolean, default: true },
      inventory: { type: Boolean, default: true }
    }
  },
  
  // Audit Logs
  actionLogs: [{
    timestamp: { type: Date, default: Date.now },
    action: String,
    resource: String,
    resourceId: mongoose.Schema.Types.ObjectId,
    details: mongoose.Schema.Types.Mixed,
    ipAddress: String,
    userAgent: String
  }],
  
  loginHistory: [{
    timestamp: Date,
    deviceInfo: String,
    ipAddress: String,
    action: String // 'login', 'logout', 'forced_logout'
  }],
  
  permissions: {
    type: [String],
    default: [
      'users.manage',
      'retailers.manage', 
      'orders.view_all',
      'analytics.view',
      'system.configure'
    ]
  }
}, {
  timestamps: true
});

// Generate JWT with session ID
superadminSchema.methods.generateAuthToken = function(deviceInfo, ipAddress) {
  const sessionId = new mongoose.Types.ObjectId().toString();
  
  const payload = {
    sessionId,
    mobile: this.mobile,
    role: 'superadmin'
  };
  
  const token = jwt.sign(
    payload, 
    process.env.SUPERADMIN_JWT_SECRET,
    { expiresIn: '8h' }
  );
  
  // Store current session
  this.currentSession = {
    token: sessionId, // Store sessionId, not full token
    deviceInfo,
    ipAddress,
    loggedInAt: new Date()
  };
  
  return token;
};

// Check if OTP is blocked
superadminSchema.methods.isOTPBlocked = function() {
  return this.otpBlockedUntil && this.otpBlockedUntil > new Date();
};

// Increment OTP attempts
superadminSchema.methods.incrementOTPAttempts = async function() {
  this.otpAttempts += 1;
  
  if (this.otpAttempts >= 5) {
    // Block OTP for 30 minutes after 5 failed attempts
    this.otpBlockedUntil = new Date(Date.now() + 30 * 60 * 1000);
  }
  
  await this.save();
};

// Reset OTP attempts
superadminSchema.methods.resetOTPAttempts = async function() {
  this.otpAttempts = 0;
  this.otpBlockedUntil = undefined;
  await this.save();
};

// Logout from current session
superadminSchema.methods.logout = async function() {
  if (this.currentSession) {
    // Add to login history
    this.loginHistory.push({
      timestamp: new Date(),
      deviceInfo: this.currentSession.deviceInfo,
      ipAddress: this.currentSession.ipAddress,
      action: 'logout'
    });
    
    // Clear current session
    this.currentSession = undefined;
    await this.save();
  }
};

// Force logout (for new login)
superadminSchema.methods.forceLogout = async function() {
  if (this.currentSession) {
    // Log the forced logout
    this.loginHistory.push({
      timestamp: new Date(),
      deviceInfo: this.currentSession.deviceInfo,
      ipAddress: this.currentSession.ipAddress,
      action: 'forced_logout'
    });
  }
  
  // Clear current session for new login
  this.currentSession = undefined;
  await this.save();
};

// Add action logging method
superadminSchema.methods.logAction = async function(action, resource, resourceId = null, details = {}) {
  // Initialize actionLogs array if it doesn't exist
  if (!this.actionLogs) {
    this.actionLogs = [];
  }
  
  this.actionLogs.push({
    timestamp: new Date(),
    action,
    resource,
    resourceId,
    details,
    ipAddress: this.currentSession?.ipAddress || 'unknown',
    userAgent: this.currentSession?.deviceInfo || 'unknown'
  });
  
  // Keep only last 1000 logs to prevent database bloat
  if (this.actionLogs.length > 1000) {
    this.actionLogs = this.actionLogs.slice(-1000);
  }
  
  await this.save();
};

// Check if account is locked (for login attempts)
superadminSchema.methods.isLocked = function() {
  return !!(this.lockUntil && this.lockUntil > Date.now());
};

// Increment login attempts
superadminSchema.methods.incrementLoginAttempts = async function() {
  // If we have a previous lock that has expired, restart at 1
  if (this.lockUntil && this.lockUntil < Date.now()) {
    return await this.updateOne({
      $set: { loginAttempts: 1 },
      $unset: { lockUntil: 1 }
    });
  }
  
  // Otherwise increment
  const updates = { $inc: { loginAttempts: 1 } };
  
  // Lock the account if we've reached max attempts and it's not locked already
  if ((this.loginAttempts || 0) + 1 >= 5 && !this.isLocked()) {
    updates.$set = { lockUntil: Date.now() + 2 * 60 * 60 * 1000 }; // 2 hours
  }
  
  return await this.updateOne(updates);
};

// Static method to reset login attempts on successful login
superadminSchema.statics.resetLoginAttempts = function(mobile) {
  return this.updateOne(
    { mobile },
    { 
      $set: { loginAttempts: 0 },
      $unset: { lockUntil: 1 }
    }
  );
};

const SuperAdmin = mongoose.model('SuperAdmin', superadminSchema);

// ✅ Make sure to use default export
export default SuperAdmin;