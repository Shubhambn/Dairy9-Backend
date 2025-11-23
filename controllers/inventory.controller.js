// J:\dairy9 backend\Dairy9-Backend\controllers\inventory.controller.js
import asyncHandler from 'express-async-handler';
import { body, validationResult } from 'express-validator';
import InventoryService from '../services/inventory.service.js';
import Admin from '../models/admin.model.js';
import InventoryLog from '../models/inventoryLog.model.js';
import RetailerInventory from '../models/retailerInventory.model.js';
import CacheService from '../services/cache.service.js';
import RevenueCalculationService from '../services/revenueCalculation.service.js';

// Validation rules
export const validateStockUpdate = [
  body('productId')
    .isMongoId()
    .withMessage('Valid product ID is required'),
  
  body('quantity')
    .isInt({ min: 1 })
    .withMessage('Quantity must be a positive integer'),
  
  body('transactionType')
    .isIn(['STOCK_IN', 'STOCK_OUT', 'STOCK_ADJUSTMENT', 'STOCK_TRANSFER', 'STOCK_TAKE', 'COMMITMENT', 'RELEASE_COMMITMENT', 'DAMAGE', 'EXPIRY', 'RETURN'])
    .withMessage('Valid transaction type is required'),
  
  body('reason')
    .isIn([
      // Stock In Reasons
      'PURCHASE', 'RETURN', 'TRANSFER_IN', 'PRODUCTION', 'ADJUSTMENT_IN',
      // Stock Out Reasons  
      'SALE', 'DAMAGE', 'EXPIRY', 'TRANSFER_OUT', 'SAMPLE', 'ADJUSTMENT_OUT',
      // Commitment Reasons
      'ORDER_RESERVATION', 'ORDER_CANCELLED', 'ORDER_DELIVERED',
      // General Reasons
      'INITIAL_SETUP', 'CORRECTION', 'PHYSICAL_COUNT', 'SYSTEM_ADJUSTMENT',
      // ✅ ADDED: Deletion Reason
      'DELETION'
    ])
    .withMessage('Valid reason is required')
];

export const validateAddProduct = [
  body('productId').isMongoId().withMessage('Valid product ID is required'),
  body('initialStock').optional().isInt({ min: 0 }).withMessage('Initial stock must be a non-negative integer'),
  body('sellingPrice').isFloat({ min: 0 }).withMessage('Valid selling price is required'),
  body('costPrice').optional().isFloat({ min: 0 }).withMessage('Cost price must be non-negative'),
  body('minStockLevel').optional().isInt({ min: 0 }).withMessage('Min stock level must be non-negative'),
  body('maxStockLevel').optional().isInt({ min: 1 }).withMessage('Max stock level must be positive')
];

// Helper to get retailer from user
const getRetailerFromUser = async (userId) => {
  const retailer = await Admin.findOne({ user: userId });
  if (!retailer) {
    throw new Error('Retailer profile not found');
  }
  return retailer;
};

/**
 * @desc    Get retailer inventory
 * @route   GET /api/retailer/inventory
 * @access  Private (Retailer)
 */
export const getRetailerInventory = asyncHandler(async (req, res) => {
  try {
    const retailer = await getRetailerFromUser(req.user._id);
    const filters = req.query;

    const result = await InventoryService.getRetailerInventory(retailer._id, filters);

    res.json({
      success: true,
      data: result
    });

  } catch (error) {
    console.error('Get inventory error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch inventory',
      error: error.message
    });
  }
});

/**
 * @desc    Add product to inventory
 * @route   POST /api/retailer/inventory/products
 * @access  Private (Retailer)
 */
export const addProductToInventory = [
  validateAddProduct,
  asyncHandler(async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: 'Validation failed',
          errors: errors.array()
        });
      }

      const retailer = await getRetailerFromUser(req.user._id);
      const inventoryItem = await InventoryService.addProductToInventory(
        retailer._id,
        req.body,
        req.user._id
      );

      res.status(201).json({
        success: true,
        message: 'Product added to inventory successfully',
        data: inventoryItem
      });

    } catch (error) {
      console.error('Add product error:', error);
      const statusCode = error.message.includes('already exists') ? 400 : 500;
      res.status(statusCode).json({
        success: false,
        message: error.message
      });
    }
  })
];

/**
 * @desc    Update inventory stock
 * @route   PUT /api/retailer/inventory/stock
 * @access  Private (Retailer)
 */
