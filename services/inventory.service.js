// services/inventory.service.js
import RetailerInventory from '../models/retailerInventory.model.js';
import InventoryLog from '../models/inventoryLog.model.js';
import Product from '../models/product.model.js';
import mongoose from 'mongoose';
import CacheService from './cache.service.js';


class InventoryService {
  constructor() {
    this.batchSize = 50;
  }

  /**
   * Update stock with transaction safety
   */
  async updateStock(params) {
    const session = await mongoose.startSession();
    
    try {
      session.startTransaction();

      const {
        retailerId,
        productId,
        quantity,
        transactionType,
        reason,
        referenceType,
        referenceId,
        batchNumber,
        expiryDate,
        unitCost,
        notes,
        userId,
        ipAddress,
        userAgent
      } = params;

      // Find inventory item
      const inventoryItem = await RetailerInventory.findOne({
        retailer: retailerId,
        product: productId
      }).session(session);

      if (!inventoryItem) {
        throw new Error('Inventory item not found');
      }

      const previousStock = inventoryItem.currentStock;
      let newStock = previousStock;

      // Calculate new stock based on transaction type
      switch (transactionType) {
        case 'STOCK_IN':
          newStock = previousStock + Math.abs(quantity);
          break;
          
        case 'STOCK_OUT':
          newStock = previousStock - Math.abs(quantity);
          if (newStock < 0) {
            throw new Error('Insufficient stock');
          }
          break;
          
        case 'STOCK_ADJUSTMENT':
          newStock = quantity;
          if (newStock < 0) {
            throw new Error('Stock cannot be negative');
          }
          break;
          
        case 'COMMITMENT':
          const availableStock = inventoryItem.currentStock - inventoryItem.committedStock;
          if (availableStock < quantity) {
            throw new Error('Insufficient available stock for commitment');
          }
          inventoryItem.committedStock += quantity;
          break;
          
        case 'RELEASE_COMMITMENT':
          if (inventoryItem.committedStock < quantity) {
            throw new Error('Cannot release more than committed stock');
          }
          inventoryItem.committedStock -= quantity;
          break;
          
        default:
          throw new Error('Invalid transaction type');
      }

      // Update inventory stock if not a commitment operation
      if (!['COMMITMENT', 'RELEASE_COMMITMENT'].includes(transactionType)) {
        inventoryItem.currentStock = newStock;
        if (transactionType === 'STOCK_IN') {
          inventoryItem.lastRestocked = new Date();
        }
      }

      await inventoryItem.save({ session });

      // Create inventory log
      const inventoryLog = new InventoryLog({
        retailer: retailerId,
        product: productId,
        inventoryItem: inventoryItem._id,
        transactionType,
        quantity: Math.abs(quantity),
        previousStock,
        newStock: ['COMMITMENT', 'RELEASE_COMMITMENT'].includes(transactionType) ? previousStock : newStock,
        unitCost,
        totalValue: unitCost ? unitCost * Math.abs(quantity) : 0,
        referenceType,
        referenceId,
        batchNumber,
        expiryDate,
        reason,
        notes,
        createdBy: userId,
        ipAddress,
        userAgent
      });

      await inventoryLog.save({ session });
      await session.commitTransaction();

      // Invalidate cache after successful update
      await CacheService.invalidateInventoryCache(retailerId);

      return {
        success: true,
        inventoryItem: await RetailerInventory.findById(inventoryItem._id)
          .populate('product', 'name sku unit unitSize image'),
        inventoryLog,
        stockChange: newStock - previousStock
      };

    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }
  }

