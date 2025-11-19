// services/revenueCalculation.service.js
import Order from '../models/order.model.js';
import RetailerInventory from '../models/retailerInventory.model.js';

class RevenueCalculationService {
  
  /**
   * Calculate revenue metrics for retailer with time filters
   */
  async calculateRevenueMetrics(retailerId, timeFilter = 'all') {
    try {
      const { startDate, endDate } = this.getDateRange(timeFilter);
      
      console.log(`💰 Calculating revenue for retailer ${retailerId} from ${startDate} to ${endDate}`);

      // Get all DELIVERED orders (completed transactions) within date range
      const deliveredOrders = await Order.find({
        assignedRetailer: retailerId,
        orderStatus: 'delivered',
        deliveredAt: {
          $gte: startDate,
          $lte: endDate
        }
      }).populate('items.product', 'name category');

      console.log(`📦 Found ${deliveredOrders.length} delivered orders for revenue calculation`);

      // Calculate metrics from actual orders
      const revenueData = this.calculateMetricsFromOrders(deliveredOrders);
      
      // Get current inventory value
      const inventoryValue = await this.getCurrentInventoryValue(retailerId);

      return {
        ...revenueData,
        inventoryValue,
        timePeriod: {
          filter: timeFilter,
          startDate,
          endDate
        },
        orderCount: deliveredOrders.length
      };

    } catch (error) {
      console.error('Revenue calculation error:', error);
      throw error;
    }
  }

  /**
   * Calculate metrics directly from order data
   */
  calculateMetricsFromOrders(orders) {
    let totalRevenue = 0;
    let totalSales = 0;
    let totalItemsSold = 0;
    let totalDiscount = 0;
    
    // Product-wise analytics
    const productMetrics = {};
    const categoryMetrics = {};

    orders.forEach(order => {
      // Use FINAL amount from order (this includes all overrides and discounts)
      const orderTotal = order.finalAmount || order.totalAmount || 0;
      totalSales += orderTotal;

      // Calculate revenue (sales - cost)
      let orderRevenue = 0;
      let orderItemsSold = 0;
      let orderDiscount = order.discount || 0;

      order.items.forEach(item => {
        const quantity = item.quantity || 0;
        const sellingPrice = item.price || 0; // This is the ACTUAL charged price
        const costPrice = item.costPrice || 0;
        
        orderItemsSold += quantity;
        
        // Revenue = (Selling Price - Cost Price) * Quantity
        const itemRevenue = (sellingPrice - costPrice) * quantity;
        orderRevenue += itemRevenue;

        // Track product metrics
        const productId = item.product?._id?.toString() || 'unknown';
        const productName = item.product?.name || 'Unknown Product';
        const category = item.product?.category || 'Uncategorized';

        if (!productMetrics[productId]) {
          productMetrics[productId] = {
            productId,
            productName,
            category,
            quantitySold: 0,
            totalSales: 0,
            totalRevenue: 0
          };
        }

        productMetrics[productId].quantitySold += quantity;
        productMetrics[productId].totalSales += sellingPrice * quantity;
        productMetrics[productId].totalRevenue += itemRevenue;

        // Track category metrics
        if (!categoryMetrics[category]) {
          categoryMetrics[category] = {
            category,
            quantitySold: 0,
            totalSales: 0,
            totalRevenue: 0
          };
        }

        categoryMetrics[category].quantitySold += quantity;
        categoryMetrics[category].totalSales += sellingPrice * quantity;
        categoryMetrics[category].totalRevenue += itemRevenue;
      });

      totalRevenue += orderRevenue;
      totalItemsSold += orderItemsSold;
      totalDiscount += orderDiscount;
    });

    // Calculate averages and percentages
    const averageOrderValue = orders.length > 0 ? totalSales / orders.length : 0;
    const profitMargin = totalSales > 0 ? (totalRevenue / totalSales) * 100 : 0;

    // Sort top products by revenue
    const topProducts = Object.values(productMetrics)
      .sort((a, b) => b.totalRevenue - a.totalRevenue)
      .slice(0, 10);

    // Sort categories by revenue
    const topCategories = Object.values(categoryMetrics)
      .sort((a, b) => b.totalRevenue - a.totalRevenue);

    return {
      totalSales: Math.round(totalSales * 100) / 100,
      totalRevenue: Math.round(totalRevenue * 100) / 100,
      totalItemsSold,
      totalDiscount: Math.round(totalDiscount * 100) / 100,
      averageOrderValue: Math.round(averageOrderValue * 100) / 100,
      profitMargin: Math.round(profitMargin * 100) / 100,
      topProducts,
      topCategories,
      totalOrders: orders.length
    };
  }

