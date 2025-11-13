// C:\Users\Krishna\OneDrive\Desktop\backend-dairy9\Dairy9-Backend\controllers\customer.controller.js

import Customer from '../models/customer.model.js';
import User from '../models/user.model.js';
import { assignNearestRetailer } from '../utils/retailerAssignment.js';
import { validateCoordinates } from '../utils/locationUtils.js';

// Create or Update Customer Profile
export const createUpdateProfile = async (req, res) => {
  try {
    const userId = req.user._id;
    const { personalInfo, deliveryAddress } = req.body;

    // Convert empty strings to null for date fields and validate date
    const processedPersonalInfo = { ...personalInfo };
    if (processedPersonalInfo.dateOfBirth && processedPersonalInfo.dateOfBirth.trim() !== '') {
      const date = new Date(processedPersonalInfo.dateOfBirth);
      processedPersonalInfo.dateOfBirth = isNaN(date.getTime()) ? null : date;
    } else {
      processedPersonalInfo.dateOfBirth = null;
    }

    let customer = await Customer.findOne({ user: userId });

    if (customer) {
      // Update existing profile
      customer.personalInfo = { ...customer.personalInfo, ...processedPersonalInfo };
      customer.deliveryAddress = { ...customer.deliveryAddress, ...deliveryAddress };
    } else {
      // Create new profile
      customer = new Customer({
        user: userId,
        personalInfo: processedPersonalInfo,
        deliveryAddress
      });
    }

    // Ensure coordinates is always present in deliveryAddress
    if (!customer.deliveryAddress.coordinates) {
      customer.deliveryAddress.coordinates = { latitude: null, longitude: null };
    }

    await customer.save();

    // Link customer profile to user
    await User.findByIdAndUpdate(userId, { customerProfile: customer._id });

    // If coordinates provided, try assigning nearest retailer
    const coords = customer.deliveryAddress?.coordinates;
    if (coords && typeof coords.latitude === 'number' && typeof coords.longitude === 'number') {
      try {
        const result = await assignNearestRetailer(coords.latitude, coords.longitude);
        if (result?.retailer) {
          customer.assignedRetailer = result.retailer._id;
          customer.assignedOn = new Date();
          await customer.save();
          console.log('✅ Retailer auto-assigned on profile save:', result.retailer.shopName);
        } else {
          console.log('⚠ No retailer found when saving profile');
        }
      } catch (err) {
        console.error('Error assigning retailer on profile save:', err);
      }
    }

    res.status(200).json({
      message: 'Profile saved successfully',
      customer
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// Get Customer Profile (unchanged)...
export const getProfile = async (req, res) => {
  try {
    let customer = await Customer.findOne({ user: req.user._id })
      .populate('user', 'phone')
      .populate('assignedRetailer', 'shopName location serviceRadius');

    if (!customer) {
      // Create a default profile structure if none exists
      customer = new Customer({
        user: req.user._id,
        personalInfo: {
          fullName: '',
          email: '',
          alternatePhone: '',
          dateOfBirth: null
        },
        deliveryAddress: {
          addressLine1: '',
          addressLine2: '',
          city: '',
          state: '',
          pincode: '',
          landmark: '',
          coordinates: {
            latitude: null,
            longitude: null
          },
          formattedAddress: ''
        },

        orderHistory: [],
        walletBalance: 0
      });

      await customer.save();

      // Link customer profile to user
      await User.findByIdAndUpdate(req.user._id, { customerProfile: customer._id });
    }

    res.status(200).json(customer);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// Add Order to Customer History (unchanged)...
export const addOrder = async (req, res) => {
  try {
    const { products, totalAmount } = req.body;

    const customer = await Customer.findOne({ user: req.user._id });
    if (!customer) return res.status(404).json({ message: 'Customer profile not found' });

    const newOrder = {
      orderId: 'ORD' + Date.now(),
      products,
      totalAmount,
      status: 'pending'
    };

    customer.orderHistory.push(newOrder);
    await customer.save();

    res.status(201).json({
      message: 'Order added successfully',
      order: newOrder
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// @desc    Update customer delivery address
// @route   PUT /api/customer/address
// @access  Private
export const updateDeliveryAddress = async (req, res) => {
  try {
    const userId = req.user._id;
    const { deliveryAddress } = req.body;

    if (!deliveryAddress) {
      return res.status(400).json({
        success: false,
        message: 'Delivery address is required'
      });
    }

    // Validate required fields
    if (!deliveryAddress.addressLine1 || !deliveryAddress.city || !deliveryAddress.state || !deliveryAddress.pincode) {
      return res.status(400).json({
        success: false,
        message: 'Address line 1, city, state, and pincode are required'
      });
    }

    const customer = await Customer.findOne({ user: userId });
    if (!customer) {
      return res.status(404).json({
        success: false,
        message: 'Customer profile not found'
      });
    }

    // Update delivery address
    customer.deliveryAddress = {
      ...customer.deliveryAddress,
      ...deliveryAddress
    };

    await customer.save();

    // Try reassigning retailer when address has coordinates
    const coords = customer.deliveryAddress?.coordinates;
    if (coords && typeof coords.latitude === 'number' && typeof coords.longitude === 'number') {
      try {
        const result = await assignNearestRetailer(coords.latitude, coords.longitude);
        if (result?.retailer) {
          customer.assignedRetailer = result.retailer._id;
          customer.assignedOn = new Date();
          await customer.save();
          console.log('🔄 Retailer reassigned on address update:', result.retailer.shopName);
        } else {
          console.log('⚠ No retailer found in new address area');
          // Optionally set assignedRetailer = null if you want to remove previous assignment when none found
          // customer.assignedRetailer = null;
          // await customer.save();
        }
      } catch (err) {
        console.error('Error while reassigning retailer on address update:', err);
      }
    }

    res.status(200).json({
      success: true,
      message: 'Delivery address updated successfully',
      deliveryAddress: customer.deliveryAddress
    });
  } catch (error) {
    console.error('Update Delivery Address Error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

// @desc    Add coordinates to customer address
// @route   PUT /api/customer/address/coordinates
// @access  Private
export const addAddressCoordinates = async (req, res) => {
  try {
    const userId = req.user._id;
    const { latitude, longitude } = req.body;

    if (latitude === undefined || longitude === undefined) {
      return res.status(400).json({
        success: false,
        message: 'Latitude and longitude are required'
      });
    }

    if (!validateCoordinates(latitude, longitude)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid coordinates provided'
      });
    }

    const customer = await Customer.findOne({ user: userId });
    if (!customer) {
      return res.status(404).json({
        success: false,
        message: 'Customer profile not found'
      });
    }

    if (!customer.deliveryAddress) {
      return res.status(400).json({
        success: false,
        message: 'Please set a delivery address first'
      });
    }

    // Update coordinates
    customer.deliveryAddress.coordinates = {
      latitude,
      longitude
    };

    await customer.save();

    // Assign nearest retailer immediately
    try {
      const result = await assignNearestRetailer(latitude, longitude);
      if (result?.retailer) {
        customer.assignedRetailer = result.retailer._id;
        customer.assignedOn = new Date();
        await customer.save();
        console.log('✅ Retailer assigned on coordinates add:', result.retailer.shopName);
      } else {
        console.log('⚠ No retailer found for provided coordinates');
      }
    } catch (err) {
      console.error('Error assigning retailer on coordinates add:', err);
    }

    res.status(200).json({
      success: true,
      message: 'Address coordinates updated successfully',
      deliveryAddress: customer.deliveryAddress
    });
  } catch (error) {
    console.error('Add Address Coordinates Error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

// Get Order History (unchanged)...
export const getOrderHistory = async (req, res) => {
  try {
    const customer = await Customer.findOne({ user: req.user._id });
    if (!customer) return res.status(404).json({ message: 'Customer profile not found' });

    res.status(200).json(customer.orderHistory);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};
