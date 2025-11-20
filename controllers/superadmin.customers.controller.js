// controllers/superadmin.customers.controller.js
import Customer from '../models/customer.model.js';
import Order from '../models/order.model.js';
import User from '../models/user.model.js';

export const getAllCustomers = async (req, res) => {
  try {
    console.log('👥 [CUSTOMERS] Starting get all customers request');
    
    // Use req.user instead of req.superadmin
    if (!req.user) {
      console.error('❌ [CUSTOMERS] req.user is undefined!');
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }

    const { 
      page = 1, 
      limit = 10, 
      search = '',
      sortBy = 'createdAt',
      sortOrder = 'desc'
    } = req.query;

    const filter = {};
    
    if (search) {
      filter.$or = [
        { 'personalInfo.fullName': { $regex: search, $options: 'i' } },
        { 'personalInfo.email': { $regex: search, $options: 'i' } },
      ];
    }

    const skip = (page - 1) * limit;
    const sort = { [sortBy]: sortOrder === 'desc' ? -1 : 1 };

    // Search in User model for mobile numbers
    if (search) {
      const users = await User.find({
        mobile: { $regex: search, $options: 'i' },
        role: 'customer'
      }).select('_id');
      
      const userIds = users.map(user => user._id);
      
      if (userIds.length > 0) {
        filter.$or = [
          ...(filter.$or || []),
          { user: { $in: userIds } }
        ];
      }
    }

    const [customers, total] = await Promise.all([
      Customer.find(filter)
        .populate('user', 'mobile lastLogin')
        .sort(sort)
        .skip(skip)
        .limit(parseInt(limit)),
      Customer.countDocuments(filter)
    ]);

    // Format customers for response
    const formattedCustomers = customers.map(customer => ({
      _id: customer._id,
      name: customer.personalInfo?.fullName || 'N/A',
      email: customer.personalInfo?.email || 'N/A',
      mobile: customer.user?.mobile || 'N/A',
      alternatePhone: customer.personalInfo?.alternatePhone || 'N/A',
      deliveryAddress: customer.deliveryAddress,
      totalOrders: customer.orderHistory?.length || 0,
      totalSpent: customer.orderHistory?.reduce((sum, order) => sum + (order.totalAmount || 0), 0) || 0,
      walletBalance: customer.walletBalance || 0,
      lastLogin: customer.user?.lastLogin || customer.updatedAt,
      createdAt: customer.createdAt,
      updatedAt: customer.updatedAt
    }));

    // Customer stats
    const stats = await Customer.aggregate([
      {
        $lookup: {
          from: 'users',
          localField: 'user',
          foreignField: '_id',
          as: 'userInfo'
        }
      },
      { $unwind: '$userInfo' },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          active: {
            $sum: {
              $cond: [
                { 
                  $and: [
                    { $ne: ['$userInfo.lastLogin', null] },
                    { $gte: ['$userInfo.lastLogin', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)] }
                  ]
                },
                1, 0
              ]
            }
          },
          withOrders: {
            $sum: {
              $cond: [
                { $gt: [{ $size: { $ifNull: ['$orderHistory', []] } }, 0] },
                1, 0
              ]
            }
          },
          totalWalletBalance: { $sum: '$walletBalance' }
        }
      }
    ]);

    // Log action using console.log
    console.log('👥 [CUSTOMERS] SuperAdmin viewed customers list:', {
      userId: req.user._id,
      page,
      search,
      results: formattedCustomers.length
    });

    res.json({
      success: true,
      data: {
        customers: formattedCustomers,
        pagination: {
          current: parseInt(page),
          total: Math.ceil(total / limit),
          count: formattedCustomers.length,
          totalRecords: total
        },
        stats: stats[0] || { 
          total: 0, 
          active: 0, 
          withOrders: 0,
          totalWalletBalance: 0 
        }
      }
    });

  } catch (error) {
    console.error('❌ [CUSTOMERS] Get customers error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch customers',
      error: error.message
    });
  }
};

