// C:\Users\Krishna\OneDrive\Desktop\backend-dairy9\Dairy9-Backend\controllers\adminDashboard.controller.js

import Order from '../models/order.model.js';
import Customer from '../models/customer.model.js';
import Product from '../models/product.model.js';

// @desc    Get admin dashboard stats
// @route   GET /api/admin/dashboard/stats
// @access  Private (Admin)
export const getDashboardStats = async (req, res) => {
  try {
    // Get today's date range
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    // Calculate stats
    const todayRevenueResult = await Order.aggregate([
      {
        $match: {
          paymentStatus: 'paid',
          createdAt: { $gte: today, $lt: tomorrow }
        }
      },
      {
        $group: {
          _id: null,
          total: { $sum: '$finalAmount' }
        }
      }
    ]);

    const ordersToday = await Order.countDocuments({
      createdAt: { $gte: today, $lt: tomorrow }
    });

    const totalCustomers = await Customer.countDocuments();
    const totalOrders = await Order.countDocuments();

    res.status(200).json({
      success: true,
      stats: {
        todayRevenue: todayRevenueResult[0]?.total || 0,
        ordersToday: ordersToday,
        totalCustomers: totalCustomers,
        totalOrders: totalOrders
      }
    });
  } catch (error) {
    console.error('Get Dashboard Stats Error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

// @desc    Get admin orders with filters
// @route   GET /api/admin/orders
// @access  Private (Admin)
export const getAdminOrders = async (req, res) => {
  try {
    const { page = 1, limit = 10, status } = req.query;
    
    const filter = {};
    if (status && status !== 'all') {
      filter.orderStatus = status;
    }

    const orders = await Order.find(filter)
      .populate('customer')
      .populate('items.product')
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await Order.countDocuments(filter);

    // Format orders for frontend
    const formattedOrders = orders.map(order => ({
      id: order.orderId,
      customerName: order.customer?.personalInfo?.fullName || 'N/A',
      items: order.items.map(item => ({
        productName: item.product?.name || 'Unknown Product',
        quantity: item.quantity,
        price: item.price
      })),
      total: order.finalAmount,
      status: order.orderStatus,
      date: order.createdAt,
      paymentStatus: order.paymentStatus
    }));

    // Calculate order stats by status
    const orderStats = {
      total: await Order.countDocuments(),
      pending: await Order.countDocuments({ orderStatus: 'pending' }),
      delivered: await Order.countDocuments({ orderStatus: 'delivered' }),
      outForDelivery: await Order.countDocuments({ orderStatus: 'out_for_delivery' }),
      cancelled: await Order.countDocuments({ orderStatus: 'cancelled' })
    };

    res.status(200).json({
      success: true,
      orders: formattedOrders,
      orderStats,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(total / limit),
        totalOrders: total
      }
    });
  } catch (error) {
    console.error('Get Admin Orders Error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

// @desc    Update order status
// @route   PUT /api/admin/orders/:orderId/status
// @access  Private (Admin)
export const updateOrderStatus = async (req, res) => {
  try {
    const { status } = req.body;
    
    const validStatuses = ['pending', 'confirmed', 'preparing', 'out_for_delivery', 'delivered', 'cancelled'];
    
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid order status'
      });
    }

    const order = await Order.findOne({ orderId: req.params.orderId });
    
    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    order.orderStatus = status;
    await order.save();

    res.status(200).json({
      success: true,
      message: 'Order status updated successfully',
      order
    });
  } catch (error) {
    console.error('Update Order Status Error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

// @desc    Get invoice summary
// @route   GET /api/admin/invoices
// @access  Private (Admin)
export const getInvoiceSummary = async (req, res) => {
  try {
    const { page = 1, limit = 10, status } = req.query;
    
    const filter = {};
    if (status && status !== 'all') {
      filter.paymentStatus = status;
    }

    const invoices = await Order.find(filter)
      .populate('customer')
      .select('orderId finalAmount paymentStatus orderStatus createdAt customer')
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await Order.countDocuments(filter);

    // Calculate invoice stats
    const totalRevenueResult = await Order.aggregate([
      { $match: { paymentStatus: 'paid' } },
      { $group: { _id: null, total: { $sum: '$finalAmount' } } }
    ]);

    const pendingPaymentsResult = await Order.aggregate([
      { $match: { paymentStatus: 'pending' } },
      { $group: { _id: null, total: { $sum: '$finalAmount' } } }
    ]);

    const paidInvoices = await Order.countDocuments({ paymentStatus: 'paid' });

    res.status(200).json({
      success: true,
      invoices: invoices.map(invoice => ({
        id: invoice.orderId,
        customer: invoice.customer?.personalInfo?.fullName || 'N/A',
        amount: invoice.finalAmount,
        status: invoice.paymentStatus,
        orderStatus: invoice.orderStatus,
        date: invoice.createdAt
      })),
      invoiceStats: {
        totalInvoices: total,
        totalRevenue: totalRevenueResult[0]?.total || 0,
        pendingPayments: pendingPaymentsResult[0]?.total || 0,
        paidInvoices: paidInvoices
      },
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(total / limit),
        totalInvoices: total
      }
    });
  } catch (error) {
    console.error('Get Invoice Summary Error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};