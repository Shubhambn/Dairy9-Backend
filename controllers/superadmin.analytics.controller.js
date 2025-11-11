// controllers/superadmin.analytics.controller.js
import Admin from '../models/admin.model.js';
import Customer from '../models/customer.model.js';
import Order from '../models/order.model.js';
import User from '../models/user.model.js';

// Add timeout utility
const withTimeout = (promise, timeoutMs = 10000) => {
  return Promise.race([
    promise,
    new Promise((_, reject) => 
      setTimeout(() => reject(new Error(`Operation timed out after ${timeoutMs}ms`)), timeoutMs)
    )
  ]);
};

export const getDashboardOverview = async (req, res) => {
  try {
    console.log('📊 [DASHBOARD] Starting dashboard overview request');
    
    // Use req.user instead of req.superadmin
    if (!req.user) {
      console.error('❌ [DASHBOARD] req.user is undefined!');
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }

    console.log('✅ [DASHBOARD] Authenticated user:', {
      id: req.user._id,
      phone: req.user.phone,
      role: req.user.role
    });

    const { timeframe = 'today' } = req.query;
    console.log('📊 [DASHBOARD] Timeframe:', timeframe);
    
    // Get date ranges
    const dateRange = getDateRange(timeframe);
    console.log('📊 [DASHBOARD] Date range:', dateRange);
    
    console.log('📊 [DASHBOARD] Starting data fetching with timeouts...');

    try {
      // Parallel data fetching for performance WITH TIMEOUTS
      const [
        totalRetailers,
        activeRetailers,
        totalCustomers,
        newCustomers,
        totalOrders,
        revenue,
        topProducts,
        recentActivities
      ] = await Promise.all([
        // Total retailers count
        withTimeout(Admin.countDocuments({ isActive: true }), 5000),
        
        // Active retailers (with recent activity)
        withTimeout(Admin.countDocuments({ 
          isActive: true,
          updatedAt: { $gte: dateRange.start } 
        }), 5000),
        
        // Total customers
        withTimeout(Customer.countDocuments(), 5000),
        
        // New customers in timeframe
        withTimeout(Customer.countDocuments({ 
          createdAt: { $gte: dateRange.start } 
        }), 5000),
        
        // Order statistics
        withTimeout(Order.aggregate([
          {
            $match: {
              createdAt: { $gte: dateRange.start },
              orderStatus: { $ne: 'cancelled' }
            }
          },
          {
            $group: {
              _id: null,
              totalOrders: { $sum: 1 },
              totalRevenue: { $sum: '$finalAmount' },
              averageOrder: { $avg: '$finalAmount' }
            }
          }
        ]), 8000),
        
        // Revenue trend (last 7 days)
        withTimeout(Order.aggregate([
          {
            $match: {
              createdAt: { 
                $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) 
              },
              orderStatus: { $ne: 'cancelled' }
            }
          },
          {
            $group: {
              _id: {
                $dateToString: { format: "%Y-%m-%d", date: "$createdAt" }
              },
              revenue: { $sum: '$finalAmount' },
              orders: { $sum: 1 }
            }
          },
          { $sort: { _id: 1 } }
        ]), 8000),
        
        // Top selling products (simplified without product lookup)
        withTimeout(Order.aggregate([
          {
            $match: {
              createdAt: { $gte: dateRange.start },
              orderStatus: { $ne: 'cancelled' }
            }
          },
          { $unwind: '$items' },
          {
            $group: {
              _id: '$items.product',
              totalSold: { $sum: '$items.quantity' },
              revenue: { $sum: { $multiply: ['$items.quantity', '$items.price'] } }
            }
          },
          { $sort: { totalSold: -1 } },
          { $limit: 10 }
        ]), 8000),
        
        // Recent activities
        withTimeout(Order.find({ 
          createdAt: { $gte: dateRange.start } 
        })
        .populate('customer', 'personalInfo.fullName')
        .populate('assignedRetailer', 'shopName fullName')
        .sort({ createdAt: -1 })
        .limit(10)
        .select('orderId finalAmount orderStatus createdAt customer assignedRetailer'), 8000)
      ]);

      console.log('✅ [DASHBOARD] Data fetching completed successfully');

      const orderStats = totalOrders[0] || {
        totalOrders: 0,
        totalRevenue: 0,
        averageOrder: 0
      };

      // Format recent activities for frontend
      const formattedActivities = recentActivities.map(order => ({
        orderNumber: order.orderId,
        totalAmount: order.finalAmount,
        status: order.orderStatus,
        createdAt: order.createdAt,
        customer: order.customer ? {
          name: order.customer.personalInfo?.fullName || 'N/A'
        } : { name: 'N/A' },
        retailer: order.assignedRetailer ? {
          shopName: order.assignedRetailer.shopName,
          ownerName: order.assignedRetailer.fullName
        } : { shopName: 'Not Assigned', ownerName: 'N/A' }
      }));

      // Log action
      console.log('📊 [DASHBOARD] SuperAdmin viewed dashboard:', {
        userId: req.user._id,
        timeframe: timeframe
      });

      // Calculate growth rates
      const retailerGrowth = await calculateGrowth(Admin, 'retailers', timeframe, totalRetailers);
      const customerGrowth = await calculateGrowth(Customer, 'customers', timeframe, totalCustomers);

      console.log('✅ [DASHBOARD] Sending response...');

      res.json({
        success: true,
        data: {
          overview: {
            retailers: {
              total: totalRetailers,
              active: activeRetailers,
              growth: retailerGrowth
            },
            customers: {
              total: totalCustomers,
              new: newCustomers,
              growth: customerGrowth
            },
            orders: {
              total: orderStats.totalOrders,
              revenue: orderStats.totalRevenue,
              average: orderStats.averageOrder || 0
            }
          },
          revenueTrend: revenue,
          topProducts: topProducts.map(item => ({
            productId: item._id,
            productName: `Product-${item._id}`,
            totalSold: item.totalSold,
            revenue: item.revenue
          })),
          recentActivities: formattedActivities,
          timeframe,
          generatedAt: new Date().toISOString()
        }
      });

    } catch (timeoutError) {
      console.error('❌ [DASHBOARD] Database query timeout:', timeoutError.message);
      res.status(408).json({
        success: false,
        message: 'Request timeout - database queries taking too long',
        error: timeoutError.message
      });
    }

  } catch (error) {
    console.error('❌ [DASHBOARD] General error:', error);
    console.error('❌ [DASHBOARD] Error stack:', error.stack);
    
    res.status(500).json({
      success: false,
      message: 'Failed to fetch dashboard data',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error',
      timestamp: new Date().toISOString()
    });
  }
};

