// C:\Users\Krishna\OneDrive\Desktop\backend-dairy9\Dairy9-Backend\controllers\auth.controller.js

import User from '../models/user.model.js';
import Customer from '../models/customer.model.js';
import Admin from '../models/admin.model.js';
import jwt from 'jsonwebtoken';
import { generateOTP } from '../utils/generateOTP.js';

// Existing OTP functions...
export async function sendOTP(req, res) {
  try {
    const { phone } = req.body;
    if (!phone) return res.status(400).json({ message: 'Phone required' });

    let user = await User.findOne({ phone });
    if (!user) user = await User.create({ phone });

    const otpCode = generateOTP();
    user.otp = { code: otpCode, expiresAt: new Date(Date.now() + 5*60*1000) };
    await user.save();

    console.log(`📲 OTP for ${phone}: ${otpCode}`);

    res.status(200).json({ message: 'OTP sent successfully' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
}

export async function verifyOTP(req, res) {
  try {
    const { phone, otp } = req.body;
    const user = await User.findOne({ phone });
    if (!user) return res.status(404).json({ message: 'User not found' });

    if (!user.otp || user.otp.code !== otp)
      return res.status(400).json({ message: 'Invalid OTP' });
    if (user.otp.expiresAt < Date.now())
      return res.status(400).json({ message: 'OTP expired' });

    user.isVerified = true;
    user.otp = undefined;
    await user.save();

    const token = jwt.sign(
      { id: user._id, phone: user.phone, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '30d' }
    );

    // Populate based on role
    let profile = null;
    if (user.role === 'customer' && user.customerProfile) {
      profile = await Customer.findById(user.customerProfile);
    } else if (user.role === 'admin' && user.adminProfile) {
      profile = await Admin.findById(user.adminProfile);
    }

    res.status(200).json({
      message: 'OTP verified',
      token,
      user: { 
        id: user._id, 
        phone: user.phone, 
        role: user.role,
        profile 
      }
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
}

// NEW: Signup function for both Customer and Admin
export async function signup(req, res) {
  try {
    const { 
      phone, 
      fullName, 
      address, 
      contactNo, 
      shopName, 
      userType = 'customer' 
    } = req.body;

    if (!phone || !fullName || !address || !contactNo) {
      return res.status(400).json({ 
        success: false,
        message: 'All fields are required' 
      });
    }

    if (userType === 'admin' && !shopName) {
      return res.status(400).json({ 
        success: false,
        message: 'Shop name is required for admin' 
      });
    }

    // Check if user already exists
    let user = await User.findOne({ phone });
    if (user) {
      return res.status(400).json({ 
        success: false,
        message: 'User already exists with this phone number' 
      });
    }

    // Create new user with role
    user = new User({ 
      phone, 
      role: userType 
    });

    // Create profile based on user type
    if (userType === 'customer') {
      const customer = new Customer({
        user: user._id,
        personalInfo: {
          fullName,
          alternatePhone: contactNo
        },
        deliveryAddress: {
          addressLine1: address
        }
      });
      await customer.save();
      user.customerProfile = customer._id;
    } else if (userType === 'admin') {
      const admin = new Admin({
        user: user._id,
        fullName,
        shopName,
        address,
        contactNumber: contactNo
      });
      await admin.save();
      user.adminProfile = admin._id;
    }

    // Generate OTP
    const otpCode = generateOTP();
    user.otp = { code: otpCode, expiresAt: new Date(Date.now() + 5*60*1000) };
    await user.save();

    console.log(`📲 OTP for ${userType} ${phone}: ${otpCode}`);

    res.status(201).json({
      success: true,
      message: `${userType.charAt(0).toUpperCase() + userType.slice(1)} registered successfully. OTP sent.`,
      userId: user._id,
      userType
    });
  } catch (error) {
    console.error('Signup Error:', error);
    res.status(500).json({ 
      success: false,
      message: 'Server error', 
      error: error.message 
    });
  }
}