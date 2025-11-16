// services/inventory.service.js - COMPLETE FIXED VERSION
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
     * Check stock availability for items at a retailer
     */
    async checkStockAvailability(retailerId, items) {
        try {
            const stockResults = [];
            let allAvailable = true;

            for (const item of items) {
                const productId = item.productId;

                console.log('🔍 Checking stock for product:', productId);

                const inventory = await RetailerInventory.findOne({
                    retailer: retailerId,
                    product: productId,
                    isActive: true
                }).populate('product', 'name sku unit');

                if (!inventory) {
                    stockResults.push({
                        productId: productId,
                        available: false,
                        message: 'Product not found in retailer inventory',
                        requested: item.quantity,
                        available: 0,
                        productName: 'Unknown product'
                    });
                    allAvailable = false;
                    continue;
                }

                // Calculate available stock (current - committed)
                const availableStock = inventory.currentStock - inventory.committedStock;

                if (availableStock < item.quantity) {
                    stockResults.push({
                        productId: productId,
                        available: false,
                        message: `Insufficient stock. Available: ${availableStock}, Requested: ${item.quantity}`,
                        requested: item.quantity,
                        available: availableStock,
                        productName: inventory.product?.name || 'Unknown product',
                        inventoryId: inventory._id
                    });
                    allAvailable = false;
                } else {
                    stockResults.push({
                        productId: productId,
                        available: true,
                        message: 'In stock',
                        requested: item.quantity,
                        available: availableStock,
                        productName: inventory.product?.name || 'Unknown product',
                        inventoryId: inventory._id
                    });
                }
            }

            return {
                allAvailable,
                items: stockResults,
                retailerId,
                timestamp: new Date()
            };
        } catch (error) {
            console.error('Stock availability check error:', error);
            throw new Error(`Failed to check stock availability: ${error.message}`);
        }
    }

    /**
     * Update stock with transaction safety
     */
    async updateStock(params) {
        const session = await mongoose.startSession();
        let inventoryItemBeforeSave = null;

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

            console.log('🔄 updateStock:', { transactionType, productId, quantity, reason });

            // Find inventory item
            const inventoryItem = await RetailerInventory.findOne({
                retailer: retailerId,
                product: productId
            }).session(session);

            if (!inventoryItem) {
                throw new Error('Inventory item not found');
            }

            console.log('📦 Before update - Current:', inventoryItem.currentStock,
                'Committed:', inventoryItem.committedStock,
                'Total Sold:', inventoryItem.totalSold);

            const previousStock = inventoryItem.currentStock;
            const previousCommitted = inventoryItem.committedStock;
            let newStock = previousStock;
            let newCommitted = previousCommitted;

            // Calculate new stock based on transaction type
            switch (transactionType) {
                case 'STOCK_IN':
                    newStock = previousStock + Math.abs(quantity);
                    console.log(`📈 STOCK_IN: ${previousStock} + ${quantity} = ${newStock}`);
                    inventoryItem.lastRestocked = new Date();
                    break;

                case 'STOCK_OUT':
                    newStock = previousStock - Math.abs(quantity);
                    console.log(`📉 STOCK_OUT: ${previousStock} - ${quantity} = ${newStock}`);
                    if (newStock < 0) {
                        throw new Error('Insufficient stock');
                    }

                    // UPDATE SALES METRICS FOR ACTUAL SALES
                    if (reason === 'SALE') {
                        inventoryItem.totalSold += quantity;
                        inventoryItem.lastSoldDate = new Date();
                        console.log(`💰 Updated totalSold: +${quantity} = ${inventoryItem.totalSold}`);
                    }
                    break;

                case 'STOCK_ADJUSTMENT':
                    newStock = quantity;
                    console.log(`⚙️ STOCK_ADJUSTMENT: ${previousStock} → ${newStock}`);
                    if (newStock < 0) {
                        throw new Error('Stock cannot be negative');
                    }
                    break;

                case 'COMMITMENT':
                    const availableStock = inventoryItem.currentStock - inventoryItem.committedStock;
                    console.log(`🔒 COMMITMENT: Available ${availableStock}, Requested ${quantity}`);
                    if (availableStock < quantity) {
                        throw new Error('Insufficient available stock for commitment');
                    }
                    newCommitted = previousCommitted + quantity;
                    console.log(`🔒 COMMITMENT: ${previousCommitted} + ${quantity} = ${newCommitted}`);
                    break;

                case 'RELEASE_COMMITMENT':
                    console.log(`🔓 RELEASE_COMMITMENT: ${previousCommitted} - ${quantity}`);
                    if (inventoryItem.committedStock < quantity) {
                        throw new Error('Cannot release more than committed stock');
                    }
                    newCommitted = previousCommitted - quantity;
                    break;

                default:
                    throw new Error('Invalid transaction type');
            }

            // Update inventory values
            if (!['COMMITMENT', 'RELEASE_COMMITMENT'].includes(transactionType)) {
                inventoryItem.currentStock = newStock;
            } else {
                inventoryItem.committedStock = newCommitted;
            }

            await inventoryItem.save({ session });

            console.log('💾 Inventory saved - Current:', inventoryItem.currentStock,
                'Committed:', inventoryItem.committedStock,
                'Total Sold:', inventoryItem.totalSold);

            // Store data for later use before session ends
            inventoryItemBeforeSave = {
                _id: inventoryItem._id,
                currentStock: inventoryItem.currentStock,
                committedStock: inventoryItem.committedStock,
                product: inventoryItem.product
            };

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

            console.log('✅ updateStock completed successfully');

            // ✅ FIX: Session end karne ke baad hi database calls karo
            const updatedInventoryItem = await RetailerInventory.findById(inventoryItemBeforeSave._id)
                .populate('product', 'name sku unit unitSize image');

            // Invalidate cache after successful update
            await CacheService.invalidateInventoryCache(retailerId);

            return {
                success: true,
                inventoryItem: updatedInventoryItem,
                inventoryLog,
                stockChange: newStock - previousStock
            };

        } catch (error) {
            await session.abortTransaction();
            console.error('❌ updateStock failed:', error);
            throw error;
        } finally {
            // ✅ FIX: Session ko end karo transaction complete hone ke baad
            await session.endSession();
        }
    }

    /**
     * Add product to retailer inventory
     */
    async addProductToInventory(retailerId, productData, userId) {
        const session = await mongoose.startSession();
        let savedInventoryItemId = null;

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

            // Get product details
            const product = await Product.findById(productId).session(session);
            if (!product) {
                throw new Error('Product not found');
            }

            // Create inventory item with ALL required fields
            const inventoryItem = new RetailerInventory({
                retailer: retailerId,
                product: productId,
                productName: product.name,
                currentStock: initialStock,
                sellingPrice: sellingPrice || product.price || 0,
                costPrice: costPrice || product.costPrice || 0,
                minStockLevel: minStockLevel || product.minStockLevel || 10,
                maxStockLevel: maxStockLevel || product.maxStockLevel || 100,
                updatedBy: userId
            });

            await inventoryItem.save({ session });
            savedInventoryItemId = inventoryItem._id;

            // Create initial stock log if stock is added - WITH VALID REASON
            if (initialStock > 0) {
                const inventoryLog = new InventoryLog({
                    retailer: retailerId,
                    product: productId,
                    inventoryItem: inventoryItem._id,
                    transactionType: 'STOCK_IN',
                    quantity: initialStock,
                    previousStock: 0,
                    newStock: initialStock,
                    reason: 'INITIAL_SETUP',
                    notes: 'Initial stock setup',
                    createdBy: userId
                });
                await inventoryLog.save({ session });
            }

            await session.commitTransaction();

            // ✅ FIX: Session end hone ke baad hi database call karo
            const result = await RetailerInventory.findById(savedInventoryItemId)
                .populate('product', 'name sku unit unitSize image category');

            // Invalidate cache
            await CacheService.invalidateInventoryCache(retailerId);

            return result;

        } catch (error) {
            await session.abortTransaction();
            throw error;
        } finally {
            await session.endSession();
        }
    }

    /**
     * Get retailer inventory with filters and caching - FIXED CALCULATIONS
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

            // ✅ FIX: Use unitSize instead of unit for display - sirf numeric quantity dikhao
            const formattedInventory = inventory.map(item => {
                const productUnitSize = item.product?.unitSize || 0;
                const currentStock = item.currentStock || 0;
                const committedStock = item.committedStock || 0;
                
                const formattedCurrentStock = typeof currentStock === 'number' ? currentStock : productUnitSize;
                const formattedAvailableStock = formattedCurrentStock - committedStock;

                return {
                    ...item,
                    currentStock: formattedCurrentStock,
                    availableStock: formattedAvailableStock,
                    displayUnit: item.product?.unit || '',
                    product: {
                        ...item.product,
                        displayQuantity: productUnitSize,
                        unit: item.product?.unit || ''
                    }
                };
            });

            // FIXED: Calculate summary stats using JavaScript for accurate calculations
            let totalInventoryValue = 0;
            let totalSalesValue = 0;
            let lowStockCount = 0;
            let outOfStockCount = 0;

            formattedInventory.forEach(item => {
                const itemCurrentStock = item.currentStock || 0;
                const itemSellingPrice = item.sellingPrice || 0;
                const itemInventoryValue = itemCurrentStock * itemSellingPrice;
                totalInventoryValue += itemInventoryValue;

                const itemTotalSold = item.totalSold || 0;
                const itemSalesValue = itemTotalSold * itemSellingPrice;
                totalSalesValue += itemSalesValue;

                const availableStock = itemCurrentStock - (item.committedStock || 0);
                if (availableStock <= (item.minStockLevel || 0)) {
                    lowStockCount++;
                }

                if (availableStock === 0) {
                    outOfStockCount++;
                }
            });

            const result = {
                inventory: formattedInventory,
                summary: {
                    totalProducts: formattedInventory.length,
                    totalInventoryValue,
                    totalSalesValue,
                    lowStockCount,
                    outOfStockCount,
                    totalValue: totalInventoryValue
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
     * Get low stock alerts for retailer - ✅ FIXED: Now properly defined
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
     * Get inventory logs for retailer - ✅ FIXED: Now properly defined
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
     * Update inventory item settings - FIXED WITH VALID REASON VALUES & SESSION
     */
    async updateInventoryItem(inventoryId, retailerId, updateData, userId) {
        const session = await mongoose.startSession();
        let savedInventoryItemId = null;

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
            savedInventoryItemId = inventoryItem._id;

            // Create log for price changes - USE VALID REASON VALUES
            if (updateData.sellingPrice !== undefined || updateData.costPrice !== undefined) {
                let reason = 'CORRECTION';
                let notes = 'Price settings updated';
                
                if (updateData.sellingPrice !== undefined && updateData.costPrice !== undefined) {
                    notes = `Selling price updated to ${updateData.sellingPrice}, Cost price updated to ${updateData.costPrice}`;
                } else if (updateData.sellingPrice !== undefined) {
                    notes = `Selling price updated to ${updateData.sellingPrice}`;
                } else if (updateData.costPrice !== undefined) {
                    notes = `Cost price updated to ${updateData.costPrice}`;
                }

                const inventoryLog = new InventoryLog({
                    retailer: retailerId,
                    product: inventoryItem.product,
                    inventoryItem: inventoryItem._id,
                    transactionType: 'STOCK_ADJUSTMENT',
                    quantity: 0,
                    previousStock: inventoryItem.currentStock,
                    newStock: inventoryItem.currentStock,
                    reason: reason,
                    notes: notes,
                    createdBy: userId
                });
                await inventoryLog.save({ session });
            }

            // Create log for stock level adjustments
            if (updateData.minStockLevel !== undefined || updateData.maxStockLevel !== undefined) {
                const inventoryLog = new InventoryLog({
                    retailer: retailerId,
                    product: inventoryItem.product,
                    inventoryItem: inventoryItem._id,
                    transactionType: 'STOCK_ADJUSTMENT',
                    quantity: 0,
                    previousStock: inventoryItem.currentStock,
                    newStock: inventoryItem.currentStock,
                    reason: 'SYSTEM_ADJUSTMENT',
                    notes: 'Stock level settings updated',
                    createdBy: userId
                });
                await inventoryLog.save({ session });
            }

            await session.commitTransaction();

            // ✅ FIX: Session end hone ke baad hi database call karo
            const result = await RetailerInventory.findById(savedInventoryItemId)
                .populate('product', 'name sku unit unitSize image');

            // Invalidate cache
            await CacheService.invalidateInventoryCache(retailerId);

            return result;

        } catch (error) {
            await session.abortTransaction();
            throw error;
        } finally {
            await session.endSession();
        }
    }

    /**
     * Reserve stock for order - FIXED SESSION ISSUE
     */
    async reserveStockForOrder(orderId, retailerId, items, userId) {
        const session = await mongoose.startSession();
        try {
            session.startTransaction();

            const results = [];

            for (const item of items) {
                const productId = item.productId;

                const inventory = await RetailerInventory.findOne({
                    retailer: retailerId,
                    product: productId,
                    isActive: true
                }).session(session);

                if (!inventory) throw new Error(`Product ${productId} not found in retailer inventory`);

                const available = inventory.currentStock - inventory.committedStock;
                if (available < item.quantity) {
                    throw new Error(`Insufficient stock for ${productId}: available ${available}, requested ${item.quantity}`);
                }

                // Reserve
                inventory.committedStock += item.quantity;
                await inventory.save({ session });

                // Log
                await InventoryLog.create([{
                    retailer: retailerId,
                    product: productId,
                    inventoryItem: inventory._id,
                    transactionType: 'COMMITMENT',
                    quantity: item.quantity,
                    previousStock: inventory.currentStock,
                    newStock: inventory.currentStock,
                    reason: 'ORDER_RESERVATION',
                    referenceType: 'ORDER',
                    referenceId: orderId,
                    notes: `Reserved for order ${orderId}`,
                    createdBy: userId
                }], { session });

                results.push({
                    product: productId,
                    reservedQty: item.quantity,
                    committedStock: inventory.committedStock
                });
            }

            await session.commitTransaction();
            
            // ✅ FIX: Session end karne ke baad hi cache invalidate karo
            await CacheService.invalidateInventoryCache(retailerId);

            return {
                success: true,
                message: `Reserved stock for ${results.length} items`,
                reservedItems: results
            };
        } catch (err) {
            await session.abortTransaction();
            throw err;
        } finally {
            await session.endSession();
        }
    }

    /**
     * Confirm delivery - Deduct reserved stock when order is delivered
     */
    async confirmOrderDelivery(orderId, retailerId, userId) {
        const session = await mongoose.startSession();
        try {
            session.startTransaction();

            const reservationLogs = await InventoryLog.find({
                retailer: retailerId,
                referenceId: orderId,
                transactionType: 'COMMITMENT',
                reason: 'ORDER_RESERVATION'
            }).session(session);

            if (reservationLogs.length === 0)
                throw new Error('No reserved stock found for this order');

            const delivered = [];

            for (const log of reservationLogs) {
                const inventory = await RetailerInventory.findOne({
                    retailer: retailerId,
                    product: log.product
                }).session(session);

                if (!inventory) throw new Error(`Inventory not found for product ${log.product}`);

                // Release commitment
                inventory.committedStock = Math.max(inventory.committedStock - log.quantity, 0);

                // Deduct stock
                if (inventory.currentStock < log.quantity)
                    throw new Error(`Insufficient current stock for ${log.product}`);

                inventory.currentStock -= log.quantity;

                // Update sales
                inventory.totalSold += log.quantity;
                inventory.lastSoldDate = new Date();

                await inventory.save({ session });

                // Log release
                await InventoryLog.create([{
                    retailer: retailerId,
                    product: log.product,
                    inventoryItem: inventory._id,
                    transactionType: 'RELEASE_COMMITMENT',
                    quantity: log.quantity,
                    previousStock: inventory.currentStock + log.quantity,
                    newStock: inventory.currentStock + log.quantity,
                    reason: 'ORDER_DELIVERED',
                    referenceType: 'ORDER',
                    referenceId: orderId,
                    notes: `Released reservation for delivery - order ${orderId}`,
                    createdBy: userId
                }, {
                    retailer: retailerId,
                    product: log.product,
                    inventoryItem: inventory._id,
                    transactionType: 'STOCK_OUT',
                    quantity: log.quantity,
                    previousStock: inventory.currentStock + log.quantity,
                    newStock: inventory.currentStock,
                    reason: 'SALE',
                    referenceType: 'ORDER',
                    referenceId: orderId,
                    notes: `Order ${orderId} delivered - stock deducted`,
                    createdBy: userId
                }], { session });

                delivered.push({
                    product: log.product,
                    quantity: log.quantity,
                    currentStock: inventory.currentStock,
                    committedStock: inventory.committedStock,
                    totalSold: inventory.totalSold
                });
            }

            await session.commitTransaction();
            await CacheService.invalidateInventoryCache(retailerId);

            return {
                success: true,
                message: `Confirmed delivery for ${delivered.length} items`,
                deliveredItems: delivered
            };
        } catch (err) {
            await session.abortTransaction();
            throw err;
        } finally {
            session.endSession();
        }
    }

    /**
     * Cancel order - Release reserved stock
     */
    async cancelOrderReservation(orderId, retailerId, userId, reason = 'ORDER_CANCELLED') {
        const session = await mongoose.startSession();
        try {
            session.startTransaction();

            const reservationLogs = await InventoryLog.find({
                retailer: retailerId,
                referenceId: orderId,
                transactionType: 'COMMITMENT',
                reason: 'ORDER_RESERVATION'
            }).session(session);

            if (reservationLogs.length === 0) {
                return { success: true, message: 'No reserved stock found to release' };
            }

            const released = [];

            for (const log of reservationLogs) {
                const inventory = await RetailerInventory.findOne({
                    retailer: retailerId,
                    product: log.product
                }).session(session);

                if (!inventory) continue;

                inventory.committedStock = Math.max(inventory.committedStock - log.quantity, 0);
                await inventory.save({ session });

                await InventoryLog.create([{
                    retailer: retailerId,
                    product: log.product,
                    inventoryItem: inventory._id,
                    transactionType: 'RELEASE_COMMITMENT',
                    quantity: log.quantity,
                    previousStock: inventory.currentStock,
                    newStock: inventory.currentStock,
                    reason: reason,
                    referenceType: 'ORDER',
                    referenceId: orderId,
                    notes: `Cancelled order ${orderId} - stock released`,
                    createdBy: userId
                }], { session });

                released.push({
                    product: log.product,
                    releasedQty: log.quantity,
                    committedStock: inventory.committedStock
                });
            }

            await session.commitTransaction();
            await CacheService.invalidateInventoryCache(retailerId);

            return {
                success: true,
                message: `Released ${released.length} reserved items`,
                releasedItems: released
            };
        } catch (err) {
            await session.abortTransaction();
            throw err;
        } finally {
            session.endSession();
        }
    }

    /**
     * Get reserved stock details for an order
     */
    async getOrderReservationStatus(orderId, retailerId) {
        const reservationLogs = await InventoryLog.find({
            retailer: retailerId,
            referenceId: orderId,
            transactionType: 'COMMITMENT',
            reason: 'ORDER_RESERVATION'
        }).populate('product', 'name sku unit');

        return {
            orderId,
            retailerId,
            reservedItems: reservationLogs.map(log => ({
                product: log.product,
                quantity: log.quantity,
                reservedAt: log.createdAt
            })),
            totalReserved: reservationLogs.reduce((sum, log) => sum + log.quantity, 0)
        };
    }

    /**
     * Get inventory analytics with correct calculations
     */
    async getInventoryAnalytics(retailerId) {
        try {
            const inventoryData = await this.getRetailerInventory(retailerId, { limit: 1000 }); // Get all inventory
            const recentLogs = await this.getInventoryLogs(retailerId, { limit: 10 });
            const lowStockAlerts = await this.getLowStockAlerts(retailerId);

            return {
                summary: inventoryData.summary,
                recentActivity: recentLogs.logs.slice(0, 5),
                lowStockAlerts,
                timestamp: new Date()
            };
        } catch (error) {
            console.error('Get analytics error:', error);
            throw error;
        }
    }

    /**
     * Get inventory item by product ID for retailer
     */
    async getInventoryItemByProduct(retailerId, productId) {
        try {
            const inventoryItem = await RetailerInventory.findOne({
                retailer: retailerId,
                product: productId,
                isActive: true
            }).populate('product', 'name sku unit unitSize image category');

            if (!inventoryItem) {
                return null;
            }

            // Apply the same formatting as in getRetailerInventory
            const productUnitSize = inventoryItem.product?.unitSize || 0;
            const currentStock = inventoryItem.currentStock || 0;
            const committedStock = inventoryItem.committedStock || 0;
            
            const formattedCurrentStock = typeof currentStock === 'number' ? currentStock : productUnitSize;
            const formattedAvailableStock = formattedCurrentStock - committedStock;

            return {
                ...inventoryItem.toObject(),
                currentStock: formattedCurrentStock,
                availableStock: formattedAvailableStock,
                displayUnit: inventoryItem.product?.unit || '',
                product: {
                    ...inventoryItem.product.toObject(),
                    displayQuantity: productUnitSize,
                    unit: inventoryItem.product?.unit || ''
                }
            };
        } catch (error) {
            console.error('Get inventory item by product error:', error);
            throw error;
        }
    }

    /**
     * Bulk update inventory items
     */
    async bulkUpdateInventory(retailerId, updates, userId) {
        const session = await mongoose.startSession();
        try {
            session.startTransaction();

            const results = [];

            for (const update of updates) {
                const { productId, quantity, transactionType, reason, notes } = update;

                try {
                    const result = await this.updateStock({
                        retailerId,
                        productId,
                        quantity,
                        transactionType,
                        reason,
                        notes,
                        userId
                    });

                    results.push({
                        productId,
                        success: true,
                        result
                    });
                } catch (error) {
                    results.push({
                        productId,
                        success: false,
                        error: error.message
                    });
                }
            }

            await session.commitTransaction();
            await CacheService.invalidateInventoryCache(retailerId);

            return {
                success: true,
                processed: results.length,
                results
            };
        } catch (error) {
            await session.abortTransaction();
            throw error;
        } finally {
            session.endSession();
        }
    }

    /**
     * Get inventory statistics for dashboard
     */
    async getInventoryDashboardStats(retailerId) {
        try {
            const [
                totalProducts,
                lowStockItems,
                outOfStockItems,
                recentActivity,
                inventoryValue
            ] = await Promise.all([
                RetailerInventory.countDocuments({ retailer: retailerId, isActive: true }),
                RetailerInventory.countDocuments({ 
                    retailer: retailerId, 
                    isActive: true,
                    lowStockAlert: true 
                }),
                RetailerInventory.countDocuments({ 
                    retailer: retailerId, 
                    isActive: true,
                    currentStock: 0 
                }),
                InventoryLog.find({ retailer: retailerId })
                    .populate('product', 'name')
                    .sort({ createdAt: -1 })
                    .limit(5)
                    .lean(),
                this.getRetailerInventory(retailerId, { limit: 1000 })
            ]);

            return {
                totalProducts,
                lowStockItems,
                outOfStockItems,
                recentActivity,
                totalInventoryValue: inventoryValue.summary?.totalInventoryValue || 0,
                totalSalesValue: inventoryValue.summary?.totalSalesValue || 0,
                timestamp: new Date()
            };
        } catch (error) {
            console.error('Get dashboard stats error:', error);
            throw error;
        }
    }

    /**
     * Helper method to get valid reason values for debugging
     */
    async getValidReasonValues() {
        try {
            const reasonPath = InventoryLog.schema.path('reason');
            return reasonPath.enumValues;
        } catch (error) {
            console.error('Error getting valid reasons:', error);
            return [];
        }
    }
}

// ✅ IMPORTANT: Export as default instance
export default new InventoryService();