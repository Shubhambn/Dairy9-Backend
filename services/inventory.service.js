// services/inventory.service.js
import RetailerInventory from '../models/retailerInventory.model.js';
import InventoryLog from '../models/inventoryLog.model.js';
import Product from '../models/product.model.js';
import mongoose from 'mongoose';
// At the top of services/inventory.service.js
import CacheService from './cache.service.js';


class InventoryService {
    constructor() {
        this.batchSize = 50;
    }

    /**
     * Update stock with transaction safety
     * 
     */
    /**
   * Check stock availability for items at a retailer
   */
    /**
     * Check stock availability for items at a retailer - FIXED VERSION
     */
    async checkStockAvailability(retailerId, items) {
        try {
            const stockResults = [];
            let allAvailable = true;

            for (const item of items) {
                // 🔧 FIX: Use productId
                const productId = item.productId;

                console.log('🔍 Checking stock for product:', productId);

                const inventory = await RetailerInventory.findOne({
                    retailer: retailerId,
                    product: productId, // Use productId here
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

            if (!productId) throw new Error('productId is required');
            if (typeof quantity !== 'number' && typeof quantity !== 'string') throw new Error('quantity is required');

            const qty = Math.abs(parseInt(quantity, 10));
            if (isNaN(qty) || qty < 0) throw new Error('Invalid quantity');

            // Fetch the inventory doc first (with session)
            const inventoryItem = await RetailerInventory.findOne({
                retailer: retailerId,
                product: productId
            }).session(session);

            if (!inventoryItem) {
                throw new Error('Inventory item not found');
            }

            // Snapshot previous values
            const previousStock = inventoryItem.currentStock || 0;
            const previousCommitted = inventoryItem.committedStock || 0;

            // We'll build atomic updates for inventory
            const updateOps = {};
            const incOps = {};
            const setOps = {
                lastUpdated: new Date(),
                updatedBy: userId
            };

            // Handle transaction types
            switch (transactionType) {
                case 'STOCK_IN':
                    // increase currentStock
                    incOps.currentStock = qty;
                    setOps.lastRestocked = new Date();
                    // update costPrice if provided
                    if (typeof unitCost === 'number' && unitCost >= 0) setOps.costPrice = unitCost;
                    break;

                case 'STOCK_OUT':
                    // ensure enough stock before decrement
                    if (previousStock < qty) {
                        throw new Error('Insufficient stock');
                    }
                    incOps.currentStock = -qty;
                    // sale accounting
                    if (reason === 'SALE') {
                        incOps.totalSold = qty;
                        setOps.lastSoldDate = new Date();
                    }
                    break;

                case 'STOCK_ADJUSTMENT':
                    // set absolute stock
                    if (typeof quantity !== 'number') throw new Error('For STOCK_ADJUSTMENT quantity must be a number (new absolute stock)');
                    if (qty < 0) throw new Error('Stock cannot be negative');
                    setOps.currentStock = qty;
                    break;

                case 'COMMITMENT':
                    // reserve stock: check available
                    const available = previousStock - previousCommitted;
                    if (available < qty) throw new Error('Insufficient available stock for commitment');
                    incOps.committedStock = qty;
                    break;

                case 'RELEASE_COMMITMENT':
                    if (previousCommitted < qty) throw new Error('Cannot release more than committed stock');
                    incOps.committedStock = -qty;
                    break;

                default:
                    throw new Error('Invalid transaction type');
            }

            // Build final update operation
            if (Object.keys(incOps).length) updateOps.$inc = incOps;
            if (Object.keys(setOps).length) updateOps.$set = setOps;

            // Apply atomic update (returns updated doc)
            const updatedInventory = await RetailerInventory.findOneAndUpdate(
                { _id: inventoryItem._id, retailer: retailerId },
                updateOps,
                { new: true, session }
            ).populate('product', 'name sku unit unitSize image');

            // Recompute lowStockAlert using method and persist if changed
            if (updatedInventory) {
                updatedInventory.checkLowStock();
                // If checkLowStock modified lowStockAlert, save the field (without altering stock again)
                await RetailerInventory.updateOne({ _id: updatedInventory._id }, { $set: { lowStockAlert: updatedInventory.lowStockAlert } }, { session });
            }

            // Compose values for log
            const finalStock = (updatedInventory && typeof updatedInventory.currentStock === 'number') ? updatedInventory.currentStock : (previousStock + (incOps.currentStock || 0));
            const logDoc = new InventoryLog({
                retailer: retailerId,
                product: productId,
                inventoryItem: inventoryItem._id,
                transactionType,
                quantity: qty,
                previousStock,
                newStock: finalStock,
                unitCost: typeof unitCost === 'number' && unitCost >= 0 ? unitCost : (inventoryItem.costPrice || 0),
                totalValue: (typeof unitCost === 'number' && unitCost >= 0) ? (unitCost * qty) : ((inventoryItem.costPrice || 0) * qty),
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

            await logDoc.save({ session });

            await session.commitTransaction();
            session.endSession();

            // Invalidate cache after commit
            await CacheService.invalidateInventoryCache(retailerId);

            return {
                success: true,
                inventoryItem: await RetailerInventory.findById(inventoryItem._id).populate('product', 'name sku unit unitSize image'),
                inventoryLog: logDoc,
                stockChange: finalStock - previousStock
            };

        } catch (error) {
            await session.abortTransaction();
            session.endSession();
            console.error('❌ updateStock failed (improved):', error);
            throw error;
        }
    }

    /**
    * Add product to retailer inventory - FIXED VERSION
    */
    /**
     * Add product to retailer inventory - FIXED VERSION
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
                    reason: 'INITIAL_SETUP', // ✅ CORRECTED REASON
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

    async addStockToInventory(payload) {
        const {
            retailerId,
            productId,
            quantity,
            transactionType = 'STOCK_IN',
            reason = 'PURCHASE',
            notes,
            unitCost: incomingUnitCost,
            userId,
            ipAddress,
            userAgent
        } = payload;

        if (!quantity || quantity <= 0) {
            throw new Error('Quantity must be a positive integer');
        }

        const session = await mongoose.startSession();
        session.startTransaction();

        try {
            // Find existing inventory item (for this retailer & product)
            const inventoryItem = await RetailerInventory.findOne({ retailer: retailerId, product: productId }).session(session);

            if (!inventoryItem) {
                // Conservative behavior: if inventory item missing, return helpful error
                // Optionally you can create the inventory item here if you prefer.
                throw new Error('Product not found in retailer inventory. Add the product first.');
            }

            // keep previous values
            const previousStock = inventoryItem.currentStock || 0;

            // Determine unit cost: prefer payload, else inventory.costPrice, else product.price if available
            let unitCost = typeof incomingUnitCost === 'number' && incomingUnitCost >= 0
                ? incomingUnitCost
                : (inventoryItem.costPrice || null);

            if (unitCost === null) {
                // try to fetch product default price
                const product = await Product.findById(productId).session(session);
                if (product) {
                    unitCost = product.price || 0;
                } else {
                    unitCost = 0;
                }
            }

            // Update stock and related fields
            const newStock = previousStock + quantity;
            inventoryItem.currentStock = newStock;
            inventoryItem.lastRestocked = new Date();
            inventoryItem.lastUpdated = new Date();
            inventoryItem.updatedBy = userId;

            // Optionally update costPrice if incoming unitCost provided and valid
            if (typeof incomingUnitCost === 'number' && incomingUnitCost >= 0) {
                inventoryItem.costPrice = incomingUnitCost;
            }

            // Recalculate low stock alert using your method
            inventoryItem.checkLowStock(); // sets lowStockAlert

            // Save inventory
            await inventoryItem.save({ session });

            // Prepare and save inventory log
            const logDoc = new InventoryLog({
                retailer: retailerId,
                product: productId,
                inventoryItem: inventoryItem._id,
                transactionType,
                quantity,
                previousStock,
                newStock,
                unitCost,
                totalValue: unitCost * quantity,
                referenceType: 'MANUAL',
                reason,
                notes,
                createdBy: userId,
                ipAddress,
                userAgent
            });

            await logDoc.save({ session });

            // Commit transaction
            await session.commitTransaction();
            session.endSession();

            // Populate for response
            await inventoryItem.populate('product', 'name description price discount unit unitSize image');
            // Note: retailer populate may not be necessary here (controller already had retailer), but you can populate if needed:
            // await inventoryItem.populate('retailer', 'businessName');

            // Return an object shaped for API response
            return {
                _id: inventoryItem._id,
                retailer: inventoryItem.retailer,
                product: inventoryItem.product,
                productName: inventoryItem.productName,
                previousStock,
                addedQuantity: quantity,
                currentStock: inventoryItem.currentStock,
                availableStock: inventoryItem.availableStock,
                sellingPrice: inventoryItem.sellingPrice,
                costPrice: inventoryItem.costPrice,
                lastRestocked: inventoryItem.lastRestocked,
                lastUpdated: inventoryItem.lastUpdated,
                lowStockAlert: inventoryItem.lowStockAlert,
                log: {
                    _id: logDoc._id,
                    transactionType: logDoc.transactionType,
                    quantity: logDoc.quantity,
                    unitCost: logDoc.unitCost,
                    totalValue: logDoc.totalValue,
                    reason: logDoc.reason,
                    createdAt: logDoc.createdAt
                }
            };

        } catch (err) {
            await session.abortTransaction();
            session.endSession();
            throw err;
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
                                    {
                                        $and: [
                                            { $gt: ['$minStockLevel', 0] },
                                            { $lte: ['$currentStock', '$minStockLevel'] }
                                        ]
                                    },
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
    /**
     * Reserve stock for order - FIXED VERSION
     */

    /**
     * Reserve stock for order
     * 1. Check if available (current - committed >= quantity)
     * 2. If yes → committedStock += quantity
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
            session.endSession();
        }
    }



    /**
     * CONFIRM DELIVERY - Deduct reserved stock when order is delivered
     */
    /**
     * CONFIRM DELIVERY - Deduct reserved stock when order is delivered - FIXED VERSION
     */
    /**
 * CONFIRM DELIVERY - Deduct reserved stock when order is delivered - COMPLETELY FIXED
 */
    /**
     * Confirm delivery
     * 1. committedStock -= qty
     * 2. currentStock -= qty
     * 3. totalSold += qty
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
     * CANCEL ORDER - Release reserved stock
     */
    /**
     * Cancel order
     * 1. committedStock -= quantity
     * 2. Stock levels remain same
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
                    reason,
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

    async recordStockUpdate(payload) {
        const {
            retailerId,
            inventoryId,
            productId,
            userId,
            quantity,
            transactionType = 'STOCK_IN',
            reason,
            notes,
            previousStock,
            newStock,
            ipAddress,
            userAgent,
            unitCost // optional
        } = payload;

        const log = new InventoryLog({
            retailer: retailerId,
            product: productId,
            inventoryItem: inventoryId,
            transactionType,
            quantity: Math.abs(quantity || 0),
            previousStock: typeof previousStock === 'number' ? previousStock : 0,
            newStock: typeof newStock === 'number' ? newStock : 0,
            unitCost: typeof unitCost === 'number' ? unitCost : 0,
            totalValue: (typeof unitCost === 'number' ? unitCost : 0) * (Math.abs(quantity || 0)),
            reason,
            notes,
            createdBy: userId,
            ipAddress,
            userAgent
        });

        await log.save();
        return log;
    }



}

export default new InventoryService();