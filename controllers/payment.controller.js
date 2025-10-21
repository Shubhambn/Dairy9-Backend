// C:\Users\Krishna\OneDrive\Desktop\backend-dairy9\Dairy9-Backend\controllers\payment.controller.js

import Payment from '../models/payment.model.js';
import Order from '../models/order.model.js';
import Customer from '../models/customer.model.js';
import crypto from 'crypto';

// Generate unique payment ID
const generatePaymentId = () => {
  return 'PAY' + Date.now() + Math.floor(Math.random() * 1000);
};

// @desc    Create payment for order
// @route   POST /api/payments
// @access  Private
export const createPayment = async (req, res) => {
  try {
    const userId = req.user._id;
    const { orderId, paymentMethod } = req.body;

    // Get order details
    const customer = await Customer.findOne({ user: userId });
    const order = await Order.findOne({
      orderId: orderId,
      customer: customer._id
    });

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    if (order.paymentStatus === 'paid') {
      return res.status(400).json({
        success: false,
        message: 'Order already paid'
      });
    }

    // Create payment record
    const payment = new Payment({
      paymentId: generatePaymentId(),
      order: order._id,
      customer: customer._id,
      amount: order.finalAmount,
      paymentMethod: paymentMethod || 'cash',
      paymentStatus: paymentMethod === 'cash' ? 'success' : 'pending'
    });

    await payment.save();

    // If cash payment, update order status immediately
    if (paymentMethod === 'cash') {
      order.paymentStatus = 'paid';
      await order.save();
    }

    res.status(201).json({
      success: true,
      message: 'Payment initiated successfully',
      payment,
      order
    });
  } catch (error) {
    console.error('Create Payment Error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

// @desc    Verify payment (for online payments)
// @route   POST /api/payments/verify
// @access  Private
export const verifyPayment = async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, orderId } = req.body;

    // In production, verify Razorpay signature
    // const generatedSignature = crypto
    //   .createHmac('sha256', process.env.RAZORPAY_SECRET)
    //   .update(razorpay_order_id + "|" + razorpay_payment_id)
    //   .digest('hex');

    // if (generatedSignature !== razorpay_signature) {
    //   return res.status(400).json({
    //     success: false,
    //     message: 'Payment verification failed'
    //   });
    // }

    // For demo - always success
    const order = await Order.findOne({ orderId });
    const payment = await Payment.findOne({ order: order._id });

    payment.paymentStatus = 'success';
    payment.razorpayOrderId = razorpay_order_id;
    payment.razorpayPaymentId = razorpay_payment_id;
    payment.razorpaySignature = razorpay_signature;
    await payment.save();

    order.paymentStatus = 'paid';
    await order.save();

    res.status(200).json({
      success: true,
      message: 'Payment verified successfully',
      payment
    });
  } catch (error) {
    console.error('Verify Payment Error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

// @desc    Get payment details
// @route   GET /api/payments/:id
// @access  Private
export const getPaymentDetails = async (req, res) => {
  try {
    const userId = req.user._id;
    const customer = await Customer.findOne({ user: userId });

    const payment = await Payment.findOne({
      _id: req.params.id,
      customer: customer._id
    }).populate('order', 'orderId totalAmount');

    if (!payment) {
      return res.status(404).json({
        success: false,
        message: 'Payment not found'
      });
    }

    res.status(200).json({
      success: true,
      payment
    });
  } catch (error) {
    console.error('Get Payment Error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

// @desc    Get customer payments
// @route   GET /api/payments
// @access  Private
export const getCustomerPayments = async (req, res) => {
  try {
    const userId = req.user._id;
    const { page = 1, limit = 10 } = req.query;

    const customer = await Customer.findOne({ user: userId });
    const payments = await Payment.find({ customer: customer._id })
      .populate('order', 'orderId')
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await Payment.countDocuments({ customer: customer._id });

    res.status(200).json({
      success: true,
      payments,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(total / limit),
        totalPayments: total
      }
    });
  } catch (error) {
    console.error('Get Payments Error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};