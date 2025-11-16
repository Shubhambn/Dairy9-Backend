// J:\dairy9 backend\Dairy9-Backend\controllers\inventory.controller.js
import asyncHandler from 'express-async-handler';
import { body, validationResult } from 'express-validator';
import InventoryService from '../services/inventory.service.js';
import Admin from '../models/admin.model.js';
import InventoryLog from '../models/inventoryLog.model.js'; // ✅ ADD THIS IMPORT
import CacheService from '../services/cache.service.js'; // ✅ ADD THIS IMPORT


// Validation rules
// CORRECT VALIDATION MIDDLEWARE - Update this
// controllers/inventory.controller.js - Update the validation rules
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


// Add this import at the top
import RetailerInventory from '../models/retailerInventory.model.js';

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
      reason: 'DELETION', // This will now work after schema update
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