export const updateInventoryStock = [
  validateStockUpdate,
  asyncHandler(async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: 'Validation failed',
          errors: errors.array()
        });
      }

      const retailer = await getRetailerFromUser(req.user._id);
      
      const result = await InventoryService.updateStock({
        retailerId: retailer._id,
        ...req.body,
        userId: req.user._id,
        ipAddress: req.ip,
        userAgent: req.get('User-Agent')
      });

      res.json({
        success: true,
        message: 'Stock updated successfully',
        data: result
      });

    } catch (error) {
      console.error('Stock update error:', error);
      
      let statusCode = 500;
      if (error.message.includes('not found')) statusCode = 404;
      if (error.message.includes('Insufficient') || error.message.includes('Invalid')) statusCode = 400;

      res.status(statusCode).json({
        success: false,
        message: error.message
      });
    }
  })
];

/**
 * @desc    Update inventory item settings
 * @route   PUT /api/retailer/inventory/products/:inventoryId
 * @access  Private (Retailer)
 */
export const updateInventoryItem = asyncHandler(async (req, res) => {
  try {
    const { inventoryId } = req.params;
    const retailer = await getRetailerFromUser(req.user._id);
    
    const inventoryItem = await InventoryService.updateInventoryItem(
      inventoryId,
      retailer._id,
      req.body,
      req.user._id
    );

    res.json({
      success: true,
      message: 'Inventory item updated successfully',
      data: inventoryItem
    });

  } catch (error) {
    console.error('Update inventory item error:', error);
    const statusCode = error.message.includes('not found') ? 404 : 500;
    res.status(statusCode).json({
      success: false,
      message: error.message
    });
  }
});

/**
 * @desc    Delete inventory item
 * @route   DELETE /api/retailer/inventory/products/:inventoryId
 * @access  Private (Retailer)
 */
export const deleteInventoryItem = asyncHandler(async (req, res) => {
  try {
    const { inventoryId } = req.params;
    const retailer = await getRetailerFromUser(req.user._id);

    console.log('🗑️ Delete inventory request:', { inventoryId, retailerId: retailer._id });

    // Find the inventory item and verify it belongs to this retailer
    const inventoryItem = await RetailerInventory.findOne({
      _id: inventoryId,
      retailer: retailer._id
    });

    if (!inventoryItem) {
      return res.status(404).json({
        success: false,
        message: 'Inventory item not found or you do not have permission to delete it'
      });
    }

    // Check if there's any committed stock (reserved for orders)
    if (inventoryItem.committedStock > 0) {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete inventory item with reserved stock. Please release all reservations first.',
        committedStock: inventoryItem.committedStock
      });
    }

    // Check if there's current stock
    if (inventoryItem.currentStock > 0) {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete inventory item with current stock. Please adjust stock to zero first.',
        currentStock: inventoryItem.currentStock
      });
    }

    // ✅ FIX: Use HARD DELETE instead of soft delete
    await RetailerInventory.findByIdAndDelete(inventoryId);

    // ✅ FIX: Create a deletion log for audit trail with valid reason
    await InventoryLog.create({
      retailer: retailer._id,
      product: inventoryItem.product,
      inventoryItem: inventoryItem._id,
      transactionType: 'STOCK_ADJUSTMENT',
      quantity: 0,
      previousStock: inventoryItem.currentStock,
      newStock: 0,
      reason: 'DELETION',
      notes: `Inventory item permanently deleted - Product: ${inventoryItem.productName}`,
      createdBy: req.user._id
    });

    console.log('✅ Inventory item HARD DELETED successfully:', inventoryId);

    // ✅ FIX: Invalidate cache to ensure UI updates
    await CacheService.invalidateInventoryCache(retailer._id);

    res.json({
      success: true,
      message: 'Inventory item permanently deleted successfully',
      data: {
        _id: inventoryItem._id,
        productName: inventoryItem.productName,
        deletedAt: new Date()
      }
    });

  } catch (error) {
    console.error('Delete inventory item error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete inventory item',
      error: error.message
    });
  }
});

/**
 * @desc    Force delete inventory item (admin/superuser only)
 * @route   DELETE /api/retailer/inventory/products/:inventoryId/force
 * @access  Private (Admin/Retailer)
 */
