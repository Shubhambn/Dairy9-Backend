// controllers/superadmin.reports.controller.js
import Order from '../models/order.model.js';
import Admin from '../models/admin.model.js';
import Customer from '../models/customer.model.js';

export const generateSalesReport = async (req, res) => {
  try {
    console.log('📈 [REPORTS] Starting sales report generation');
    
    // Use req.user instead of req.superadmin
    if (!req.user) {
      console.error('❌ [REPORTS] req.user is undefined!');
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }

    console.log('✅ [REPORTS] Authenticated user:', {
      id: req.user._id,
      phone: req.user.phone,
      role: req.user.role
    });

    const { startDate, endDate, reportType = 'daily', retailerId } = req.query;

    console.log('📈 [REPORTS] Query params:', { startDate, endDate, reportType, retailerId });

    // Set default dates if not provided
    const start = startDate ? new Date(startDate) : new Date(new Date().setDate(new Date().getDate() - 30));
    const end = endDate ? new Date(endDate) : new Date();
    end.setHours(23, 59, 59, 999);

    let groupFormat = '%Y-%m-%d'; // daily
    
    if (reportType === 'weekly') groupFormat = '%Y-%U';
    if (reportType === 'monthly') groupFormat = '%Y-%m';

    // Build match filter
    const matchFilter = {
      createdAt: { $gte: start, $lte: end },
      orderStatus: { $ne: 'cancelled' }
    };

    // Add retailer filter if specified
    if (retailerId) {
      matchFilter.assignedRetailer = retailerId;
    }

    const salesReport = await Order.aggregate([
      {
        $match: matchFilter
      },
      {
        $group: {
          _id: {
            $dateToString: { format: groupFormat, date: "$createdAt" }
          },
          totalRevenue: { $sum: '$finalAmount' },
          totalOrders: { $sum: 1 },
          averageOrderValue: { $avg: '$finalAmount' },
          completedOrders: {
            $sum: { $cond: [{ $eq: ['$orderStatus', 'delivered'] }, 1, 0] }
          }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    // Get additional summary statistics
    const summaryStats = await Order.aggregate([
      {
        $match: matchFilter
      },
      {
        $group: {
          _id: null,
          totalRevenue: { $sum: '$finalAmount' },
          totalOrders: { $sum: 1 },
          averageOrderValue: { $avg: '$finalAmount' },
          completedOrders: {
            $sum: { $cond: [{ $eq: ['$orderStatus', 'delivered'] }, 1, 0] }
          },
          cancelledOrders: {
            $sum: { $cond: [{ $eq: ['$orderStatus', 'cancelled'] }, 1, 0] }
          }
        }
      }
    ]);

    const summary = summaryStats[0] || {
      totalRevenue: 0,
      totalOrders: 0,
      averageOrderValue: 0,
      completedOrders: 0,
      cancelledOrders: 0
    };

    // Log action using console.log
    console.log('📈 [REPORTS] SuperAdmin generated sales report:', {
      userId: req.user._id,
      startDate: start.toISOString(),
      endDate: end.toISOString(),
      reportType,
      retailerId: retailerId || 'all',
      totalOrders: summary.totalOrders,
      totalRevenue: summary.totalRevenue
    });

    res.json({
      success: true,
      data: {
        report: salesReport,
        summary: {
          totalRevenue: summary.totalRevenue,
          totalOrders: summary.totalOrders,
          completedOrders: summary.completedOrders,
          cancelledOrders: summary.cancelledOrders,
          averageOrderValue: summary.averageOrderValue,
          completionRate: summary.totalOrders > 0 ? (summary.completedOrders / summary.totalOrders) * 100 : 0,
          period: { start, end }
        },
        filters: {
          reportType,
          retailerId: retailerId || 'all'
        }
      }
    });

  } catch (error) {
    console.error('❌ [REPORTS] Sales report error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to generate sales report',
      error: error.message
    });
  }
};

export const generateRetailerPerformanceReport = async (req, res) => {
  try {
    console.log('📈 [REPORTS] Starting retailer performance report');
    
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }

    const { startDate, endDate, limit = 10 } = req.query;

    const start = startDate ? new Date(startDate) : new Date(new Date().setDate(new Date().getDate() - 30));
    const end = endDate ? new Date(endDate) : new Date();
    end.setHours(23, 59, 59, 999);

    const retailerPerformance = await Order.aggregate([
      {
        $match: {
          createdAt: { $gte: start, $lte: end },
          orderStatus: { $ne: 'cancelled' },
          assignedRetailer: { $exists: true, $ne: null }
        }
      },
      {
        $lookup: {
          from: 'admins',
          localField: 'assignedRetailer',
          foreignField: '_id',
          as: 'retailerInfo'
        }
      },
      { $unwind: '$retailerInfo' },
      {
        $group: {
          _id: '$assignedRetailer',
          retailerName: { $first: '$retailerInfo.shopName' },
          ownerName: { $first: '$retailerInfo.fullName' },
          totalOrders: { $sum: 1 },
          totalRevenue: { $sum: '$finalAmount' },
          completedOrders: {
            $sum: { $cond: [{ $eq: ['$orderStatus', 'delivered'] }, 1, 0] }
          },
          averageOrderValue: { $avg: '$finalAmount' }
        }
      },
      {
        $project: {
          retailerName: 1,
          ownerName: 1,
          totalOrders: 1,
          totalRevenue: 1,
          completedOrders: 1,
          averageOrderValue: 1,
          completionRate: {
            $multiply: [
              { $divide: ['$completedOrders', '$totalOrders'] },
              100
            ]
          }
        }
      },
      { $sort: { totalRevenue: -1 } },
      { $limit: parseInt(limit) }
    ]);

    // Log action using console.log
    console.log('📈 [REPORTS] SuperAdmin generated retailer performance report:', {
      userId: req.user._id,
      startDate: start.toISOString(),
      endDate: end.toISOString(),
      limit,
      retailerCount: retailerPerformance.length
    });

    res.json({
      success: true,
      data: {
        retailers: retailerPerformance,
        summary: {
          totalRetailers: retailerPerformance.length,
          totalRevenue: retailerPerformance.reduce((sum, retailer) => sum + retailer.totalRevenue, 0),
          totalOrders: retailerPerformance.reduce((sum, retailer) => sum + retailer.totalOrders, 0),
          period: { start, end }
        }
      }
    });

  } catch (error) {
    console.error('❌ [REPORTS] Retailer performance report error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to generate retailer performance report',
      error: error.message
    });
  }
};

// Update other report functions similarly...

// controllers/superadmin.reports.controller.js - Update the customer analytics function
// controllers/superadmin.reports.controller.js
export const generateCustomerAnalyticsReport = async (req, res) => {
  try {
    console.log('📈 [REPORTS] Starting optimized customer analytics report');
    
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }

    const { startDate, endDate, limit = 50 } = req.query;

    console.log('📈 [REPORTS] Customer analytics query params:', { startDate, endDate, limit });

    // Use smaller default date range (7 days instead of 30)
    const start = startDate ? new Date(startDate) : new Date(new Date().setDate(new Date().getDate() - 7));
    const end = endDate ? new Date(endDate) : new Date();
    end.setHours(23, 59, 59, 999);

    console.log('📈 [REPORTS] Optimized date range:', { start, end });

    // Set timeout for the entire operation
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Query timeout')), 30000); // 30 second timeout
    });

    const analyticsPromise = (async () => {
      try {
        // OPTIMIZED VERSION 1: Two separate queries instead of complex aggregation
        console.log('📈 [REPORTS] Starting optimized customer queries...');

        // Query 1: Get top customers by spending (simplified)
        const topCustomers = await Order.aggregate([
          {
            $match: {
              createdAt: { $gte: start, $lte: end },
              orderStatus: { $ne: 'cancelled' },
              customer: { $exists: true, $ne: null }
            }
          },
          {
            $group: {
              _id: '$customer',
              totalOrders: { $sum: 1 },
              totalSpent: { $sum: '$finalAmount' },
              lastOrderDate: { $max: '$createdAt' }
            }
          },
          { 
            $match: { 
              totalSpent: { $gt: 0 } // Only customers who actually spent money
            } 
          },
          { $sort: { totalSpent: -1 } },
          { $limit: parseInt(limit) }
        ]).allowDiskUse(true); // Allow disk use for large datasets

        console.log('✅ [REPORTS] Found top customers:', topCustomers.length);

        if (topCustomers.length === 0) {
          return {
            topCustomers: [],
            customerGrowth: [],
            summary: {
              totalCustomers: 0,
              totalRevenue: 0,
              averageCustomerValue: 0,
              period: { start, end }
            }
          };
        }

        // Query 2: Get customer details in separate query
        const customerIds = topCustomers.map(item => item._id);
        const customers = await Customer.find({ _id: { $in: customerIds } })
          .select('personalInfo.fullName user createdAt')
          .populate('user', 'mobile')
          .lean();

        // Create customer map
        const customerMap = {};
        customers.forEach(customer => {
          customerMap[customer._id.toString()] = {
            name: customer.personalInfo?.fullName || 'Unknown Customer',
            mobile: customer.user?.mobile || 'N/A',
            joinedDate: customer.createdAt
          };
        });

        // Combine data
        const formattedAnalytics = topCustomers.map(customer => ({
          customerId: customer._id,
          customerName: customerMap[customer._id.toString()]?.name || 'Unknown Customer',
          mobile: customerMap[customer._id.toString()]?.mobile || 'N/A',
          totalOrders: customer.totalOrders,
          totalSpent: customer.totalSpent,
          averageOrderValue: customer.totalOrders > 0 ? customer.totalSpent / customer.totalOrders : 0,
          lastOrderDate: customer.lastOrderDate,
          customerSince: customerMap[customer._id.toString()]?.joinedDate
        }));

        // Query 3: Simplified customer growth (last 15 days only)
        const customerGrowth = await Customer.aggregate([
          {
            $match: {
              createdAt: { 
                $gte: new Date(new Date().setDate(new Date().getDate() - 15)),
                $lte: end
              }
            }
          },
          {
            $group: {
              _id: {
                $dateToString: { format: "%Y-%m-%d", date: "$createdAt" }
              },
              newCustomers: { $sum: 1 }
            }
          },
          { $sort: { _id: 1 } }
        ]);

        console.log('✅ [REPORTS] Customer growth data points:', customerGrowth.length);

        return {
          topCustomers: formattedAnalytics,
          customerGrowth,
          summary: {
            totalCustomers: formattedAnalytics.length,
            totalRevenue: formattedAnalytics.reduce((sum, customer) => sum + customer.totalSpent, 0),
            averageCustomerValue: formattedAnalytics.length > 0 ? 
              formattedAnalytics.reduce((sum, customer) => sum + customer.totalSpent, 0) / formattedAnalytics.length : 0,
            period: { start, end }
          }
        };

      } catch (dbError) {
        console.error('❌ [REPORTS] Database query error:', dbError);
        throw dbError;
      }
    })();

    // Race between analytics and timeout
    const result = await Promise.race([analyticsPromise, timeoutPromise]);

    // Log action
    console.log('📈 [REPORTS] SuperAdmin generated customer analytics report:', {
      userId: req.user._id,
      startDate: start.toISOString(),
      endDate: end.toISOString(),
      customerCount: result.topCustomers.length,
      growthDataPoints: result.customerGrowth.length
    });

    res.json({
      success: true,
      data: result
    });

  } catch (error) {
    console.error('❌ [REPORTS] Customer analytics report error:', error);
    
    if (error.message === 'Query timeout') {
      return res.status(408).json({
        success: false,
        message: 'Customer analytics query timed out',
        error: 'Database query taking too long. Try a smaller date range or fewer records.',
        suggestion: 'Try using a date range of 7 days or less'
      });
    }

    res.status(500).json({
      success: false,
      message: 'Failed to generate customer analytics report',
      error: error.message
    });
  }
};