  /**
   * Add product to retailer inventory
   */
  async addProductToInventory(retailerId, productData, userId) {
    const session = await mongoose.startSession();
    
    try {
      session.startTransaction();

      const {
        productId,
        initialStock = 0,
        sellingPrice,
        costPrice,
        minStockLevel,
        maxStockLevel
      } = productData;

      // Check if product already exists in inventory
      const existing = await RetailerInventory.findOne({
        retailer: retailerId,
        product: productId
      }).session(session);

      if (existing) {
        throw new Error('Product already exists in inventory');
      }

      // Get product details for default pricing
      const product = await Product.findById(productId).session(session);
      if (!product) {
        throw new Error('Product not found');
      }

      // Create inventory item
      const inventoryItem = new RetailerInventory({
        retailer: retailerId,
        product: productId,
        currentStock: initialStock,
        sellingPrice: sellingPrice || product.basePrice,
        costPrice: costPrice,
        minStockLevel: minStockLevel || product.reorderLevel || 10,
        maxStockLevel: maxStockLevel || product.optimalStockLevel || 100
      });

      await inventoryItem.save({ session });

      // Create initial stock log if stock is added
      if (initialStock > 0) {
        const inventoryLog = new InventoryLog({
          retailer: retailerId,
          product: productId,
          inventoryItem: inventoryItem._id,
          transactionType: 'STOCK_IN',
          quantity: initialStock,
          previousStock: 0,
          newStock: initialStock,
          reason: 'INITIAL',
          notes: 'Initial stock setup',
          createdBy: userId
        });
        await inventoryLog.save({ session });
      }

      await session.commitTransaction();

      // Invalidate cache
      await CacheService.invalidateInventoryCache(retailerId);

      return await RetailerInventory.findById(inventoryItem._id)
        .populate('product', 'name sku unit unitSize image category');

    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }
  }

