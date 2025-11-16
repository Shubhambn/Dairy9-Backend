// C:\Users\Krishna\OneDrive\Desktop\backend-dairy9\Dairy9-Backend\middlewares\adminAuth.js

import User from '../models/user.model.js';

const adminAuth = async (req, res, next) => {
  try {
    // Check if user is admin
    if (req.user.role !== 'admin') {
      return res.status(403).json({ 
        success: false,
        message: 'Access denied. Admin privileges required.' 
      });
    }

    // Check if admin profile exists
    const userWithAdmin = await User.findById(req.user._id).populate('adminProfile');
    if (!userWithAdmin.adminProfile) {
      return res.status(403).json({ 
        success: false,
        message: 'Admin profile not found' 
      });
    }

    req.admin = userWithAdmin.adminProfile;
    next();
  } catch (error) {
    res.status(500).json({ 
      success: false,
      message: 'Server error', 
      error: error.message 
    });
  }
};

export default adminAuth;