export const generateSystemOverviewReport = async (req, res) => {
  try {
    console.log('📈 [REPORTS] Starting system overview report');
    
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }

    // ... existing system overview code ...

    // Log action using console.log
    console.log('📈 [REPORTS] SuperAdmin generated system overview report:', {
      userId: req.user._id
    });

    // ... send response

  } catch (error) {
    console.error('❌ [REPORTS] System overview report error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to generate system overview report',
      error: error.message
    });
  }
};


// Customer Analytics Report
// export const generateCustomerAnalyticsReport = async (req, res) => {
//   try {
//     const { startDate, endDate } = req.query;

//     const start = startDate ? new Date(startDate) : new Date(new Date().setMonth(new Date().getMonth() - 1));
//     const end = endDate ? new Date(endDate) : new Date();
//     end.setHours(23, 59, 59, 999);

//     const customerAnalytics = await Order.aggregate([
//       {
//         $match: {
//           createdAt: { $gte: start, $lte: end },
//           orderStatus: { $ne: 'cancelled' }
//         }
//       },
//       {
//         $lookup: {
//           from: 'customers',
//           localField: 'customer',
//           foreignField: '_id',
//           as: 'customerInfo'
//         }
//       },
//       { $unwind: '$customerInfo' },
//       {
//         $group: {
//           _id: '$customer',
//           customerName: { $first: '$customerInfo.personalInfo.fullName' },
//           totalOrders: { $sum: 1 },
//           totalSpent: { $sum: '$finalAmount' },
//           averageOrderValue: { $avg: '$finalAmount' },
//           firstOrderDate: { $min: '$createdAt' },
//           lastOrderDate: { $max: '$createdAt' }
//         }
//       },
//       {
//         $project: {
//           customerName: 1,
//           totalOrders: 1,
//           totalSpent: 1,
//           averageOrderValue: 1,
//           firstOrderDate: 1,
//           lastOrderDate: 1,
//           customerSince: '$firstOrderDate'
//         }
//       },
//       { $sort: { totalSpent: -1 } },
//       { $limit: 50 }
//     ]);

