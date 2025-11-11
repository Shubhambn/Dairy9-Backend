// /home/shubh/Dairy9-New/new-bac/Dairy9-Backend/controllers/superadmin.controller.js
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import User from '../models/user.model.js';

export async function verifySuperAdminPassword(req, res) {
  try {
    const { phone, secretKey } = req.body;

    if (!phone || !secretKey) {
      return res.status(400).json({
        success: false,
        message: 'Phone and secret key are required'
      });
    }

    const user = await User.findOne({ phone, role: 'superadmin' }).select('+superadminPassword');

    if (!user) {
      return res.status(404).json({ success: false, message: 'SuperAdmin not found' });
    }

    // Compare with hashed key
    const match = await bcrypt.compare(secretKey, user.superadminPassword);
    if (!match) {
      return res.status(401).json({ success: false, message: 'Invalid secret key' });
    }

    // Generate final JWT
    const token = jwt.sign(
      { id: user._id, phone: user.phone, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '30d' }
    );

    res.status(200).json({
      success: true,
      message: 'SuperAdmin verified successfully',
      token,
      user: {
        id: user._id,
        phone: user.phone,
        role: user.role,
        isVerified: user.isVerified
      }
    });
  } catch (error) {
    console.error('SuperAdmin Password Verify Error:', error);
    res.status(500).json({ success: false, message: 'Server error verifying secret key' });
  }
}
