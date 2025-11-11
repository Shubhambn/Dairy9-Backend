// controllers/inventory.controller.js
import asyncHandler from 'express-async-handler';
import { body, validationResult } from 'express-validator';
import InventoryService from '../services/inventory.service.js';
import Admin from '../models/admin.model.js';
import Product from '../models/product.model.js';
import RetailerInventory from '../models/retailerInventory.model.js';
// import { getRetailerFromUser } from '../services/retailer.service.js'
// Validation rules
export const validateStockUpdate = [
  body('productId').isMongoId().withMessage('Valid product ID is required'),
  body('quantity').isInt({ min: 1 }).withMessage('Quantity must be a positive integer'),
  body('transactionType').isIn(['STOCK_IN', 'STOCK_OUT', 'STOCK_ADJUSTMENT', 'COMMITMENT', 'RELEASE_COMMITMENT'])
    .withMessage('Valid transaction type is required'),
  body('reason').isIn(['SALE', 'PURCHASE', 'DAMAGED', 'EXPIRED', 'ADJUSTMENT', 'RETURN', 'INITIAL'])
    .withMessage('Valid reason is required'),
  body('notes').optional().isString().isLength({ max: 500 }).withMessage('Notes must be less than 500 characters')
];

export const validateAddProduct = [
  body('productId')
    .isMongoId()
    .withMessage('Valid product ID is required'),
  
  body('currentStock')
    .optional()
    .isInt({ min: 0 })
    .withMessage('Current stock must be a non-negative integer'),
  
  body('count')
    .optional()
    .isInt({ min: 0 })
    .withMessage('Count must be a non-negative integer'),
  
  // ✅ FIXED: Added .optional() to make sellingPrice optional
  body('sellingPrice')
    .optional()
    .isFloat({ min: 0 })
    .withMessage('Selling price must be a non-negative number'),
  
  body('costPrice')
    .optional()
    .isFloat({ min: 0 })
    .withMessage('Cost price must be non-negative'),
  
  body('minStockLevel')
    .optional()
    .isInt({ min: 0 })
    .withMessage('Min stock level must be non-negative'),
  
  body('maxStockLevel')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Max stock level must be positive'),
  
  body('committedStock')
    .optional()
    .isInt({ min: 0 })
    .withMessage('Committed stock must be non-negative'),
  
  body('stockUpdateReason')
    .optional()
    .isString()
    .isLength({ max: 500 })
    .withMessage('Stock update reason must be less than 500 characters'),
  
  body('isActive')
    .optional()
    .isBoolean()
    .withMessage('isActive must be a boolean value')
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
      
      // Get the original product to access default price and details
      const originalProduct = await Product.findById(req.body.productId);
      if (!originalProduct) {
        return res.status(404).json({
          success: false,
          message: 'Product not found'
        });
      }

      // Check if product already exists in retailer's inventory
      const existingInventory = await RetailerInventory.findOne({
        retailer: retailer._id,
        product: req.body.productId
      });

      if (existingInventory) {
        return res.status(400).json({
          success: false,
          message: 'Product already exists in inventory'
        });
      }

      // Calculate default selling price (using product's discounted price)
      const defaultSellingPrice = originalProduct.discount > 0 
        ? originalProduct.price * (1 - originalProduct.discount / 100)
        : originalProduct.price;

      // Prepare inventory data using your existing schema fields
      const inventoryData = {
        retailer: retailer._id,
        product: req.body.productId,
        productName: originalProduct.name, // Populate from product
        currentStock: req.body.currentStock || req.body.count || 0, // Use count/currentStock
        committedStock: req.body.committedStock || 0,
        sellingPrice: req.body.sellingPrice || defaultSellingPrice, // Use calculated discounted price if not overridden
        costPrice: req.body.costPrice || originalProduct.price, // Use original price as cost price
        minStockLevel: req.body.minStockLevel || 10,
        maxStockLevel: req.body.maxStockLevel || 100,
        reorderQuantity: req.body.reorderQuantity || 50,
        updatedBy: req.user._id,
        stockUpdateReason: req.body.stockUpdateReason || 'Initial stock addition',
        isActive: req.body.isActive !== undefined ? req.body.isActive : true,
        lastRestocked: new Date(),
        lastUpdated: new Date()
      };

      // Create new inventory item
      const inventoryItem = new RetailerInventory(inventoryData);
      await inventoryItem.save();

      // Populate the product details in response
      await inventoryItem.populate('product', 'name description price discount unit unitSize image');
      await inventoryItem.populate('retailer', 'businessName');

      res.status(201).json({
        success: true,
        message: 'Product added to inventory successfully',
        data: {
          _id: inventoryItem._id,
          retailer: inventoryItem.retailer,
          product: inventoryItem.product,
          productName: inventoryItem.productName,
          currentStock: inventoryItem.currentStock,
          committedStock: inventoryItem.committedStock,
          availableStock: inventoryItem.availableStock, // Virtual field
          sellingPrice: inventoryItem.sellingPrice,
          costPrice: inventoryItem.costPrice,
          minStockLevel: inventoryItem.minStockLevel,
          maxStockLevel: inventoryItem.maxStockLevel,
          reorderQuantity: inventoryItem.reorderQuantity,
          lowStockAlert: inventoryItem.lowStockAlert,
          isActive: inventoryItem.isActive,
          stockUpdateReason: inventoryItem.stockUpdateReason,
          lastRestocked: inventoryItem.lastRestocked,
          lastUpdated: inventoryItem.lastUpdated,
          createdAt: inventoryItem.createdAt,
          updatedAt: inventoryItem.updatedAt
        }
      });

    } catch (error) {
      console.error('Add product to inventory error:', error);
      
      // Handle duplicate key error (unique constraint violation)
      if (error.code === 11000) {
        return res.status(400).json({
          success: false,
          message: 'Product already exists in inventory'
        });
      }
      
      // Handle validation errors
      if (error.name === 'ValidationError') {
        return res.status(400).json({
          success: false,
          message: 'Validation error',
          errors: Object.values(error.errors).map(err => err.message)
        });
      }
      
      // Handle CastError (invalid ObjectId)
      if (error.name === 'CastError') {
        return res.status(400).json({
          success: false,
          message: 'Invalid product ID'
        });
      }
      
      res.status(500).json({
        success: false,
        message: 'Server error while adding product to inventory',
        error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
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