  /**
   * Get current inventory value
   */
  async getCurrentInventoryValue(retailerId) {
    try {
      const inventoryItems = await RetailerInventory.find({
        retailer: retailerId,
        isActive: true
      }).populate('product', 'name');

      let totalValue = 0;

      inventoryItems.forEach(item => {
        const cost = item.costPrice || item.sellingPrice || 0;
        const stock = item.currentStock || 0;
        totalValue += cost * stock;
      });

      return Math.round(totalValue * 100) / 100;
    } catch (error) {
      console.error('Inventory value calculation error:', error);
      return 0;
    }
  }

  /**
   * Get date range based on time filter
   */
  getDateRange(timeFilter) {
    const now = new Date();
    let startDate = new Date('2020-01-01'); // Very old date for 'all'
    let endDate = new Date();

    switch (timeFilter) {
      case 'today':
        startDate = new Date(now.setHours(0, 0, 0, 0));
        break;
      case 'week':
        startDate = new Date(now.setDate(now.getDate() - 7));
        break;
      case 'month':
        startDate = new Date(now.setMonth(now.getMonth() - 1));
        break;
      case '3months':
        startDate = new Date(now.setMonth(now.getMonth() - 3));
        break;
      case '6months':
        startDate = new Date(now.setMonth(now.getMonth() - 6));
        break;
      case 'year':
        startDate = new Date(now.setFullYear(now.getFullYear() - 1));
        break;
      case 'all':
      default:
        startDate = new Date('2020-01-01');
        break;
    }

    return { startDate, endDate };
  }

  /**
   * Get revenue trends over time
   */
  async getRevenueTrends(retailerId, period = 'monthly') {
    const { startDate, endDate } = this.getDateRange('year'); // Last year by default
    
    const orders = await Order.find({
      assignedRetailer: retailerId,
      orderStatus: 'delivered',
      deliveredAt: {
        $gte: startDate,
        $lte: endDate
      }
    });

    // Group by time period
    const trends = {};
    
    orders.forEach(order => {
      const periodKey = this.getPeriodKey(order.deliveredAt, period);
      
      if (!trends[periodKey]) {
        trends[periodKey] = {
          period: periodKey,
          totalSales: 0,
          totalRevenue: 0,
          orderCount: 0
        };
      }

      trends[periodKey].totalSales += order.finalAmount || order.totalAmount || 0;
      trends[periodKey].orderCount += 1;

      // Calculate revenue for this order
      let orderRevenue = 0;
      order.items.forEach(item => {
        const sellingPrice = item.price || 0;
        const costPrice = item.costPrice || 0;
        const quantity = item.quantity || 0;
        orderRevenue += (sellingPrice - costPrice) * quantity;
      });

      trends[periodKey].totalRevenue += orderRevenue;
    });

    // Convert to array and sort
    return Object.values(trends)
      .sort((a, b) => a.period.localeCompare(b.period))
      .map(item => ({
        ...item,
        totalSales: Math.round(item.totalSales * 100) / 100,
        totalRevenue: Math.round(item.totalRevenue * 100) / 100,
        averageOrderValue: item.orderCount > 0 ? Math.round((item.totalSales / item.orderCount) * 100) / 100 : 0
      }));
  }

  getPeriodKey(date, period) {
    const d = new Date(date);
    switch (period) {
      case 'daily':
        return d.toISOString().split('T')[0]; // YYYY-MM-DD
      case 'weekly':
        const week = Math.ceil(d.getDate() / 7);
        return `${d.getFullYear()}-W${week}`;
      case 'monthly':
        return d.toISOString().substring(0, 7); // YYYY-MM
      case 'yearly':
        return d.getFullYear().toString();
      default:
        return d.toISOString().substring(0, 7);
    }
  }

  /**
   * Get detailed revenue report with filters
   */
  async getDetailedRevenueReport(retailerId, filters = {}) {
    const { 
      startDate, 
      endDate, 
      category, 
      productId,
      timeFilter = 'all' 
    } = filters;

    let dateRange = { startDate, endDate };
    
    if (!startDate || !endDate) {
      dateRange = this.getDateRange(timeFilter);
    }

    const query = {
      assignedRetailer: retailerId,
      orderStatus: 'delivered',
      deliveredAt: {
        $gte: dateRange.startDate,
        $lte: dateRange.endDate
      }
    };

    // Add optional filters
    if (category || productId) {
      query['items.product'] = productId ? productId : { $exists: true };
    }

    const orders = await Order.find(query)
      .populate('items.product', 'name category price')
      .sort({ deliveredAt: -1 });

    return this.calculateMetricsFromOrders(orders);
  }
}

export default new RevenueCalculationService();   //TEJAS