// Helper functions remain the same...
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

const calculateGrowth = async (Model, type, timeframe, currentCount) => {
  try {
    // Simplified growth calculation to avoid timeouts
    return 0; // Return 0 for now to simplify
  } catch (error) {
    console.error('❌ [GROWTH] Calculation error:', error);
    return 0;
  }
};

export const getRealTimeStats = async (req, res) => {
  try {
    console.log('📊 [REALTIME] Starting real-time stats request');
    
    // Safety check
    if (!req.superadmin) {
      console.error('❌ [REALTIME] req.superadmin is undefined!');
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const [
      pendingOrders,
      activeRetailersNow,
      todayRevenue,
      todayOrders
    ] = await Promise.all([
      Order.countDocuments({
        orderStatus: { $in: ['pending', 'confirmed'] }
      }),
      
      Admin.countDocuments({
        isActive: true,
        updatedAt: { $gte: todayStart }
      }),
      
      Order.aggregate([
        {
          $match: {
            createdAt: { $gte: todayStart },
            orderStatus: { $ne: 'cancelled' }
          }
        },
        {
          $group: {
            _id: null,
            revenue: { $sum: '$finalAmount' }
          }
        }
      ]),
      
      Order.countDocuments({
        createdAt: { $gte: todayStart }
      })
    ]);

    const revenueToday = todayRevenue[0]?.revenue || 0;

    // Log action with safety check
    if (req.superadmin && typeof req.superadmin.logAction === 'function') {
      await req.superadmin.logAction(
        'view_realtime_stats',
        'analytics',
        null,
        {}
      );
    }

    console.log('✅ [REALTIME] Sending response');

    res.json({
      success: true,
      data: {
        pendingOrders,
        activeRetailers: activeRetailersNow,
        todayRevenue: revenueToday,
        todayOrders,
        lastUpdated: new Date().toISOString()
      }
    });

  } catch (error) {
    console.error('❌ [REALTIME] Error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch real-time stats',
      error: error.message
    });
  }
};

// // Helper functions
// const getDateRange = (timeframe) => {
//   const now = new Date();
//   let start;
  
//   switch (timeframe) {
//     case 'today':
//       start = new Date(now.setHours(0, 0, 0, 0));
//       break;
//     case 'week':
//       start = new Date(now.setDate(now.getDate() - 7));
//       break;
//     case 'month':
//       start = new Date(now.setMonth(now.getMonth() - 1));
//       break;
//     case 'year':
//       start = new Date(now.setFullYear(now.getFullYear() - 1));
//       break;
//     default:
//       start = new Date(now.setHours(0, 0, 0, 0));
//   }
  
//   return { start, end: new Date() };
// };

// const calculateGrowth = async (Model, type, timeframe, currentCount) => {
//   try {
//     const now = new Date();
//     let previousStart, previousEnd;

//     switch (timeframe) {
//       case 'today':
//         previousStart = new Date(now.setDate(now.getDate() - 1));
//         previousStart.setHours(0, 0, 0, 0);
//         previousEnd = new Date(previousStart);
//         previousEnd.setHours(23, 59, 59, 999);
//         break;
//       case 'week':
//         previousStart = new Date(now.setDate(now.getDate() - 14));
//         previousEnd = new Date(now.setDate(now.getDate() + 7));
//         break;
//       case 'month':
//         previousStart = new Date(now.setMonth(now.getMonth() - 2));
//         previousEnd = new Date(now.setMonth(now.getMonth() + 1));
//         break;
//       case 'year':
//         previousStart = new Date(now.setFullYear(now.getFullYear() - 2));
//         previousEnd = new Date(now.setFullYear(now.getFullYear() + 1));
//         break;
//       default:
//         return 0;
//     }

//     let previousCount;
    
//     if (type === 'retailers') {
//       previousCount = await Model.countDocuments({
//         isActive: true,
//         createdAt: { $gte: previousStart, $lte: previousEnd }
//       });
//     } else {
//       previousCount = await Model.countDocuments({
//         createdAt: { $gte: previousStart, $lte: previousEnd }
//       });
//     }

//     if (!previousCount || previousCount === 0) return 0;
    
//     return Number(((currentCount - previousCount) / previousCount * 100).toFixed(2));
//   } catch (error) {
//     console.error('❌ [GROWTH] Calculation error:', error);
//     return 0;
//   }
// };

// Make sure all exports are present
export default {
  getDashboardOverview,
  getRealTimeStats
};