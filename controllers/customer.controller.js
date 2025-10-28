// C:\Users\Krishna\OneDrive\Desktop\backend-dairy9\Dairy9-Backend\controllers\customer.controller.js


import Customer from '../models/customer.model.js';
import User from '../models/user.model.js';

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

    res.status(200).json({
      message: 'Profile saved successfully',
      customer
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// Get Customer Profile
export const getProfile = async (req, res) => {
  try {
    let customer = await Customer.findOne({ user: req.user._id })
      .populate('user', 'phone');

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

// Add Order to Customer History
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

// Get Order History
export const getOrderHistory = async (req, res) => {
  try {
    const customer = await Customer.findOne({ user: req.user._id });
    if (!customer) return res.status(404).json({ message: 'Customer profile not found' });

    res.status(200).json(customer.orderHistory);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};