  /**
   * Get retailer inventory with filters and caching
   */
  async getRetailerInventory(retailerId, filters = {}) {
    try {
      // Try cache first
      const cachedData = await CacheService.getInventoryCache(retailerId, filters);
      if (cachedData) {
        return cachedData;
      }

      const {
        page = 1,
        limit = 50,
        search,
        category,
        lowStock,
        outOfStock,
        sortBy = 'product.name',
        sortOrder = 'asc'
      } = filters;

      let query = { retailer: retailerId, isActive: true };

      // Apply filters
      if (search) {
        query.$or = [
          { 'product.name': { $regex: search, $options: 'i' } },
          { 'product.sku': { $regex: search, $options: 'i' } }
        ];
      }

      if (category) {
        query['product.category'] = new mongoose.Types.ObjectId(category);
      }

      if (lowStock === 'true') {
        query.lowStockAlert = true;
      }

      if (outOfStock === 'true') {
        query.outOfStock = true;
      }

      // Build sort object
      const sort = {};
      if (sortBy.startsWith('product.')) {
        const field = sortBy.split('.')[1];
        sort[`product.${field}`] = sortOrder === 'desc' ? -1 : 1;
      } else {
        sort[sortBy] = sortOrder === 'desc' ? -1 : 1;
      }

      const [inventory, total] = await Promise.all([
        RetailerInventory.find(query)
          .populate('product', 'name sku unit unitSize image category milkType')
          .populate('product.category', 'name')
          .sort(sort)
          .limit(parseInt(limit))
          .skip((parseInt(page) - 1) * parseInt(limit))
          .lean(),
        
        RetailerInventory.countDocuments(query)
      ]);

      // Calculate summary stats
      const stats = await RetailerInventory.aggregate([
        { $match: { retailer: new mongoose.Types.ObjectId(retailerId), isActive: true } },
        {
          $group: {
            _id: null,
            totalProducts: { $sum: 1 },
            totalValue: { 
              $sum: { 
                $cond: [
                  { $gt: ['$costPrice', 0] },
                  { $multiply: ['$currentStock', '$costPrice'] },
                  0
                ]
              } 
            },
            lowStockCount: { 
              $sum: { 
                $cond: [
                  { $and: [
                    { $gt: ['$minStockLevel', 0] },
                    { $lte: ['$currentStock', '$minStockLevel'] }
                  ]}, 
                  1, 
                  0 
                ]
              } 
            },
            outOfStockCount: { 
              $sum: { 
                $cond: [{ $eq: ['$currentStock', 0] }, 1, 0] 
              } 
            }
          }
        }
      ]);

      const result = {
        inventory,
        summary: stats[0] || {
          totalProducts: 0,
          totalValue: 0,
          lowStockCount: 0,
          outOfStockCount: 0
        },
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(total / limit),
          totalItems: total,
          itemsPerPage: parseInt(limit)
        }
      };

      // Cache the result
      await CacheService.setInventoryCache(retailerId, result, filters);

      return result;

    } catch (error) {
      console.error('Get retailer inventory error:', error);
      throw error;
    }
  }

  /**
   * Get low stock alerts for retailer
   */
  async getLowStockAlerts(retailerId, threshold = 0.2) {
    try {
      const inventory = await RetailerInventory.find({
        retailer: retailerId,
        isActive: true,
        lowStockAlert: true
      })
      .populate('product', 'name sku unit unitSize image')
      .sort({ currentStock: 1 })
      .lean();

      // Categorize by severity
      const critical = inventory.filter(item => 
        item.currentStock <= (item.minStockLevel * threshold)
      );
      
      const warning = inventory.filter(item => 
        item.currentStock > (item.minStockLevel * threshold) && 
        item.currentStock <= item.minStockLevel
      );

      return {
        critical,
        warning,
        total: inventory.length
      };
    } catch (error) {
      console.error('Get low stock alerts error:', error);
      throw error;
    }
  }

  /**
   * Get inventory logs for retailer
   */
  async getInventoryLogs(retailerId, filters = {}) {
    try {
      const {
        page = 1,
        limit = 50,
        productId,
        transactionType,
        startDate,
        endDate
      } = filters;

      let query = { retailer: retailerId };

      if (productId) {
        query.product = new mongoose.Types.ObjectId(productId);
      }

      if (transactionType) {
        query.transactionType = transactionType;
      }

      if (startDate || endDate) {
        query.createdAt = {};
        if (startDate) query.createdAt.$gte = new Date(startDate);
        if (endDate) query.createdAt.$lte = new Date(endDate);
      }

      const [logs, total] = await Promise.all([
        InventoryLog.find(query)
          .populate('product', 'name sku unit image')
          .populate('createdBy', 'name')
          .sort({ createdAt: -1 })
          .limit(parseInt(limit))
          .skip((parseInt(page) - 1) * parseInt(limit))
          .lean(),
        
        InventoryLog.countDocuments(query)
      ]);

      return {
        logs,
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(total / limit),
          totalLogs: total
        }
      };
    } catch (error) {
      console.error('Get inventory logs error:', error);
      throw error;
    }
  }

  /**
   * Update inventory item settings
   */
  async updateInventoryItem(inventoryId, retailerId, updateData, userId) {
    const session = await mongoose.startSession();
    
    try {
      session.startTransaction();

      const inventoryItem = await RetailerInventory.findOne({
        _id: inventoryId,
        retailer: retailerId
      }).session(session);

      if (!inventoryItem) {
        throw new Error('Inventory item not found');
      }

      // Update allowed fields
      const allowedFields = [
        'sellingPrice', 'costPrice', 'minStockLevel', 
        'maxStockLevel', 'reorderQuantity', 'isActive'
      ];
      
      allowedFields.forEach(field => {
        if (updateData[field] !== undefined) {
          inventoryItem[field] = updateData[field];
        }
      });

      await inventoryItem.save({ session });

      // Create log for significant changes
      if (updateData.sellingPrice !== undefined || updateData.costPrice !== undefined) {
        const inventoryLog = new InventoryLog({
          retailer: retailerId,
          product: inventoryItem.product,
          inventoryItem: inventoryItem._id,
          transactionType: 'STOCK_ADJUSTMENT',
          quantity: 0,
          previousStock: inventoryItem.currentStock,
          newStock: inventoryItem.currentStock,
          reason: 'ADJUSTMENT',
          notes: 'Price/settings update',
          createdBy: userId
        });
        await inventoryLog.save({ session });
      }

      await session.commitTransaction();

      // Invalidate cache
      await CacheService.invalidateInventoryCache(retailerId);

      return await RetailerInventory.findById(inventoryItem._id)
        .populate('product', 'name sku unit unitSize image');

    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }
  }
}

export default new InventoryService();