export const forceDeleteInventoryItem = asyncHandler(async (req, res) => {
  try {
    const { inventoryId } = req.params;
    const retailer = await getRetailerFromUser(req.user._id);

    console.log('⚠️ Force delete inventory request:', { inventoryId, retailerId: retailer._id });

    // Find the inventory item
    const inventoryItem = await RetailerInventory.findOne({
      _id: inventoryId,
      retailer: retailer._id
    });

    if (!inventoryItem) {
      return res.status(404).json({
        success: false,
        message: 'Inventory item not found'
      });
    }

    // Create a log before deletion
    await InventoryLog.create({
      retailer: retailer._id,
      product: inventoryItem.product,
      inventoryItem: inventoryItem._id,
      transactionType: 'STOCK_ADJUSTMENT',
      quantity: 0,
      previousStock: inventoryItem.currentStock,
      newStock: 0,
      reason: 'DELETION',
      notes: `Inventory item deleted - Product: ${inventoryItem.productName}`,
      createdBy: req.user._id
    });

    // Hard delete
    await RetailerInventory.findByIdAndDelete(inventoryId);

    console.log('✅ Inventory item force deleted:', inventoryId);

    res.json({
      success: true,
      message: 'Inventory item permanently deleted',
      data: {
        _id: inventoryId,
        productName: inventoryItem.productName
      }
    });

  } catch (error) {
    console.error('Force delete inventory item error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to force delete inventory item',
      error: error.message
    });
  }
});

/**
 * @desc    Get low stock alerts
 * @route   GET /api/retailer/inventory/alerts/low-stock
 * @access  Private (Retailer)
 */
export const getLowStockAlerts = asyncHandler(async (req, res) => {
  try {
    const retailer = await getRetailerFromUser(req.user._id);
    const threshold = parseFloat(req.query.threshold) || 0.2;

    const alerts = await InventoryService.getLowStockAlerts(retailer._id, threshold);

    res.json({
      success: true,
      data: alerts
    });

  } catch (error) {
    console.error('Get low stock alerts error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch low stock alerts'
    });
  }
});

/**
 * @desc    Get inventory logs
 * @route   GET /api/retailer/inventory/logs
 * @access  Private (Retailer)
 */
export const getInventoryLogs = asyncHandler(async (req, res) => {
  try {
    const retailer = await getRetailerFromUser(req.user._id);
    const filters = req.query;

    const result = await InventoryService.getInventoryLogs(retailer._id, filters);

    res.json({
      success: true,
      data: result
    });

  } catch (error) {
    console.error('Get inventory logs error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch inventory logs'
    });
  }
});

/**
 * @desc    Get inventory analytics
 * @route   GET /api/retailer/inventory/analytics
 * @access  Private (Retailer)
 */
export const getInventoryAnalytics = asyncHandler(async (req, res) => {
  try {
    const retailer = await getRetailerFromUser(req.user._id);
    
    // Get basic stats from inventory service
    const inventoryData = await InventoryService.getRetailerInventory(retailer._id, { limit: 1 });
    
    // Get recent activity
    const recentLogs = await InventoryService.getInventoryLogs(retailer._id, { limit: 10 });
    
    // Get low stock alerts
    const lowStockAlerts = await InventoryService.getLowStockAlerts(retailer._id);

    res.json({
      success: true,
      data: {
        summary: inventoryData.summary,
        recentActivity: recentLogs.logs.slice(0, 5),
        lowStockAlerts,
        timestamp: new Date()
      }
    });

  } catch (error) {
    console.error('Get analytics error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch inventory analytics'
    });
  }
});

/**
 * @desc    Public: Get inventory for a specific retailer
 * @route   GET /api/inventory/retailer/:retailerId
 * @access  Public (For customers)
 */
export const getInventoryForCustomer = asyncHandler(async (req, res) => {
  try {
    const { retailerId } = req.params;

    if (!retailerId) {
      return res.status(400).json({
        success: false,
        message: "Retailer ID is required",
      });
    }

    const result = await InventoryService.getRetailerInventory(retailerId, req.query);

    return res.json({
      success: true,
      data: result
    });

  } catch (error) {
    console.error("Get customer inventory error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch retailer inventory",
      error: error.message
    });
  }
});

/**
 * @desc    Update pricing slabs for inventory item
 * @route   PUT /api/retailer/inventory/products/:inventoryId/pricing-slabs
 * @access  Private (Retailer)
 */