//     // Get customer growth stats
//     const customerGrowth = await Customer.aggregate([
//       {
//         $match: {
//           createdAt: { $gte: start, $lte: end }
//         }
//       },
//       {
//         $group: {
//           _id: {
//             $dateToString: { format: "%Y-%m-%d", date: "$createdAt" }
//           },
//           newCustomers: { $sum: 1 }
//         }
//       },
//       { $sort: { _id: 1 } }
//     ]);

//     await req.superadmin.logAction(
//       'generate_customer_analytics_report',
//       'reports',
//       null,
//       { startDate, endDate }
//     );

//     res.json({
//       success: true,
//       data: {
//         topCustomers: customerAnalytics,
//         customerGrowth,
//         summary: {
//           totalCustomers: customerAnalytics.length,
//           totalRevenue: customerAnalytics.reduce((sum, customer) => sum + customer.totalSpent, 0),
//           averageCustomerValue: customerAnalytics.length > 0 ? 
//             customerAnalytics.reduce((sum, customer) => sum + customer.totalSpent, 0) / customerAnalytics.length : 0,
//           period: { start, end }
//         }
//       }
//     });

//   } catch (error) {
//     console.error('Customer analytics report error:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Failed to generate customer analytics report',
//       error: error.message
//     });
//   }
// };

