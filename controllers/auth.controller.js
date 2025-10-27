import User from '../models/user.model.js';
import Customer from '../models/customer.model.js';
import Admin from '../models/admin.model.js';
import jwt from 'jsonwebtoken';
import { generateOTP } from '../utils/generateOTP.js';
import { geocodeAddress, reverseGeocode, extractAddressComponents } from '../services/googleMapsService.js';

// UPDATED: Check if user exists before sending OTP
export async function sendOTP(req, res) {
  try {
    const { phone } = req.body;
    if (!phone) return res.status(400).json({ message: 'Phone required' });

    // Check if user exists - DON'T create automatically
    const user = await User.findOne({ phone });
    if (!user) {
      return res.status(404).json({ 
        success: false,
        message: 'User not found. Please sign up first.' 
      });
    }

    const otpCode = generateOTP();
    user.otp = { code: otpCode, expiresAt: new Date(Date.now() + 5*60*1000) };
    await user.save();

    console.log(`📲 OTP for ${phone}: ${otpCode}`);

    res.status(200).json({ 
      success: true,
      message: 'OTP sent successfully' 
    });
  } catch (error) {
    res.status(500).json({ 
      success: false,
      message: error.message 
    });
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
      success: true,
      message: 'OTP verified successfully',
      token,
      user: { 
        id: user._id, 
        phone: user.phone, 
        role: user.role,
        profile 
      }
    });
  } catch (error) {
    res.status(500).json({ 
      success: false,
      message: error.message 
    });
  }
}

// Enhanced signup function with location support
export async function signup(req, res) {
  try {
    const { 
      phone, 
      fullName, 
      address, 
      contactNo, 
      shopName, 
      userType = 'customer',
      coordinates, // { latitude, longitude }
      formattedAddress
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

    // Get location data if coordinates provided, otherwise geocode the address
    let locationData = null;
    if (coordinates && coordinates.latitude && coordinates.longitude) {
      // Use provided coordinates
      const reverseGeocodeResult = await reverseGeocode(coordinates.latitude, coordinates.longitude);
      if (reverseGeocodeResult) {
        locationData = {
          coordinates: {
            latitude: coordinates.latitude,
            longitude: coordinates.longitude
          },
          formattedAddress: reverseGeocodeResult.formattedAddress,
          addressComponents: extractAddressComponents(reverseGeocodeResult.addressComponents)
        };
      }
    } else {
      // Geocode the provided address
      const geocodeResult = await geocodeAddress(address);
      if (geocodeResult) {
        locationData = {
          coordinates: {
            latitude: geocodeResult.latitude,
            longitude: geocodeResult.longitude
          },
          formattedAddress: geocodeResult.formattedAddress,
          addressComponents: extractAddressComponents(geocodeResult.addressComponents)
        };
      }
    }

    // Create profile based on user type
    if (userType === 'customer') {
      const customerData = {
        user: user._id,
        personalInfo: {
          fullName,
          alternatePhone: contactNo
        },
        deliveryAddress: {
          addressLine1: address,
          formattedAddress: locationData?.formattedAddress || address
        }
      };

      // Add location data if available
      if (locationData) {
        customerData.deliveryAddress.coordinates = locationData.coordinates;
        if (locationData.addressComponents.city) {
          customerData.deliveryAddress.city = locationData.addressComponents.city;
        }
        if (locationData.addressComponents.state) {
          customerData.deliveryAddress.state = locationData.addressComponents.state;
        }
        if (locationData.addressComponents.pincode) {
          customerData.deliveryAddress.pincode = locationData.addressComponents.pincode;
        }
      }

      const customer = new Customer(customerData);
      await customer.save();
      user.customerProfile = customer._id;
    } else if (userType === 'admin') {
      const adminData = {
        user: user._id,
        fullName,
        shopName,
        address,
        contactNumber: contactNo
      };

      // Add location data if available
      if (locationData) {
        adminData.location = {
          coordinates: locationData.coordinates,
          formattedAddress: locationData.formattedAddress
        };
        if (locationData.addressComponents.city) {
          adminData.location.city = locationData.addressComponents.city;
        }
        if (locationData.addressComponents.state) {
          adminData.location.state = locationData.addressComponents.state;
        }
        if (locationData.addressComponents.pincode) {
          adminData.location.pincode = locationData.addressComponents.pincode;
        }
      }

      const admin = new Admin(adminData);
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