export const updatePricingSlabs = [
  // Validation middleware for pricing slabs
  body('pricingSlabs')
    .isArray()
    .withMessage('Pricing slabs must be an array'),
  body('pricingSlabs.*.minQuantity')
    .isInt({ min: 0 })
    .withMessage('Minimum quantity must be a non-negative integer'),
  body('pricingSlabs.*.maxQuantity')
    .isInt({ min: 1 })
    .withMessage('Maximum quantity must be a positive integer'),
  body('pricingSlabs.*.discountType')
    .isIn(['FLAT', 'PERCENTAGE'])
    .withMessage('Discount type must be FLAT or PERCENTAGE'),
  body('pricingSlabs.*.discountValue')
    .isFloat({ min: 0 })
    .withMessage('Discount value must be a non-negative number'),

  asyncHandler(async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: 'Validation failed',
          errors: errors.array()
        });
      }

      const { inventoryId } = req.params;
      const { pricingSlabs } = req.body;
      const retailer = await getRetailerFromUser(req.user._id);

      const inventoryItem = await InventoryService.updatePricingSlabs(
        inventoryId,
        retailer._id,
        pricingSlabs,
        req.user._id
      );

      res.json({
        success: true,
        message: 'Pricing slabs updated successfully',
        data: inventoryItem
      });

    } catch (error) {
      console.error('Update pricing slabs error:', error);
      const statusCode = error.message.includes('not found') ? 404 : 400;
      res.status(statusCode).json({
        success: false,
        message: error.message
      });
    }
  })
];

/**
 * @desc    Calculate price for specific quantity
 * @route   POST /api/retailer/inventory/calculate-price
 * @access  Private (Retailer)
 */
export const calculatePriceForQuantity = [
  body('productId')
    .isMongoId()
    .withMessage('Valid product ID is required'),
  body('quantity')
    .isInt({ min: 1 })
    .withMessage('Quantity must be a positive integer'),

  asyncHandler(async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: 'Validation failed',
          errors: errors.array()
        });
      }

      const { productId, quantity } = req.body;
      const retailer = await getRetailerFromUser(req.user._id);

      const priceInfo = await InventoryService.calculatePriceForQuantity(
        retailer._id,
        productId,
        quantity
      );

      res.json({
        success: true,
        data: priceInfo
      });

    } catch (error) {
      console.error('Calculate price error:', error);
      res.status(500).json({
        success: false,
        message: error.message
      });
    }
  })
];

/**
 * @desc    Bulk calculate prices for multiple products
 * @route   POST /api/retailer/inventory/bulk-calculate-prices
 * @access  Private (Retailer)
 */
export const bulkCalculatePrices = [
  body('items')
    .isArray({ min: 1 })
    .withMessage('Items array is required'),
  body('items.*.productId')
    .isMongoId()
    .withMessage('Valid product ID is required'),
  body('items.*.quantity')
    .isInt({ min: 1 })
    .withMessage('Quantity must be a positive integer'),

  asyncHandler(async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: 'Validation failed',
          errors: errors.array()
        });
      }

      const { items } = req.body;
      const retailer = await getRetailerFromUser(req.user._id);

      const result = await InventoryService.bulkCalculatePrices(
        retailer._id,
        items
      );

      res.json({
        success: true,
        data: result
      });

    } catch (error) {
      console.error('Bulk calculate prices error:', error);
      res.status(500).json({
        success: false,
        message: error.message
      });
    }
  })
];

/**
 * @desc    Get inventory dashboard with revenue metrics
 * @route   GET /api/retailer/inventory/dashboard
 * @access  Private (Retailer)
 */
