// C:\Users\Krishna\OneDrive\Desktop\backend-dairy9\Dairy9-Backend\controllers\customer.controller.js


import Customer from '../models/customer.model.js';
import User from '../models/user.model.js';

// Create or Update Customer Profile
export const createUpdateProfile = async (req, res) => {
  try {
    const userId = req.user._id;
    const { personalInfo, deliveryAddress, preferences } = req.body;

    let customer = await Customer.findOne({ user: userId });

    if (customer) {
      // Update existing profile
      customer.personalInfo = { ...customer.personalInfo, ...personalInfo };
      customer.deliveryAddress = { ...customer.deliveryAddress, ...deliveryAddress };
      customer.preferences = { ...customer.preferences, ...preferences };
    } else {
      // Create new profile
      customer = new Customer({
        user: userId,
        personalInfo,
        deliveryAddress,
        preferences
      });
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
    const customer = await Customer.findOne({ user: req.user._id })
      .populate('user', 'phone');

    if (!customer) {
      return res.status(404).json({ message: 'Profile not found' });
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