// Product Performance Report
export const generateProductPerformanceReport = async (req, res) => {
  try {
    const { startDate, endDate, limit = 20 } = req.query;

    const start = startDate ? new Date(startDate) : new Date(new Date().setDate(new Date().getDate() - 30));
    const end = endDate ? new Date(endDate) : new Date();
    end.setHours(23, 59, 59, 999);

    const productPerformance = await Order.aggregate([
      {
        $match: {
          createdAt: { $gte: start, $lte: end },
          orderStatus: { $ne: 'cancelled' }
        }
      },
      { $unwind: '$items' },
      {
        $lookup: {
          from: 'products', // You need a Product model
          localField: 'items.product',
          foreignField: '_id',
          as: 'productInfo'
        }
      },
      { $unwind: { path: '$productInfo', preserveNullAndEmptyArrays: true } },
      {
        $group: {
          _id: '$items.product',
          productName: { $first: '$productInfo.name' },
          productCategory: { $first: '$productInfo.category' },
          totalQuantity: { $sum: '$items.quantity' },
          totalRevenue: { $sum: { $multiply: ['$items.quantity', '$items.price'] } },
          averagePrice: { $avg: '$items.price' },
          orderCount: { $sum: 1 }
        }
      },
      {
        $project: {
          productName: 1,
          productCategory: 1,
          totalQuantity: 1,
          totalRevenue: 1,
          averagePrice: 1,
          orderCount: 1
        }
      },
      { $sort: { totalRevenue: -1 } },
      { $limit: parseInt(limit) }
    ]);

    await req.superadmin.logAction(
      'generate_product_performance_report',
      'reports',
      null,
      { startDate, endDate, limit }
    );

    res.json({
      success: true,
      data: {
        products: productPerformance,
        summary: {
          totalProducts: productPerformance.length,
          totalRevenue: productPerformance.reduce((sum, product) => sum + product.totalRevenue, 0),
          totalQuantity: productPerformance.reduce((sum, product) => sum + product.totalQuantity, 0),
          period: { start, end }
        }
      }
    });

  } catch (error) {
    console.error('Product performance report error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to generate product performance report',
      error: error.message
    });
  }
};

