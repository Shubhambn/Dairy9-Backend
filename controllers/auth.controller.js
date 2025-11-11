import User from '../models/user.model.js';
import Customer from '../models/customer.model.js';
import Admin from '../models/admin.model.js';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';

// Helper function to generate OTP
const generateOTP = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

// @desc    User Signup
// @route   POST /api/auth/signup
// @access  Public
export async function signup(req, res) {
  let user = null;
  
  try {
    const { 
      phone, 
      fullName, 
      address, 
      contactNo, 
      shopName, 
      userType = 'customer',
      coordinates,
      formattedAddress
    } = req.body;

    console.log('Signup request received:', { phone, userType, fullName });

    // Basic validation
    if (!phone || !fullName || !address || !contactNo) {
      return res.status(400).json({ 
        success: false,
        message: 'Phone, full name, address, and contact number are required' 
      });
    }

    if ((userType === 'admin' || userType === 'retailer') && !shopName) {
      return res.status(400).json({ 
        success: false,
        message: 'Shop name is required for retailer/admin' 
      });
    }

    // Check if user already exists
    const existingUser = await User.findOne({ phone });
    if (existingUser) {
      return res.status(400).json({ 
        success: false,
        message: 'User already exists with this phone number' 
      });
    }

    // Create new user
    user = new User({ 
      phone, 
      role: userType 
    });

    await user.save();
    console.log('✅ User created:', user._id);

    // Create profile based on user type
    if (userType === 'customer') {
      try {
        const customerData = {
          user: user._id,
          personalInfo: { 
            fullName, 
            alternatePhone: contactNo 
          },
          deliveryAddress: {
            addressLine1: address,
            formattedAddress: formattedAddress || address,
            coordinates: coordinates || null
          }
        };

        const customer = new Customer(customerData);
        await customer.save();
        user.customerProfile = customer._id;
        console.log('✅ Customer profile created:', customer._id);
        
      } catch (customerError) {
        console.error('❌ Customer profile creation error:', customerError);
        // Continue even if customer profile fails
      }
      
    } else if (userType === 'admin' || userType === 'retailer') {
      try {
        // Build admin data with safe defaults
        const adminData = {
          user: user._id,
          fullName,
          shopName,
          address,
          contactNumber: contactNo
        };

        // Add location data if coordinates are provided
        if (coordinates && coordinates.latitude && coordinates.longitude) {
          adminData.location = {
            coordinates: {
              latitude: coordinates.latitude,
              longitude: coordinates.longitude
            },
            formattedAddress: formattedAddress || address
          };
        }

        console.log('Creating admin with data:', adminData);
        
        const admin = new Admin(adminData);
        await admin.save();
        user.adminProfile = admin._id;
        console.log('✅ Admin/Retailer profile created:', admin._id);
        
      } catch (adminError) {
        console.error('❌ Admin profile creation error:', adminError);
        
        // Try fallback without location data
        try {
          const fallbackAdminData = {
            user: user._id,
            fullName,
            shopName,
            address,
            contactNumber: contactNo
            // Skip location entirely
          };
          
          const admin = new Admin(fallbackAdminData);
          await admin.save();
          user.adminProfile = admin._id;
          console.log('✅ Fallback admin profile created:', admin._id);
        } catch (fallbackError) {
          console.error('❌ Fallback admin creation also failed:', fallbackError);
          // Continue without admin profile
        }
      }
    }

    // Generate OTP
    const otpCode = generateOTP();
    user.otp = { 
      code: otpCode, 
      expiresAt: new Date(Date.now() + 10 * 60 * 1000) // 10 minutes
    };
    
    await user.save();

    console.log(`📲 OTP for ${userType} ${phone}: ${otpCode}`);

    res.status(201).json({
      success: true,
      message: `${userType.charAt(0).toUpperCase() + userType.slice(1)} registered successfully. OTP sent.`,
      userId: user._id,
      userType,
      hasLocation: !!(coordinates && coordinates.latitude && coordinates.longitude)
    });
    
  } catch (error) {
    console.error('❌ Signup Error:', error);
    
    // Cleanup: delete user if created but profile creation failed
    if (user && user._id) {
      try {
        await User.findByIdAndDelete(user._id);
        console.log('🧹 Cleaned up user due to signup error');
      } catch (cleanupError) {
        console.error('Error during cleanup:', cleanupError);
      }
    }

    let errorMessage = 'Server error during signup';
    if (error.name === 'ValidationError') {
      errorMessage = 'Validation failed. Please check your input data.';
    } else if (error.message.includes('duplicate key')) {
      errorMessage = 'User with this phone number already exists.';
    }

    res.status(500).json({ 
      success: false,
      message: errorMessage,
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
}

// @desc    Send OTP to existing user
// @route   POST /api/auth/send-otp
// @access  Public
export async function sendOTP(req, res) {
  try {
    const { phone } = req.body;
    
    if (!phone) {
      return res.status(400).json({ 
        success: false,
        message: 'Phone number is required' 
      });
    }

    // Check if user exists
    const user = await User.findOne({ phone });
    if (!user) {
      return res.status(404).json({ 
        success: false,
        message: 'User not found. Please sign up first.' 
      });
    }

    const otpCode = generateOTP();
    user.otp = { 
      code: otpCode, 
      expiresAt: new Date(Date.now() + 10 * 60 * 1000)
    };
    await user.save();

    console.log(`📲 OTP for ${phone}: ${otpCode}`);

    res.status(200).json({ 
      success: true,
      message: 'OTP sent successfully' 
    });
  } catch (error) {
    console.error('Send OTP Error:', error);
    res.status(500).json({ 
      success: false,
      message: 'Server error while sending OTP'
    });
  }
}

// @desc    Verify OTP and login user
// @route   POST /api/auth/verify-otp
// @access  Public

export async function verifyOTP(req, res) {
  try {
    const { phone, otp } = req.body;

    if (!phone || !otp) {
      return res.status(400).json({ 
        success: false,
        message: 'Phone and OTP are required' 
      });
    }

    const user = await User.findOne({ phone })
      .populate('customerProfile')
      .populate('adminProfile')
      .select('+superadminPassword'); // include hashed secret for superadmin

    if (!user) {
      return res.status(404).json({ 
        success: false,
        message: 'User not found' 
      });
    }

    // ✅ Validate OTP
    if (!user.otp || user.otp.code !== otp) {
      return res.status(400).json({ success: false, message: 'Invalid OTP' });
    }

    if (user.otp.expiresAt < new Date()) {
      user.otp = undefined;
      await user.save();
      return res.status(400).json({ success: false, message: 'OTP has expired' });
    }

    // ✅ Clear OTP and mark verified
    user.isVerified = true;
    user.otp = undefined;
    await user.save();

    // 🧭 SuperAdmin path — don’t log in yet, move to next step
    if (user.role === 'superadmin') {
      return res.status(200).json({
        success: true,
        message: 'OTP verified successfully. Please enter secret key.',
        requirePassword: true,
        phone: user.phone
      });
    }

    // 🧭 Other roles — log in immediately
    const token = jwt.sign(
      { id: user._id, phone: user.phone, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '30d' }
    );

    let profile = null;
    if (user.role === 'customer' && user.customerProfile) profile = user.customerProfile;
    if ((user.role === 'admin' || user.role === 'retailer') && user.adminProfile) profile = user.adminProfile;

    res.status(200).json({
      success: true,
      message: 'OTP verified successfully',
      token,
      user: { 
        id: user._id, 
        phone: user.phone, 
        role: user.role,
        isVerified: user.isVerified,
        profile 
      }
    });

  } catch (error) {
    console.error('Verify OTP Error:', error);
    res.status(500).json({ success: false, message: 'Server error during OTP verification' });
  }
}




// @desc    Resend OTP
// @route   POST /api/auth/resend-otp
// @access  Public
export async function resendOTP(req, res) {
  try {
    const { phone } = req.body;

    if (!phone) {
      return res.status(400).json({
        success: false,
        message: 'Phone number is required'
      });
    }

    const user = await User.findOne({ phone });
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found. Please sign up first.'
      });
    }

    const otpCode = generateOTP();
    user.otp = { 
      code: otpCode, 
      expiresAt: new Date(Date.now() + 10 * 60 * 1000)
    };
    
    await user.save();

    console.log(`📲 Resent OTP for ${phone}: ${otpCode}`);

    res.status(200).json({
      success: true,
      message: 'OTP sent successfully'
    });
  } catch (error) {
    console.error('Resend OTP Error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to resend OTP'
    });
  }
}

// @desc    Get current user profile
// @route   GET /api/auth/me
// @access  Private
export async function getCurrentUser(req, res) {
  try {
    const user = await User.findById(req.user.id)
      .populate('customerProfile')
      .populate('adminProfile');

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    let profile = null;
    if (user.role === 'customer' && user.customerProfile) {
      profile = user.customerProfile;
    } else if ((user.role === 'admin' || user.role === 'retailer') && user.adminProfile) {
      profile = user.adminProfile;
    }

    res.status(200).json({
      success: true,
      user: {
        id: user._id,
        phone: user.phone,
        role: user.role,
        isVerified: user.isVerified,
        profile
      }
    });
  } catch (error) {
    console.error('Get Current User Error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
}