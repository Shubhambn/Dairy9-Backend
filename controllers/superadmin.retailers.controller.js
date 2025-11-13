// controllers/superadmin.retailers.controller.js
import Admin from '../models/admin.model.js';
import Order from '../models/order.model.js';
import User from '../models/user.model.js';

export const getAllRetailers = async (req, res) => {
  try {
    console.log('🏪 [RETAILERS] Starting get all retailers request');
    
    // Use req.user instead of req.superadmin
    if (!req.user) {
      console.error('❌ [RETAILERS] req.user is undefined!');
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }

    const { 
      page = 1, 
      limit = 10, 
      search = '',
      status = 'all',
      sortBy = 'createdAt',
      sortOrder = 'desc'
    } = req.query;

    console.log('🏪 [RETAILERS] Query params:', { page, limit, search, status });

    // Build filter
    const filter = {};
    
    if (search) {
      filter.$or = [
        { shopName: { $regex: search, $options: 'i' } },
        { fullName: { $regex: search, $options: 'i' } },
        { contactNumber: { $regex: search, $options: 'i' } }
      ];
    }

    if (status !== 'all') {
      if (status === 'active') filter.isActive = true;
      if (status === 'inactive') filter.isActive = false;
    }

    // Pagination
    const skip = (page - 1) * limit;
    const sort = { [sortBy]: sortOrder === 'desc' ? -1 : 1 };

    const [retailers, total] = await Promise.all([
      Admin.find(filter)
        .populate('user', 'mobile lastLogin')
        .sort(sort)
        .skip(skip)
        .limit(parseInt(limit)),
      Admin.countDocuments(filter)
    ]);

    // Format retailers for response
    const formattedRetailers = retailers.map(retailer => ({
      _id: retailer._id,
      shopName: retailer.shopName,
      ownerName: retailer.fullName,
      mobile: retailer.user?.mobile || retailer.contactNumber,
      address: retailer.address,
      location: retailer.location,
      serviceRadius: retailer.serviceRadius,
      isActive: retailer.isActive,
      createdAt: retailer.createdAt,
      updatedAt: retailer.updatedAt
    }));

    // Get retailer stats
    const stats = await Admin.aggregate([
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          active: { $sum: { $cond: ['$isActive', 1, 0] } }
        }
      }
    ]);

    // Log action using console.log instead of req.superadmin.logAction
    console.log('🏪 [RETAILERS] SuperAdmin viewed retailers list:', {
      userId: req.user._id,
      page,
      search,
      status,
      results: formattedRetailers.length
    });

    res.json({
      success: true,
      data: {
        retailers: formattedRetailers,
        pagination: {
          current: parseInt(page),
          total: Math.ceil(total / limit),
          count: formattedRetailers.length,
          totalRecords: total
        },
        stats: stats[0] || { 
          total: 0, 
          active: 0
        }
      }
    });

  } catch (error) {
    console.error('❌ [RETAILERS] Get retailers error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch retailers',
      error: error.message
    });
  }
};

// ... keep other functions but remove all req.superadmin.logAction calls

// In controllers/superadmin.retailers.controller.js - Update getRetailerDetails function
export const getRetailerDetails = async (req, res) => {
  try {
    console.log('🏪 [RETAILERS] Starting get retailer details request');
    
    // Use req.user instead of req.superadmin
    if (!req.user) {
      console.error('❌ [RETAILERS] req.user is undefined!');
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }

    const { id } = req.params;
    console.log('🏪 [RETAILERS] Getting details for retailer ID:', id);

    const retailer = await Admin.findById(id)
      .populate('user', 'mobile lastLogin');

    if (!retailer) {
      console.log('❌ [RETAILERS] Retailer not found with ID:', id);
      return res.status(404).json({
        success: false,
        message: 'Retailer not found'
      });
    }

    console.log('✅ [RETAILERS] Retailer found:', retailer.shopName);

    // Get retailer performance stats
    const performance = await Order.aggregate([
      {
        $match: { 
          assignedRetailer: retailer._id,
          orderStatus: { $ne: 'cancelled' }
        }
      },
      {
        $group: {
          _id: null,
          totalOrders: { $sum: 1 },
          totalRevenue: { $sum: '$finalAmount' },
          completedOrders: {
            $sum: { $cond: [{ $eq: ['$orderStatus', 'delivered'] }, 1, 0] }
          },
          pendingOrders: {
            $sum: { 
              $cond: [{ 
                $in: ['$orderStatus', ['pending', 'confirmed', 'preparing', 'out_for_delivery']] 
              }, 1, 0] 
            }
          }
        }
      }
    ]);

    // Get recent orders for this retailer
    const recentOrders = await Order.find({
      assignedRetailer: retailer._id
    })
    .populate('customer', 'personalInfo.fullName')
    .sort({ createdAt: -1 })
    .limit(5)
    .select('orderId finalAmount orderStatus createdAt');

    // Log action using console.log instead of req.superadmin.logAction
    console.log('🏪 [RETAILERS] SuperAdmin viewed retailer details:', {
      userId: req.user._id,
      retailerId: retailer._id.toString(),
      retailerName: retailer.shopName
    });

    res.json({
      success: true,
      data: {
        retailer: {
          _id: retailer._id,
          shopName: retailer.shopName,
          ownerName: retailer.fullName,
          mobile: retailer.user?.mobile || retailer.contactNumber,
          address: retailer.address,
          location: retailer.location,
          serviceRadius: retailer.serviceRadius,
          isActive: retailer.isActive,
          createdAt: retailer.createdAt,
          updatedAt: retailer.updatedAt
        },
        performance: performance[0] || {
          totalOrders: 0,
          totalRevenue: 0,
          completedOrders: 0,
          pendingOrders: 0
        },
        recentOrders: recentOrders.map(order => ({
          orderId: order.orderId,
          amount: order.finalAmount,
          status: order.orderStatus,
          createdAt: order.createdAt,
          customerName: order.customer?.personalInfo?.fullName || 'N/A'
        }))
      }
    });

  } catch (error) {
    console.error('❌ [RETAILERS] Get retailer details error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch retailer details',
      error: error.message
    });
  }
};