// System Overview Report
// export const generateSystemOverviewReport = async (req, res) => {
//   try {
//     const [retailerStats, customerStats, orderStats, recentGrowth] = await Promise.all([
//       // Retailer Statistics
//       Admin.aggregate([
//         {
//           $group: {
//             _id: null,
//             totalRetailers: { $sum: 1 },
//             activeRetailers: { $sum: { $cond: ['$isActive', 1, 0] } },
//             averageServiceRadius: { $avg: '$serviceRadius' }
//           }
//         }
//       ]),

//       // Customer Statistics
//       Customer.aggregate([
//         {
//           $group: {
//             _id: null,
//             totalCustomers: { $sum: 1 },
//             customersWithOrders: {
//               $sum: {
//                 $cond: [{ $gt: [{ $size: '$orderHistory' }, 0] }, 1, 0]
//               }
//             }
//           }
//         }
//       ]),

//       // Order Statistics (last 30 days)
//       Order.aggregate([
//         {
//           $match: {
//             createdAt: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) }
//           }
//         },
//         {
//           $group: {
//             _id: '$orderStatus',
//             count: { $sum: 1 },
//             revenue: { $sum: '$finalAmount' }
//           }
//         }
//       ]),

//       // Growth metrics (last 7 days vs previous 7 days)
//       Order.aggregate([
//         {
//           $facet: {
//             currentWeek: [
//               {
//                 $match: {
//                   createdAt: { 
//                     $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) 
//                   }
//                 }
//               },
//               {
//                 $group: {
//                   _id: null,
//                   orders: { $sum: 1 },
//                   revenue: { $sum: '$finalAmount' }
//                 }
//               }
//             ],
//             previousWeek: [
//               {
//                 $match: {
//                   createdAt: { 
//                     $gte: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000),
//                     $lt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
//                   }
//                 }
//               },
//               {
//                 $group: {
//                   _id: null,
//                   orders: { $sum: 1 },
//                   revenue: { $sum: '$finalAmount' }
//                 }
//               }
//             ]
//           }
//         }
//       ])
//     ]);

//     const retailerData = retailerStats[0] || { totalRetailers: 0, activeRetailers: 0 };
//     const customerData = customerStats[0] || { totalCustomers: 0, customersWithOrders: 0 };
    
//     const orderStatusSummary = orderStats.reduce((acc, curr) => {
//       acc[curr._id] = { count: curr.count, revenue: curr.revenue };
//       return acc;
//     }, {});

//     const growthData = recentGrowth[0];
//     const currentWeek = growthData?.currentWeek[0] || { orders: 0, revenue: 0 };
//     const previousWeek = growthData?.previousWeek[0] || { orders: 0, revenue: 0 };

//     const orderGrowth = previousWeek.orders > 0 ? 
//       ((currentWeek.orders - previousWeek.orders) / previousWeek.orders) * 100 : 0;
    
//     const revenueGrowth = previousWeek.revenue > 0 ? 
//       ((currentWeek.revenue - previousWeek.revenue) / previousWeek.revenue) * 100 : 0;

//     await req.superadmin.logAction(
//       'generate_system_overview_report',
//       'reports',
//       null,
//       {}
//     );

//     res.json({
//       success: true,
//       data: {
//         retailerStats: retailerData,
//         customerStats: customerData,
//         orderStats: orderStatusSummary,
//         growthMetrics: {
//           orderGrowth,
//           revenueGrowth,
//           currentWeek,
//           previousWeek
//         },
//         generatedAt: new Date()
//       }
//     });

//   } catch (error) {
//     console.error('System overview report error:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Failed to generate system overview report',
//       error: error.message
//     });
//   }
// };