// controllers/superadmin.analytics.controller.js
import Admin from '../models/admin.model.js';
import Customer from '../models/customer.model.js';
import Order from '../models/order.model.js';
import User from '../models/user.model.js';
import { DateTime, Duration } from 'luxon';

// Add timeout utility
const withTimeout = (promise, timeoutMs = 10000) => {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`Operation timed out after ${timeoutMs}ms`)), timeoutMs)
    )
  ]);
};

const TIMEZONE = 'Asia/Kolkata';

export const getDashboardOverview = async (req, res) => {
  try {
    console.log('📊 [DASHBOARD] Starting dashboard overview request');

    // Unified auth check - require authenticated user with superadmin role
    if (!req.user || req.user.role !== 'superadmin') {
      console.error('❌ [DASHBOARD] Unauthorized: missing req.user or not superadmin');
      return res.status(401).json({
        success: false,
        message: 'Authentication required (superadmin)'
      });
    }

    console.log('✅ [DASHBOARD] Authenticated user:', {
      id: req.user._id,
      phone: req.user.phone,
      role: req.user.role
    });

    const { timeframe = 'today' } = req.query;
    console.log('📊 [DASHBOARD] Timeframe:', timeframe);

    // Get date ranges (IST-aware)
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
        orderAgg,
        revenueTrend,
        topProducts,
        recentActivities
      ] = await Promise.all([
        // Total retailers count
        withTimeout(Admin.countDocuments({ isActive: true }), 5000),

        // Active retailers (with recent activity since start)
        withTimeout(Admin.countDocuments({
          isActive: true,
          updatedAt: { $gte: dateRange.start }
        }), 5000),

        // Total customers
        withTimeout(Customer.countDocuments(), 5000),

        // New customers in timeframe
        withTimeout(Customer.countDocuments({
          createdAt: { $gte: dateRange.start, $lte: dateRange.end }
        }), 5000),

        // Order statistics for timeframe
        withTimeout(Order.aggregate([
          {
            $match: {
              createdAt: { $gte: dateRange.start, $lte: dateRange.end },
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

        // Revenue trend — last N days relative to timeframe.end (we keep 7 days window)
        withTimeout(Order.aggregate([
          {
            $match: {
              createdAt: {
                $gte: new Date(DateTime.fromJSDate(dateRange.end).minus({ days: 6 }).startOf('day').toISO()),
                $lte: dateRange.end
              },
              orderStatus: { $ne: 'cancelled' }
            }
          },
          {
            $group: {
              _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
              revenue: { $sum: '$finalAmount' },
              orders: { $sum: 1 }
            }
          },
          { $sort: { _id: 1 } }
        ]), 8000),

        // Top selling products in timeframe
        withTimeout(Order.aggregate([
          {
            $match: {
              createdAt: { $gte: dateRange.start, $lte: dateRange.end },
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

        // Recent activities (orders) within timeframe
        withTimeout(Order.find({
          createdAt: { $gte: dateRange.start, $lte: dateRange.end }
        })
          .populate('customer', 'personalInfo.fullName')
          .populate('assignedRetailer', 'shopName fullName')
          .sort({ createdAt: -1 })
          .limit(10)
          .select('orderId finalAmount orderStatus createdAt customer assignedRetailer'), 8000)
      ]);

      console.log('✅ [DASHBOARD] Data fetching completed successfully');

      const orderStats = (orderAgg && orderAgg[0]) ? orderAgg[0] : {
        totalOrders: 0,
        totalRevenue: 0,
        averageOrder: 0
      };

      // Format recent activities for frontend
      const formattedActivities = (recentActivities || []).map(order => ({
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
        timeframe
      });

      // Calculate growth rates (pass numeric counts)
      const retailerGrowth = await calculateGrowth(Admin, 'retailers', timeframe, totalRetailers, dateRange);
      const customerGrowth = await calculateGrowth(Customer, 'customers', timeframe, totalCustomers, dateRange);

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
          revenueTrend,
          topProducts: (topProducts || []).map(item => ({
            productId: item._id,
            productName: `Product-${item._id}`,
            totalSold: item.totalSold,
            revenue: item.revenue
          })),
          recentActivities: formattedActivities,
          timeframe,
          generatedAt: DateTime.now().setZone(TIMEZONE).toISO()
        }
      });

    } catch (timeoutError) {
      console.error('❌ [DASHBOARD] Database query timeout:', timeoutError.message);
      return res.status(408).json({
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
      timestamp: DateTime.now().setZone(TIMEZONE).toISO()
    });
  }
};
const fmt = (dt) => DateTime.fromJSDate(dt).setZone(TIMEZONE).toFormat('yyyy-LL-dd HH:mm:ss ZZZZ');
const logDateRange = (label, range) => {
  console.log(`${label} (UTC) -> start: ${range.start.toISOString()}, end: ${range.end.toISOString()}`);
  console.log(`${label} (IST) -> start: ${fmt(range.start)}, end: ${fmt(range.end)}`);
};
export const getRealTimeStats = async (req, res) => {
  try {
    console.log('📊 [REALTIME] Starting real-time stats request');

    if (!req.user || req.user.role !== 'superadmin') {
      console.error('❌ [REALTIME] Unauthorized: missing req.user or not superadmin');
      return res.status(401).json({
        success: false,
        message: 'Authentication required (superadmin)'
      });
    }

    // Use the same IST-aligned 'today' window as overview
    const { start: todayStart, end: todayEnd } = getDateRange('today');
    logDateRange('📊 [REALTIME] Today range', { start: todayStart, end: todayEnd });

    try {
      // Use withTimeout to avoid long-running DB ops
      const [
        pendingOrders,
        activeRetailersNow,
        todayRevenueAgg,
        todayOrders
      ] = await Promise.all([
        // Pending/confirmed orders count (within today)
        withTimeout(Order.countDocuments({
          createdAt: { $gte: todayStart, $lte: todayEnd },
          orderStatus: { $in: ['pending', 'confirmed'] }
        }), 5000),

        // Active retailers updated within today window
        withTimeout(Admin.countDocuments({
          isActive: true,
          updatedAt: { $gte: todayStart, $lte: todayEnd }
        }), 5000),

        // Revenue for today (exclude cancelled)
        withTimeout(Order.aggregate([
          {
            $match: {
              createdAt: { $gte: todayStart, $lte: todayEnd },
              orderStatus: { $ne: 'cancelled' }
            }
          },
          {
            $group: {
              _id: null,
              revenue: { $sum: '$finalAmount' }
            }
          }
        ]), 5000),

        // Total orders today (exclude cancelled? keep consistent with overview — here we include all created today)
        withTimeout(Order.countDocuments({
          createdAt: { $gte: todayStart, $lte: todayEnd }
        }), 5000)
      ]);

      const revenueToday = (todayRevenueAgg && todayRevenueAgg[0] && todayRevenueAgg[0].revenue) ? todayRevenueAgg[0].revenue : 0;

      // Log action (safe check)
      if (req.user && typeof req.user.logAction === 'function') {
        try {
          await req.user.logAction('view_realtime_stats', 'analytics', null, {});
        } catch (e) {
          console.warn('⚠️ [REALTIME] logAction failed:', e.message);
        }
      }

      console.log('✅ [REALTIME] Data ready');
      console.log('📊 [REALTIME] lastUpdated (UTC):', new Date().toISOString());
      console.log('📊 [REALTIME] lastUpdated (IST):', DateTime.now().setZone(TIMEZONE).toFormat('yyyy-LL-dd HH:mm:ss ZZZZ'));

      return res.json({
        success: true,
        data: {
          pendingOrders,
          activeRetailers: activeRetailersNow,
          todayRevenue: revenueToday,
          todayOrders,
          lastUpdated: DateTime.now().setZone(TIMEZONE).toISO()
        }
      });
    } catch (dbError) {
      console.error('❌ [REALTIME] DB error or timeout:', dbError.message);
      return res.status(500).json({
        success: false,
        message: 'Failed to fetch real-time stats',
        error: dbError.message
      });
    }

  } catch (error) {
    console.error('❌ [REALTIME] Uncaught error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch real-time stats',
      error: error.message
    });
  }
};


// Helper functions

/**
 * Returns { start: Date, end: Date } for the given timeframe in Asia/Kolkata timezone.
 * start/end are JS Date objects (UTC timestamps) suitable for MongoDB queries.
 */
const getDateRange = (timeframe) => {
  const now = DateTime.now().setZone(TIMEZONE);
  let startDt, endDt;

  switch (timeframe) {
    case 'today':
      startDt = now.startOf('day');
      endDt = now.endOf('day');
      break;
    case 'week':
      // last 7 full days including today (adjust if you prefer week starting Monday)
      startDt = now.minus({ days: 6 }).startOf('day'); // 7-day window
      endDt = now.endOf('day');
      break;
    case 'month':
      startDt = now.minus({ months: 1 }).startOf('day');
      endDt = now.endOf('day');
      break;
    case 'year':
      startDt = now.minus({ years: 1 }).startOf('day');
      endDt = now.endOf('day');
      break;
    default:
      startDt = now.startOf('day');
      endDt = now.endOf('day');
  }

  // Convert to JS Date (UTC timestamps) for MongoDB queries
  return {
    start: startDt.toJSDate(),
    end: endDt.toJSDate()
  };
};

/**
 * Calculate growth percentage between currentCount and previous period count.
 * previous period is the same duration immediately before current period.
 * Returns percentage (rounded to 2 decimals) or 0 if previousCount is 0.
 */
const calculateGrowth = async (Model, type, timeframe, currentCount = 0, currentDateRange = null) => {
  try {
    // Build current range if not provided
    const currentRange = currentDateRange || getDateRange(timeframe);
    const { start: currentStart, end: currentEnd } = currentRange;

    // Determine duration between start and end (in milliseconds)
    const durationMs = currentEnd.getTime() - currentStart.getTime();

    // previous period ends right before currentStart, and spans the same duration
    const previousEnd = new Date(currentStart.getTime() - 1);
    const previousStart = new Date(previousEnd.getTime() - durationMs + 1);

    let query = {};
    if (type === 'retailers') {
      // For retailers we consider isActive true + createdAt in previous window
      query = {
        isActive: true,
        createdAt: { $gte: previousStart, $lte: previousEnd }
      };
    } else {
      query = {
        createdAt: { $gte: previousStart, $lte: previousEnd }
      };
    }

    const previousCount = await Model.countDocuments(query);

    if (!previousCount || previousCount === 0) return 0;

    const growth = ((currentCount - previousCount) / previousCount) * 100;
    return Number(growth.toFixed(2));
  } catch (error) {
    console.error('❌ [GROWTH] Calculation error:', error);
    return 0;
  }
};

// Make sure all exports are present
export default {
  getDashboardOverview,
  getRealTimeStats
};