// In controllers/superadmin.retailers.controller.js - Update updateRetailerStatus function
export const updateRetailerStatus = async (req, res) => {
  try {
    console.log('🏪 [RETAILERS] Starting update retailer status request');
    
    // Use req.user instead of req.superadmin
    if (!req.user) {
      console.error('❌ [RETAILERS] req.user is undefined!');
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }

    const { id } = req.params;
    const { action, reason } = req.body;

    console.log('🏪 [RETAILERS] Update status params:', { id, action, reason });

    const retailer = await Admin.findById(id);
    if (!retailer) {
      console.log('❌ [RETAILERS] Retailer not found with ID:', id);
      return res.status(404).json({
        success: false,
        message: 'Retailer not found'
      });
    }

    console.log('✅ [RETAILERS] Retailer found:', retailer.shopName);

    let update = {};
    let actionType = '';
    let actionMessage = '';

    switch (action) {
      case 'activate':
        update = { isActive: true };
        actionType = 'activate_retailer';
        actionMessage = 'activated';
        break;
      case 'suspend':
        update = { isActive: false };
        actionType = 'suspend_retailer';
        actionMessage = 'suspended';
        break;
      default:
        console.log('❌ [RETAILERS] Invalid action:', action);
        return res.status(400).json({
          success: false,
          message: 'Invalid action. Use: activate, suspend'
        });
    }

    const previousStatus = retailer.isActive;

    await Admin.findByIdAndUpdate(id, update);

    // Log action using console.log instead of req.superadmin.logAction
    console.log('🏪 [RETAILERS] SuperAdmin updated retailer status:', {
      userId: req.user._id,
      retailerId: retailer._id.toString(),
      retailerName: retailer.shopName,
      action,
      reason,
      previousStatus,
      newStatus: update.isActive
    });

    res.json({
      success: true,
      message: `Retailer ${actionMessage} successfully`,
      data: {
        retailerId: retailer._id,
        shopName: retailer.shopName,
        previousStatus,
        newStatus: update.isActive,
        reason: reason || 'No reason provided'
      }
    });

  } catch (error) {
    console.error('❌ [RETAILERS] Update retailer status error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update retailer status',
      error: error.message
    });
  }
};

// NEW: Get retailer performance analytics
export const getRetailerPerformance = async (req, res) => {
  try {
    const { id } = req.params;
    const { timeframe = 'month' } = req.query;

    const retailer = await Admin.findById(id);
    if (!retailer) {
      return res.status(404).json({
        success: false,
        message: 'Retailer not found'
      });
    }

    const dateRange = getDateRange(timeframe);

    const performance = await Order.aggregate([
      {
        $match: {
          assignedRetailer: retailer._id,
          createdAt: { $gte: dateRange.start },
          orderStatus: { $ne: 'cancelled' }
        }
      },
      {
        $group: {
          _id: {
            $dateToString: { format: "%Y-%m-%d", date: "$createdAt" }
          },
          dailyOrders: { $sum: 1 },
          dailyRevenue: { $sum: '$finalAmount' }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    const stats = await Order.aggregate([
      {
        $match: {
          assignedRetailer: retailer._id,
          createdAt: { $gte: dateRange.start }
        }
      },
      {
        $group: {
          _id: '$orderStatus',
          count: { $sum: 1 }
        }
      }
    ]);

    await req.superadmin.logAction(
      'view_retailer_performance',
      'retailers',
      retailer._id,
      { retailerId: retailer._id.toString(), timeframe }
    );

    res.json({
      success: true,
      data: {
        performance,
        stats: stats.reduce((acc, curr) => {
          acc[curr._id] = curr.count;
          return acc;
        }, {}),
        timeframe
      }
    });

  } catch (error) {
    console.error('Get retailer performance error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch retailer performance',
      error: error.message
    });
  }
};

// Helper function for date ranges
const getDateRange = (timeframe) => {
  const now = new Date();
  let start;
  
  switch (timeframe) {
    case 'today':
      start = new Date(now.setHours(0, 0, 0, 0));
      break;
    case 'week':
      start = new Date(now.setDate(now.getDate() - 7));
      break;
    case 'month':
      start = new Date(now.setMonth(now.getMonth() - 1));
      break;
    case 'year':
      start = new Date(now.setFullYear(now.getFullYear() - 1));
      break;
    default:
      start = new Date(now.setHours(0, 0, 0, 0));
  }
  
  return { start, end: new Date() };
};