// ... update other functions similarly
export const getCustomerDetails = async (req, res) => {
  try {
    const { id } = req.params;

    const customer = await Customer.findById(id)
      .populate('user', 'mobile lastLogin');

    if (!customer) {
      return res.status(404).json({
        success: false,
        message: 'Customer not found'
      });
    }

    // Get detailed order statistics from Order model
    const orderStats = await Order.aggregate([
      {
        $match: { 
          customer: customer._id,
          orderStatus: { $ne: 'cancelled' }
        }
      },
      {
        $group: {
          _id: null,
          totalOrders: { $sum: 1 },
          totalSpent: { $sum: '$finalAmount' },
          completedOrders: {
            $sum: { $cond: [{ $eq: ['$orderStatus', 'delivered'] }, 1, 0] }
          },
          pendingOrders: {
            $sum: { 
              $cond: [{ 
                $in: ['$orderStatus', ['pending', 'confirmed', 'preparing', 'out_for_delivery']] 
              }, 1, 0] 
            }
          },
          averageOrderValue: { $avg: '$finalAmount' },
          lastOrderDate: { $max: '$createdAt' }
        }
      }
    ]);

    // Get recent orders
    const recentOrders = await Order.find({
      customer: customer._id
    })
    .populate('assignedRetailer', 'shopName fullName')
    .sort({ createdAt: -1 })
    .limit(10)
    .select('orderId finalAmount orderStatus createdAt assignedRetailer');

    // Get favorite retailers
    const favoriteRetailers = await Order.aggregate([
      {
        $match: { 
          customer: customer._id,
          orderStatus: 'delivered'
        }
      },
      {
        $group: {
          _id: '$assignedRetailer',
          orderCount: { $sum: 1 },
          totalSpent: { $sum: '$finalAmount' }
        }
      },
      { $sort: { orderCount: -1 } },
      { $limit: 5 },
      {
        $lookup: {
          from: 'admins',
          localField: '_id',
          foreignField: '_id',
          as: 'retailerInfo'
        }
      },
      { $unwind: '$retailerInfo' }
    ]);

    const stats = orderStats[0] || {
      totalOrders: customer.orderHistory?.length || 0,
      totalSpent: customer.orderHistory?.reduce((sum, order) => sum + (order.totalAmount || 0), 0) || 0,
      completedOrders: 0,
      pendingOrders: 0,
      averageOrderValue: 0,
      lastOrderDate: null
    };

    await req.superadmin.logAction(
      'view_customer_details',
      'customers',
      customer._id,
      { 
        customerId: customer._id.toString(),
        customerName: customer.personalInfo?.fullName 
      }
    );

    res.json({
      success: true,
      data: {
        customer: {
          _id: customer._id,
          personalInfo: customer.personalInfo,
          deliveryAddress: customer.deliveryAddress,
          preferences: customer.preferences,
          walletBalance: customer.walletBalance,
          mobile: customer.user?.mobile,
          lastLogin: customer.user?.lastLogin,
          createdAt: customer.createdAt
        },
        statistics: {
          ...stats,
          orderHistoryCount: customer.orderHistory?.length || 0
        },
        recentOrders: recentOrders.map(order => ({
          orderId: order.orderId,
          amount: order.finalAmount,
          status: order.orderStatus,
          createdAt: order.createdAt,
          retailer: order.assignedRetailer ? {
            shopName: order.assignedRetailer.shopName,
            ownerName: order.assignedRetailer.fullName
          } : null
        })),
        favoriteRetailers: favoriteRetailers.map(retailer => ({
          retailerId: retailer._id,
          shopName: retailer.retailerInfo.shopName,
          ownerName: retailer.retailerInfo.fullName,
          orderCount: retailer.orderCount,
          totalSpent: retailer.totalSpent
        }))
      }
    });

  } catch (error) {
    console.error('Get customer details error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch customer details',
      error: error.message
    });
  }
};

export const getCustomerOrders = async (req, res) => {
  try {
    const { id } = req.params;
    const { 
      page = 1, 
      limit = 10,
      status = 'all'
    } = req.query;

    const customer = await Customer.findById(id);
    if (!customer) {
      return res.status(404).json({
        success: false,
        message: 'Customer not found'
      });
    }

    const filter = { customer: customer._id };
    
    if (status !== 'all') {
      filter.orderStatus = status;
    }

    const skip = (page - 1) * limit;

    const [orders, total] = await Promise.all([
      Order.find(filter)
        .populate('assignedRetailer', 'shopName fullName contactNumber')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .select('orderId finalAmount orderStatus paymentStatus createdAt assignedRetailer items'),
      Order.countDocuments(filter)
    ]);

    const formattedOrders = orders.map(order => ({
      _id: order._id,
      orderId: order.orderId,
      finalAmount: order.finalAmount,
      orderStatus: order.orderStatus,
      paymentStatus: order.paymentStatus,
      createdAt: order.createdAt,
      itemCount: order.items.length,
      retailer: order.assignedRetailer ? {
        shopName: order.assignedRetailer.shopName,
        ownerName: order.assignedRetailer.fullName,
        contact: order.assignedRetailer.contactNumber
      } : null,
      items: order.items.map(item => ({
        product: item.product,
        quantity: item.quantity,
        price: item.price,
        unit: item.unit
      }))
    }));

    await req.superadmin.logAction(
      'view_customer_orders',
      'customers',
      customer._id,
      { 
        customerId: customer._id.toString(),
        page,
        status,
        orderCount: orders.length 
      }
    );

    res.json({
      success: true,
      data: {
        orders: formattedOrders,
        pagination: {
          current: parseInt(page),
          total: Math.ceil(total / limit),
          count: orders.length,
          totalRecords: total
        },
        customer: {
          id: customer._id,
          name: customer.personalInfo?.fullName
        }
      }
    });

  } catch (error) {
    console.error('Get customer orders error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch customer orders',
      error: error.message
    });
  }
};

// Make sure all exports are present
export default {
  getAllCustomers,
  getCustomerDetails,
  getCustomerOrders
};