export const getInventoryDashboard = asyncHandler(async (req, res) => {
  try {
    const retailer = await getRetailerFromUser(req.user._id);
    const { timeFilter = 'all' } = req.query;

    // Get revenue metrics from ORDERS (most accurate)
    const revenueMetrics = await RevenueCalculationService.calculateRevenueMetrics(
      retailer._id, 
      timeFilter
    );

    // Get inventory summary
    const inventorySummary = await RetailerInventory.aggregate([
      {
        $match: {
          retailer: retailer._id,
          isActive: true
        }
      },
      {
        $group: {
          _id: null,
          totalProducts: { $sum: 1 },
          totalStockValue: { 
            $sum: { 
              $multiply: ['$currentStock', '$sellingPrice'] 
            } 
          },
          lowStockCount: {
            $sum: {
              $cond: [
                { $lte: ['$currentStock', '$minStockLevel'] },
                1,
                0
              ]
            }
          },
          outOfStockCount: {
            $sum: {
              $cond: [
                { $lte: ['$currentStock', 0] },
                1,
                0
              ]
            }
          },
          totalCurrentStock: { $sum: '$currentStock' },
          totalCommittedStock: { $sum: '$committedStock' }
        }
      }
    ]);

    const summary = inventorySummary[0] || {
      totalProducts: 0,
      totalStockValue: 0,
      lowStockCount: 0,
      outOfStockCount: 0,
      totalCurrentStock: 0,
      totalCommittedStock: 0
    };

    // Combine revenue and inventory data
    const dashboardData = {
      summary: {
        totalProducts: summary.totalProducts,
        totalInventoryValue: Math.round(summary.totalStockValue * 100) / 100,
        totalSales: revenueMetrics.totalSales,
        totalRevenue: revenueMetrics.totalRevenue,
        lowStockCount: summary.lowStockCount,
        outOfStockCount: summary.outOfStockCount,
        totalItemsSold: revenueMetrics.totalItemsSold,
        profitMargin: revenueMetrics.profitMargin,
        averageOrderValue: revenueMetrics.averageOrderValue
      },
      revenueMetrics: {
        ...revenueMetrics,
        timePeriod: revenueMetrics.timePeriod
      },
      inventory: {
        totalCurrentStock: summary.totalCurrentStock,
        totalCommittedStock: summary.totalCommittedStock,
        availableStock: summary.totalCurrentStock - summary.totalCommittedStock
      },
      timestamp: new Date()
    };

    res.json({
      success: true,
      data: dashboardData
    });

  } catch (error) {
    console.error('Get inventory dashboard error:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

/**
 * @desc    Get revenue analytics with filters
 * @route   GET /api/retailer/inventory/revenue-analytics
 * @access  Private (Retailer)
 */
export const getRevenueAnalytics = asyncHandler(async (req, res) => {
  try {
    const retailer = await getRetailerFromUser(req.user._id);
    const { 
      timeFilter = 'month',
      startDate,
      endDate,
      period = 'monthly'
    } = req.query;

    const filters = {
      timeFilter,
      startDate: startDate ? new Date(startDate) : undefined,
      endDate: endDate ? new Date(endDate) : undefined,
      period
    };

    // Get detailed revenue metrics
    const revenueMetrics = await RevenueCalculationService.calculateRevenueMetrics(
      retailer._id, 
      timeFilter
    );

    // Get revenue trends
    const revenueTrends = await RevenueCalculationService.getRevenueTrends(
      retailer._id, 
      period
    );

    res.json({
      success: true,
      data: {
        overview: revenueMetrics,
        trends: revenueTrends,
        timePeriod: revenueMetrics.timePeriod
      }
    });

  } catch (error) {
    console.error('Get revenue analytics error:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});     

/**
 * @desc    Calculate order pricing with per-piece discounts
 * @route   POST /api/retailer/inventory/calculate-order-pricing
 * @access  Private (Retailer)
 */
export const calculateOrderPricing = [
    body('items')
        .isArray({ min: 1 })
        .withMessage('Items array is required'),
    body('items.*.productId')
        .isMongoId()
        .withMessage('Valid product ID is required'),
    body('items.*.quantity')
        .isInt({ min: 1 })
        .withMessage('Quantity must be a positive integer'),

    asyncHandler(async (req, res) => {
        try {
            const errors = validationResult(req);
            if (!errors.isEmpty()) {
                return res.status(400).json({
                    success: false,
                    message: 'Validation failed',
                    errors: errors.array()
                });
            }

            const { items } = req.body;
            const retailer = await getRetailerFromUser(req.user._id);

            const orderPricing = await InventoryService.calculateOrderPricing(
                retailer._id,
                items
            );

            res.json({
                success: true,
                data: orderPricing
            });

        } catch (error) {
            console.error('Calculate order pricing error:', error);
            res.status(500).json({
                success: false,
                message: error.message
            });
        }
    })
];

/**
 * @desc    🔥 NEW: Validate and correct suspicious retailer prices
 * @route   POST /api/retailer/inventory/validate-prices
 * @access  Private (Retailer)
 */
export const validateInventoryPrices = asyncHandler(async (req, res) => {
  try {
    const retailer = await getRetailerFromUser(req.user._id);
    
    const inventory = await RetailerInventory.find({
      retailer: retailer._id,
      isActive: true
    }).populate('product', 'name price');

    let corrections = [];
    let correctedCount = 0;

    for (const item of inventory) {
      const catalogPrice = item.product?.price || 0;
      const retailerPrice = item.sellingPrice || 0;

      // Check for suspicious prices (more than 5x catalog price)
      if (retailerPrice > catalogPrice * 5 && catalogPrice > 0) {
        const previousPrice = retailerPrice;
        item.sellingPrice = catalogPrice;
        await item.save();

        // Create correction log
        await InventoryLog.create({
          retailer: retailer._id,
          product: item.product._id,
          inventoryItem: item._id,
          transactionType: 'STOCK_ADJUSTMENT',
          quantity: 0,
          previousStock: item.currentStock,
          newStock: item.currentStock,
          reason: 'PRICE_CORRECTION',
          notes: `Auto-corrected suspicious price from ${previousPrice} to ${catalogPrice}`,
          createdBy: req.user._id
        });

        corrections.push({
          productId: item.product._id,
          productName: item.product.name,
          previousPrice,
          correctedPrice: catalogPrice
        });
        correctedCount++;
      }
    }

    // Invalidate cache after corrections
    await CacheService.invalidateInventoryCache(retailer._id);

    res.json({
      success: true,
      message: `Validated ${inventory.length} products, corrected ${correctedCount} suspicious prices`,
      data: {
        totalProducts: inventory.length,
        correctedCount,
        corrections
      }
    });

  } catch (error) {
    console.error('Validate prices error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to validate prices'
    });
  }
});

/**
 * @desc    🔥 NEW: Get retailer price with validation for offline orders
 * @route   GET /api/retailer/inventory/product-price/:productId
 * @access  Private (Retailer)
 */
export const getValidatedProductPrice = asyncHandler(async (req, res) => {
  try {
    const { productId } = req.params;
    const retailer = await getRetailerFromUser(req.user._id);

    // Get inventory item
    const inventoryItem = await RetailerInventory.findOne({
      retailer: retailer._id,
      product: productId,
      isActive: true
    }).populate('product', 'name price category');

    if (!inventoryItem) {
      return res.status(404).json({
        success: false,
        message: 'Product not found in retailer inventory'
      });
    }

    const catalogPrice = inventoryItem.product?.price || 0;
    const retailerPrice = inventoryItem.sellingPrice || 0;

    // Validate price and correct if suspicious
    let finalPrice = retailerPrice;
    let priceCorrected = false;

    if (retailerPrice > catalogPrice * 5 && catalogPrice > 0) {
      finalPrice = catalogPrice;
      priceCorrected = true;
      
      // Auto-correct the price
      inventoryItem.sellingPrice = catalogPrice;
      await inventoryItem.save();

      // Log the correction
      await InventoryLog.create({
        retailer: retailer._id,
        product: productId,
        inventoryItem: inventoryItem._id,
        transactionType: 'STOCK_ADJUSTMENT',
        quantity: 0,
        previousStock: inventoryItem.currentStock,
        newStock: inventoryItem.currentStock,
        reason: 'PRICE_CORRECTION',
        notes: `Auto-corrected suspicious price from ${retailerPrice} to ${catalogPrice} for offline order`,
        createdBy: req.user._id
      });

      await CacheService.invalidateInventoryCache(retailer._id);
    }

    // Calculate discounted price with pricing slabs (for quantity = 1)
    let discountedPrice = finalPrice;
    let appliedDiscount = 0;
    let discountType = null;

    if (inventoryItem.enableQuantityPricing && inventoryItem.pricingSlabs?.length > 0) {
      const applicableSlab = inventoryItem.pricingSlabs.find(slab => 
        1 >= slab.minQuantity && 1 <= slab.maxQuantity
      );
      
      if (applicableSlab) {
        if (applicableSlab.discountType === 'PERCENTAGE') {
          appliedDiscount = (finalPrice * applicableSlab.discountValue) / 100;
          discountedPrice = finalPrice - appliedDiscount;
          discountType = 'percentage';
        } else if (applicableSlab.discountType === 'FLAT') {
          appliedDiscount = applicableSlab.discountValue;
          discountedPrice = finalPrice - appliedDiscount;
          discountType = 'flat';
        }
      }
    }

    res.json({
      success: true,
      data: {
        productId,
        productName: inventoryItem.productName,
        catalogPrice,
        retailerPrice: finalPrice,
        discountedPrice,
        appliedDiscount,
        discountType,
        priceCorrected,
        hasQuantityPricing: inventoryItem.enableQuantityPricing,
        pricingSlabs: inventoryItem.pricingSlabs || [],
        currentStock: inventoryItem.currentStock,
        availableStock: inventoryItem.currentStock - inventoryItem.committedStock
      }
    });

  } catch (error) {
    console.error('Get validated product price error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get product price',
      error: error.message
    });
  }
});

/**
 * @desc    🔥 NEW: Bulk get validated prices for multiple products (for offline orders)
 * @route   POST /api/retailer/inventory/bulk-validated-prices
 * @access  Private (Retailer)
 */
export const getBulkValidatedPrices = [
  body('productIds')
    .isArray({ min: 1 })
    .withMessage('Product IDs array is required'),
  body('productIds.*')
    .isMongoId()
    .withMessage('Valid product ID is required'),

  asyncHandler(async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: 'Validation failed',
          errors: errors.array()
        });
      }

      const { productIds } = req.body;
      const retailer = await getRetailerFromUser(req.user._id);

      const inventoryItems = await RetailerInventory.find({
        retailer: retailer._id,
        product: { $in: productIds },
        isActive: true
      }).populate('product', 'name price category');

      const results = [];
      let correctedCount = 0;

      for (const inventoryItem of inventoryItems) {
        const catalogPrice = inventoryItem.product?.price || 0;
        const retailerPrice = inventoryItem.sellingPrice || 0;

        // Validate price and correct if suspicious
        let finalPrice = retailerPrice;
        let priceCorrected = false;

        if (retailerPrice > catalogPrice * 5 && catalogPrice > 0) {
          finalPrice = catalogPrice;
          priceCorrected = true;
          correctedCount++;
          
          // Auto-correct the price
          inventoryItem.sellingPrice = catalogPrice;
          await inventoryItem.save();

          // Log the correction
          await InventoryLog.create({
            retailer: retailer._id,
            product: inventoryItem.product._id,
            inventoryItem: inventoryItem._id,
            transactionType: 'STOCK_ADJUSTMENT',
            quantity: 0,
            previousStock: inventoryItem.currentStock,
            newStock: inventoryItem.currentStock,
            reason: 'PRICE_CORRECTION',
            notes: `Auto-corrected suspicious price from ${retailerPrice} to ${catalogPrice} for bulk offline order`,
            createdBy: req.user._id
          });
        }

        // Calculate discounted price with pricing slabs (for quantity = 1)
        let discountedPrice = finalPrice;
        let appliedDiscount = 0;
        let discountType = null;

        if (inventoryItem.enableQuantityPricing && inventoryItem.pricingSlabs?.length > 0) {
          const applicableSlab = inventoryItem.pricingSlabs.find(slab => 
            1 >= slab.minQuantity && 1 <= slab.maxQuantity
          );
          
          if (applicableSlab) {
            if (applicableSlab.discountType === 'PERCENTAGE') {
              appliedDiscount = (finalPrice * applicableSlab.discountValue) / 100;
              discountedPrice = finalPrice - appliedDiscount;
              discountType = 'percentage';
            } else if (applicableSlab.discountType === 'FLAT') {
              appliedDiscount = applicableSlab.discountValue;
              discountedPrice = finalPrice - appliedDiscount;
              discountType = 'flat';
            }
          }
        }

        results.push({
          productId: inventoryItem.product._id,
          productName: inventoryItem.productName,
          catalogPrice,
          retailerPrice: finalPrice,
          discountedPrice,
          appliedDiscount,
          discountType,
          priceCorrected,
          hasQuantityPricing: inventoryItem.enableQuantityPricing,
          pricingSlabs: inventoryItem.pricingSlabs || [],
          currentStock: inventoryItem.currentStock,
          availableStock: inventoryItem.currentStock - inventoryItem.committedStock
        });
      }

      // Invalidate cache if any corrections were made
      if (correctedCount > 0) {
        await CacheService.invalidateInventoryCache(retailer._id);
      }

      res.json({
        success: true,
        data: {
          products: results,
          totalProducts: results.length,
          correctedCount,
          message: correctedCount > 0 ? 
            `Corrected ${correctedCount} suspicious prices automatically` : 
            'All prices are valid'
        }
      });

    } catch (error) {
      console.error('Get bulk validated prices error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to get bulk validated prices',
        error: error.message
      });
    }
  })
];