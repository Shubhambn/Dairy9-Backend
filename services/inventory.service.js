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
            console.error('❌ updateStock failed:', error);
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
                    reason: 'INITIAL_SETUP',
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
            // Product ka unitSize use karo (e.g., 200) aur unit alag field mein rakh do
            const productUnitSize = item.product?.unitSize || 0;
            const currentStock = item.currentStock || 0;
            const committedStock = item.committedStock || 0;
            
            // Agar currentStock already numeric hai toh wahi use karo, nahi toh unitSize use karo
            const formattedCurrentStock = typeof currentStock === 'number' ? currentStock : productUnitSize;
            const formattedAvailableStock = formattedCurrentStock - committedStock;

            console.log(`🔄 Formatting: ${item.product?.name}`, {
                unitSize: productUnitSize,
                currentStock: currentStock,
                formattedCurrentStock: formattedCurrentStock,
                unit: item.product?.unit
            });

            return {
                ...item,
                // ✅ Sirf numeric values return karo
                currentStock: formattedCurrentStock,
                availableStock: formattedAvailableStock,
                // Unit alag field mein rahega agar kabhi display karna ho
                displayUnit: item.product?.unit || '',
                // Original product data bhi rahega
                product: {
                    ...item.product,
                    // Product level par bhi unitSize hi dikhao
                    displayQuantity: productUnitSize,
                    unit: item.product?.unit || '' // Unit alag se available hai
                }
            };
        });


            // FIXED: Calculate summary stats using JavaScript for accurate calculations
            let totalInventoryValue = 0;
            let totalSalesValue = 0;
            let lowStockCount = 0;
            let outOfStockCount = 0;

            console.log('🧮 Calculating inventory values...');
            
            inventory.forEach(item => {
                // CORRECTED: Calculate inventory value (current stock × SELLING PRICE)
                const itemCurrentStock = item.currentStock || 0;
                const itemSellingPrice = item.sellingPrice || 0;
                const itemInventoryValue = itemCurrentStock * itemSellingPrice;
                totalInventoryValue += itemInventoryValue;

                // Calculate sales value (total sold × selling price)
                const itemTotalSold = item.totalSold || 0;
                const itemSalesValue = itemTotalSold * itemSellingPrice;
                totalSalesValue += itemSalesValue;

                // Calculate low stock count
                const availableStock = itemCurrentStock - (item.committedStock || 0);
                if (availableStock <= (item.minStockLevel || 0)) {
                    lowStockCount++;
                }

                // Calculate out of stock count
                if (availableStock === 0) {
                    outOfStockCount++;
                }

                // DEBUG: Log individual product calculations
                console.log(`📊 ${item.productName || item.product?.name}:`);
                console.log(`   Stock: ${itemCurrentStock} × Price: ₹${itemSellingPrice} = ₹${itemInventoryValue}`);
                console.log(`   Sold: ${itemTotalSold} × Price: ₹${itemSellingPrice} = ₹${itemSalesValue}`);
            });

            const result = {
                inventory: formattedInventory,
                summary: {
                    totalProducts: formattedInventory.length,
                    totalInventoryValue, // Total value of all current stock × SELLING PRICE
                    totalSalesValue,     // Total value of all sales × SELLING PRICE
                    lowStockCount,
                    outOfStockCount,
                    totalValue: totalInventoryValue // Backward compatibility
                },
                pagination: {
                    currentPage: parseInt(page),
                    totalPages: Math.ceil(total / limit),
                    totalItems: total,
                    itemsPerPage: parseInt(limit)
                }
            };

            console.log('🎯 FINAL Inventory Summary:', {
                totalProducts: result.summary.totalProducts,
                totalInventoryValue: result.summary.totalInventoryValue,
                totalSalesValue: result.summary.totalSalesValue,
                lowStockCount: result.summary.lowStockCount,
                outOfStockCount: result.summary.outOfStockCount
            });

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
     * Reserve stock for order
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
}

export default new InventoryService();











// // services/inventory.service.js
// import RetailerInventory from '../models/retailerInventory.model.js';
// import InventoryLog from '../models/inventoryLog.model.js';
// import Product from '../models/product.model.js';
// import mongoose from 'mongoose';
// // At the top of services/inventory.service.js
// import CacheService from './cache.service.js';


// class InventoryService {
//     constructor() {
//         this.batchSize = 50;
//     }

//     /**
//      * Update stock with transaction safety
//      * 
//      */
//     /**
//    * Check stock availability for items at a retailer
//    */
//     /**
//      * Check stock availability for items at a retailer - FIXED VERSION
//      */
//     async checkStockAvailability(retailerId, items) {
//         try {
//             const stockResults = [];
//             let allAvailable = true;

//             for (const item of items) {
//                 // 🔧 FIX: Use productId
//                 const productId = item.productId;

//                 console.log('🔍 Checking stock for product:', productId);

//                 const inventory = await RetailerInventory.findOne({
//                     retailer: retailerId,
//                     product: productId, // Use productId here
//                     isActive: true
//                 }).populate('product', 'name sku unit');

//                 if (!inventory) {
//                     stockResults.push({
//                         productId: productId,
//                         available: false,
//                         message: 'Product not found in retailer inventory',
//                         requested: item.quantity,
//                         available: 0,
//                         productName: 'Unknown product'
//                     });
//                     allAvailable = false;
//                     continue;
//                 }

//                 // Calculate available stock (current - committed)
//                 const availableStock = inventory.currentStock - inventory.committedStock;

//                 if (availableStock < item.quantity) {
//                     stockResults.push({
//                         productId: productId,
//                         available: false,
//                         message: `Insufficient stock. Available: ${availableStock}, Requested: ${item.quantity}`,
//                         requested: item.quantity,
//                         available: availableStock,
//                         productName: inventory.product?.name || 'Unknown product',
//                         inventoryId: inventory._id
//                     });
//                     allAvailable = false;
//                 } else {
//                     stockResults.push({
//                         productId: productId,
//                         available: true,
//                         message: 'In stock',
//                         requested: item.quantity,
//                         available: availableStock,
//                         productName: inventory.product?.name || 'Unknown product',
//                         inventoryId: inventory._id
//                     });
//                 }
//             }

//             return {
//                 allAvailable,
//                 items: stockResults,
//                 retailerId,
//                 timestamp: new Date()
//             };
//         } catch (error) {
//             console.error('Stock availability check error:', error);
//             throw new Error(`Failed to check stock availability: ${error.message}`);
//         }
//     }
//     async updateStock(params) {
//         const session = await mongoose.startSession();

//         try {
//             session.startTransaction();

//             const {
//                 retailerId,
//                 productId,
//                 quantity,
//                 transactionType,
//                 reason,
//                 referenceType,
//                 referenceId,
//                 batchNumber,
//                 expiryDate,
//                 unitCost,
//                 notes,
//                 userId,
//                 ipAddress,
//                 userAgent
//             } = params;

//             console.log('🔄 updateStock:', { transactionType, productId, quantity, reason });

//             // Find inventory item
//             const inventoryItem = await RetailerInventory.findOne({
//                 retailer: retailerId,
//                 product: productId
//             }).session(session);

//             if (!inventoryItem) {
//                 throw new Error('Inventory item not found');
//             }

//             console.log('📦 Before update - Current:', inventoryItem.currentStock,
//                 'Committed:', inventoryItem.committedStock,
//                 'Total Sold:', inventoryItem.totalSold);

//             const previousStock = inventoryItem.currentStock;
//             const previousCommitted = inventoryItem.committedStock;
//             let newStock = previousStock;
//             let newCommitted = previousCommitted;

//             // Calculate new stock based on transaction type
//             switch (transactionType) {
//                 case 'STOCK_IN':
//                     newStock = previousStock + Math.abs(quantity);
//                     console.log(`📈 STOCK_IN: ${previousStock} + ${quantity} = ${newStock}`);
//                     inventoryItem.lastRestocked = new Date();
//                     break;

//                 case 'STOCK_OUT':
//                     newStock = previousStock - Math.abs(quantity);
//                     console.log(`📉 STOCK_OUT: ${previousStock} - ${quantity} = ${newStock}`);
//                     if (newStock < 0) {
//                         throw new Error('Insufficient stock');
//                     }

//                     // UPDATE SALES METRICS FOR ACTUAL SALES
//                     if (reason === 'SALE') {
//                         inventoryItem.totalSold += quantity;
//                         inventoryItem.lastSoldDate = new Date();
//                         console.log(`💰 Updated totalSold: +${quantity} = ${inventoryItem.totalSold}`);
//                     }
//                     break;

//                 case 'STOCK_ADJUSTMENT':
//                     newStock = quantity;
//                     console.log(`⚙️ STOCK_ADJUSTMENT: ${previousStock} → ${newStock}`);
//                     if (newStock < 0) {
//                         throw new Error('Stock cannot be negative');
//                     }
//                     break;

//                 case 'COMMITMENT':
//                     const availableStock = inventoryItem.currentStock - inventoryItem.committedStock;
//                     console.log(`🔒 COMMITMENT: Available ${availableStock}, Requested ${quantity}`);
//                     if (availableStock < quantity) {
//                         throw new Error('Insufficient available stock for commitment');
//                     }
//                     newCommitted = previousCommitted + quantity;
//                     console.log(`🔒 COMMITMENT: ${previousCommitted} + ${quantity} = ${newCommitted}`);
//                     break;

//                 case 'RELEASE_COMMITMENT':
//                     console.log(`🔓 RELEASE_COMMITMENT: ${previousCommitted} - ${quantity}`);
//                     if (inventoryItem.committedStock < quantity) {
//                         throw new Error('Cannot release more than committed stock');
//                     }
//                     newCommitted = previousCommitted - quantity;
//                     break;

//                 default:
//                     throw new Error('Invalid transaction type');
//             }

//             // Update inventory values
//             if (!['COMMITMENT', 'RELEASE_COMMITMENT'].includes(transactionType)) {
//                 inventoryItem.currentStock = newStock;
//             } else {
//                 inventoryItem.committedStock = newCommitted;
//             }

//             await inventoryItem.save({ session });

//             console.log('💾 Inventory saved - Current:', inventoryItem.currentStock,
//                 'Committed:', inventoryItem.committedStock,
//                 'Total Sold:', inventoryItem.totalSold);

//             // Create inventory log
//             const inventoryLog = new InventoryLog({
//                 retailer: retailerId,
//                 product: productId,
//                 inventoryItem: inventoryItem._id,
//                 transactionType,
//                 quantity: Math.abs(quantity),
//                 previousStock,
//                 newStock: ['COMMITMENT', 'RELEASE_COMMITMENT'].includes(transactionType) ? previousStock : newStock,
//                 unitCost,
//                 totalValue: unitCost ? unitCost * Math.abs(quantity) : 0,
//                 referenceType,
//                 referenceId,
//                 batchNumber,
//                 expiryDate,
//                 reason,
//                 notes,
//                 createdBy: userId,
//                 ipAddress,
//                 userAgent
//             });

//             await inventoryLog.save({ session });
//             await session.commitTransaction();

//             console.log('✅ updateStock completed successfully');

//             // Invalidate cache after successful update
//             await CacheService.invalidateInventoryCache(retailerId);

//             return {
//                 success: true,
//                 inventoryItem: await RetailerInventory.findById(inventoryItem._id)
//                     .populate('product', 'name sku unit unitSize image'),
//                 inventoryLog,
//                 stockChange: newStock - previousStock
//             };

//         } catch (error) {
//             await session.abortTransaction();
//             console.error('❌ updateStock failed:', error);
//             throw error;
//         } finally {
//             session.endSession();
//         }
//     }
//     /**
//     * Add product to retailer inventory - FIXED VERSION
//     */
//     /**
//      * Add product to retailer inventory - FIXED VERSION
//      */
//     async addProductToInventory(retailerId, productData, userId) {
//         const session = await mongoose.startSession();

//         try {
//             session.startTransaction();

//             const {
//                 productId,
//                 initialStock = 0,
//                 sellingPrice,
//                 costPrice,
//                 minStockLevel,
//                 maxStockLevel
//             } = productData;

//             // Check if product already exists in inventory
//             const existing = await RetailerInventory.findOne({
//                 retailer: retailerId,
//                 product: productId
//             }).session(session);

//             if (existing) {
//                 throw new Error('Product already exists in inventory');
//             }

//             // Get product details
//             const product = await Product.findById(productId).session(session);
//             if (!product) {
//                 throw new Error('Product not found');
//             }

//             // Create inventory item with ALL required fields
//             const inventoryItem = new RetailerInventory({
//                 retailer: retailerId,
//                 product: productId,
//                 productName: product.name,
//                 currentStock: initialStock,
//                 sellingPrice: sellingPrice || product.price || 0,
//                 costPrice: costPrice || product.costPrice || 0,
//                 minStockLevel: minStockLevel || product.minStockLevel || 10,
//                 maxStockLevel: maxStockLevel || product.maxStockLevel || 100,
//                 updatedBy: userId
//             });

//             await inventoryItem.save({ session });

//             // Create initial stock log if stock is added - WITH VALID REASON
//             if (initialStock > 0) {
//                 const inventoryLog = new InventoryLog({
//                     retailer: retailerId,
//                     product: productId,
//                     inventoryItem: inventoryItem._id,
//                     transactionType: 'STOCK_IN',
//                     quantity: initialStock,
//                     previousStock: 0,
//                     newStock: initialStock,
//                     reason: 'INITIAL_SETUP', // ✅ CORRECTED REASON
//                     notes: 'Initial stock setup',
//                     createdBy: userId
//                 });
//                 await inventoryLog.save({ session });
//             }

//             await session.commitTransaction();

//             // Invalidate cache
//             await CacheService.invalidateInventoryCache(retailerId);

//             return await RetailerInventory.findById(inventoryItem._id)
//                 .populate('product', 'name sku unit unitSize image category');

//         } catch (error) {
//             await session.abortTransaction();
//             throw error;
//         } finally {
//             session.endSession();
//         }
//     }

//     /**
//      * Get retailer inventory with filters and caching
//      */
//     async getRetailerInventory(retailerId, filters = {}) {
//         try {
//             // Try cache first
//             const cachedData = await CacheService.getInventoryCache(retailerId, filters);
//             if (cachedData) {
//                 return cachedData;
//             }

//             const {
//                 page = 1,
//                 limit = 50,
//                 search,
//                 category,
//                 lowStock,
//                 outOfStock,
//                 sortBy = 'product.name',
//                 sortOrder = 'asc'
//             } = filters;

//             let query = { retailer: retailerId, isActive: true };

//             // Apply filters
//             if (search) {
//                 query.$or = [
//                     { 'product.name': { $regex: search, $options: 'i' } },
//                     { 'product.sku': { $regex: search, $options: 'i' } }
//                 ];
//             }

//             if (category) {
//                 query['product.category'] = new mongoose.Types.ObjectId(category);
//             }

//             if (lowStock === 'true') {
//                 query.lowStockAlert = true;
//             }

//             if (outOfStock === 'true') {
//                 query.outOfStock = true;
//             }

//             // Build sort object
//             const sort = {};
//             if (sortBy.startsWith('product.')) {
//                 const field = sortBy.split('.')[1];
//                 sort[`product.${field}`] = sortOrder === 'desc' ? -1 : 1;
//             } else {
//                 sort[sortBy] = sortOrder === 'desc' ? -1 : 1;
//             }

//             const [inventory, total] = await Promise.all([
//                 RetailerInventory.find(query)
//                     .populate('product', 'name sku unit unitSize image category milkType')
//                     .populate('product.category', 'name')
//                     .sort(sort)
//                     .limit(parseInt(limit))
//                     .skip((parseInt(page) - 1) * parseInt(limit))
//                     .lean(),

//                 RetailerInventory.countDocuments(query)
//             ]);

//             // Calculate summary stats
//             const stats = await RetailerInventory.aggregate([
//                 { $match: { retailer: new mongoose.Types.ObjectId(retailerId), isActive: true } },
//                 {
//                     $group: {
//                         _id: null,
//                         totalProducts: { $sum: 1 },
//                         totalValue: {
//                             $sum: {
//                                 $cond: [
//                                     { $gt: ['$costPrice', 0] },
//                                     { $multiply: ['$currentStock', '$costPrice'] },
//                                     0
//                                 ]
//                             }
//                         },
//                         lowStockCount: {
//                             $sum: {
//                                 $cond: [
//                                     {
//                                         $and: [
//                                             { $gt: ['$minStockLevel', 0] },
//                                             { $lte: ['$currentStock', '$minStockLevel'] }
//                                         ]
//                                     },
//                                     1,
//                                     0
//                                 ]
//                             }
//                         },
//                         outOfStockCount: {
//                             $sum: {
//                                 $cond: [{ $eq: ['$currentStock', 0] }, 1, 0]
//                             }
//                         }
//                     }
//                 }
//             ]);

//             const result = {
//                 inventory,
//                 summary: stats[0] || {
//                     totalProducts: 0,
//                     totalValue: 0,
//                     lowStockCount: 0,
//                     outOfStockCount: 0
//                 },
//                 pagination: {
//                     currentPage: parseInt(page),
//                     totalPages: Math.ceil(total / limit),
//                     totalItems: total,
//                     itemsPerPage: parseInt(limit)
//                 }
//             };

//             // Cache the result
//             await CacheService.setInventoryCache(retailerId, result, filters);

//             return result;

//         } catch (error) {
//             console.error('Get retailer inventory error:', error);
//             throw error;
//         }
//     }

//     /**
//      * Get low stock alerts for retailer
//      */
//     async getLowStockAlerts(retailerId, threshold = 0.2) {
//         try {
//             const inventory = await RetailerInventory.find({
//                 retailer: retailerId,
//                 isActive: true,
//                 lowStockAlert: true
//             })
//                 .populate('product', 'name sku unit unitSize image')
//                 .sort({ currentStock: 1 })
//                 .lean();

//             // Categorize by severity
//             const critical = inventory.filter(item =>
//                 item.currentStock <= (item.minStockLevel * threshold)
//             );

//             const warning = inventory.filter(item =>
//                 item.currentStock > (item.minStockLevel * threshold) &&
//                 item.currentStock <= item.minStockLevel
//             );

//             return {
//                 critical,
//                 warning,
//                 total: inventory.length
//             };
//         } catch (error) {
//             console.error('Get low stock alerts error:', error);
//             throw error;
//         }
//     }

//     /**
//      * Get inventory logs for retailer
//      */
//     async getInventoryLogs(retailerId, filters = {}) {
//         try {
//             const {
//                 page = 1,
//                 limit = 50,
//                 productId,
//                 transactionType,
//                 startDate,
//                 endDate
//             } = filters;

//             let query = { retailer: retailerId };

//             if (productId) {
//                 query.product = new mongoose.Types.ObjectId(productId);
//             }

//             if (transactionType) {
//                 query.transactionType = transactionType;
//             }

//             if (startDate || endDate) {
//                 query.createdAt = {};
//                 if (startDate) query.createdAt.$gte = new Date(startDate);
//                 if (endDate) query.createdAt.$lte = new Date(endDate);
//             }

//             const [logs, total] = await Promise.all([
//                 InventoryLog.find(query)
//                     .populate('product', 'name sku unit image')
//                     .populate('createdBy', 'name')
//                     .sort({ createdAt: -1 })
//                     .limit(parseInt(limit))
//                     .skip((parseInt(page) - 1) * parseInt(limit))
//                     .lean(),

//                 InventoryLog.countDocuments(query)
//             ]);

//             return {
//                 logs,
//                 pagination: {
//                     currentPage: parseInt(page),
//                     totalPages: Math.ceil(total / limit),
//                     totalLogs: total
//                 }
//             };
//         } catch (error) {
//             console.error('Get inventory logs error:', error);
//             throw error;
//         }
//     }

//     /**
//      * Update inventory item settings
//      */
//     async updateInventoryItem(inventoryId, retailerId, updateData, userId) {
//         const session = await mongoose.startSession();

//         try {
//             session.startTransaction();

//             const inventoryItem = await RetailerInventory.findOne({
//                 _id: inventoryId,
//                 retailer: retailerId
//             }).session(session);

//             if (!inventoryItem) {
//                 throw new Error('Inventory item not found');
//             }

//             // Update allowed fields
//             const allowedFields = [
//                 'sellingPrice', 'costPrice', 'minStockLevel',
//                 'maxStockLevel', 'reorderQuantity', 'isActive'
//             ];

//             allowedFields.forEach(field => {
//                 if (updateData[field] !== undefined) {
//                     inventoryItem[field] = updateData[field];
//                 }
//             });

//             await inventoryItem.save({ session });

//             // Create log for significant changes
//             if (updateData.sellingPrice !== undefined || updateData.costPrice !== undefined) {
//                 const inventoryLog = new InventoryLog({
//                     retailer: retailerId,
//                     product: inventoryItem.product,
//                     inventoryItem: inventoryItem._id,
//                     transactionType: 'STOCK_ADJUSTMENT',
//                     quantity: 0,
//                     previousStock: inventoryItem.currentStock,
//                     newStock: inventoryItem.currentStock,
//                     reason: 'ADJUSTMENT',
//                     notes: 'Price/settings update',
//                     createdBy: userId
//                 });
//                 await inventoryLog.save({ session });
//             }

//             await session.commitTransaction();

//             // Invalidate cache
//             await CacheService.invalidateInventoryCache(retailerId);

//             return await RetailerInventory.findById(inventoryItem._id)
//                 .populate('product', 'name sku unit unitSize image');

//         } catch (error) {
//             await session.abortTransaction();
//             throw error;
//         } finally {
//             session.endSession();
//         }
//     }
//     /**
//      * Reserve stock for order - FIXED VERSION
//      */

// /**
//  * Reserve stock for order
//  * 1. Check if available (current - committed >= quantity)
//  * 2. If yes → committedStock += quantity
//  */
// async reserveStockForOrder(orderId, retailerId, items, userId) {
//   const session = await mongoose.startSession();
//   try {
//     session.startTransaction();

//     const results = [];

//     for (const item of items) {
//       const productId = item.productId;

//       const inventory = await RetailerInventory.findOne({
//         retailer: retailerId,
//         product: productId,
//         isActive: true
//       }).session(session);

//       if (!inventory) throw new Error(`Product ${productId} not found in retailer inventory`);

//       const available = inventory.currentStock - inventory.committedStock;
//       if (available < item.quantity) {
//         throw new Error(`Insufficient stock for ${productId}: available ${available}, requested ${item.quantity}`);
//       }

//       // Reserve
//       inventory.committedStock += item.quantity;
//       await inventory.save({ session });

//       // Log
//       await InventoryLog.create([{
//         retailer: retailerId,
//         product: productId,
//         inventoryItem: inventory._id,
//         transactionType: 'COMMITMENT',
//         quantity: item.quantity,
//         previousStock: inventory.currentStock,
//         newStock: inventory.currentStock,
//         reason: 'ORDER_RESERVATION',
//         referenceType: 'ORDER',
//         referenceId: orderId,
//         notes: `Reserved for order ${orderId}`,
//         createdBy: userId
//       }], { session });

//       results.push({
//         product: productId,
//         reservedQty: item.quantity,
//         committedStock: inventory.committedStock
//       });
//     }

//     await session.commitTransaction();
//     await CacheService.invalidateInventoryCache(retailerId);

//     return {
//       success: true,
//       message: `Reserved stock for ${results.length} items`,
//       reservedItems: results
//     };
//   } catch (err) {
//     await session.abortTransaction();
//     throw err;
//   } finally {
//     session.endSession();
//   }
// }



//     /**
//      * CONFIRM DELIVERY - Deduct reserved stock when order is delivered
//      */
//     /**
//      * CONFIRM DELIVERY - Deduct reserved stock when order is delivered - FIXED VERSION
//      */
//     /**
//  * CONFIRM DELIVERY - Deduct reserved stock when order is delivered - COMPLETELY FIXED
//  */
// /**
//  * Confirm delivery
//  * 1. committedStock -= qty
//  * 2. currentStock -= qty
//  * 3. totalSold += qty
//  */
// async confirmOrderDelivery(orderId, retailerId, userId) {
//   const session = await mongoose.startSession();
//   try {
//     session.startTransaction();

//     const reservationLogs = await InventoryLog.find({
//       retailer: retailerId,
//       referenceId: orderId,
//       transactionType: 'COMMITMENT',
//       reason: 'ORDER_RESERVATION'
//     }).session(session);

//     if (reservationLogs.length === 0)
//       throw new Error('No reserved stock found for this order');

//     const delivered = [];

//     for (const log of reservationLogs) {
//       const inventory = await RetailerInventory.findOne({
//         retailer: retailerId,
//         product: log.product
//       }).session(session);

//       if (!inventory) throw new Error(`Inventory not found for product ${log.product}`);

//       // Release commitment
//       inventory.committedStock = Math.max(inventory.committedStock - log.quantity, 0);

//       // Deduct stock
//       if (inventory.currentStock < log.quantity)
//         throw new Error(`Insufficient current stock for ${log.product}`);

//       inventory.currentStock -= log.quantity;

//       // Update sales
//       inventory.totalSold += log.quantity;
//       inventory.lastSoldDate = new Date();

//       await inventory.save({ session });

//       // Log release
//       await InventoryLog.create([{
//         retailer: retailerId,
//         product: log.product,
//         inventoryItem: inventory._id,
//         transactionType: 'RELEASE_COMMITMENT',
//         quantity: log.quantity,
//         previousStock: inventory.currentStock + log.quantity,
//         newStock: inventory.currentStock + log.quantity,
//         reason: 'ORDER_DELIVERED',
//         referenceType: 'ORDER',
//         referenceId: orderId,
//         notes: `Released reservation for delivery - order ${orderId}`,
//         createdBy: userId
//       }, {
//         retailer: retailerId,
//         product: log.product,
//         inventoryItem: inventory._id,
//         transactionType: 'STOCK_OUT',
//         quantity: log.quantity,
//         previousStock: inventory.currentStock + log.quantity,
//         newStock: inventory.currentStock,
//         reason: 'SALE',
//         referenceType: 'ORDER',
//         referenceId: orderId,
//         notes: `Order ${orderId} delivered - stock deducted`,
//         createdBy: userId
//       }], { session });

//       delivered.push({
//         product: log.product,
//         quantity: log.quantity,
//         currentStock: inventory.currentStock,
//         committedStock: inventory.committedStock,
//         totalSold: inventory.totalSold
//       });
//     }

//     await session.commitTransaction();
//     await CacheService.invalidateInventoryCache(retailerId);

//     return {
//       success: true,
//       message: `Confirmed delivery for ${delivered.length} items`,
//       deliveredItems: delivered
//     };
//   } catch (err) {
//     await session.abortTransaction();
//     throw err;
//   } finally {
//     session.endSession();
//   }
// }


//     /**
//      * CANCEL ORDER - Release reserved stock
//      */
// /**
//  * Cancel order
//  * 1. committedStock -= quantity
//  * 2. Stock levels remain same
//  */
// async cancelOrderReservation(orderId, retailerId, userId, reason = 'ORDER_CANCELLED') {
//   const session = await mongoose.startSession();
//   try {
//     session.startTransaction();

//     const reservationLogs = await InventoryLog.find({
//       retailer: retailerId,
//       referenceId: orderId,
//       transactionType: 'COMMITMENT',
//       reason: 'ORDER_RESERVATION'
//     }).session(session);

//     if (reservationLogs.length === 0) {
//       return { success: true, message: 'No reserved stock found to release' };
//     }

//     const released = [];

//     for (const log of reservationLogs) {
//       const inventory = await RetailerInventory.findOne({
//         retailer: retailerId,
//         product: log.product
//       }).session(session);

//       if (!inventory) continue;

//       inventory.committedStock = Math.max(inventory.committedStock - log.quantity, 0);
//       await inventory.save({ session });

//       await InventoryLog.create([{
//         retailer: retailerId,
//         product: log.product,
//         inventoryItem: inventory._id,
//         transactionType: 'RELEASE_COMMITMENT',
//         quantity: log.quantity,
//         previousStock: inventory.currentStock,
//         newStock: inventory.currentStock,
//         reason,
//         referenceType: 'ORDER',
//         referenceId: orderId,
//         notes: `Cancelled order ${orderId} - stock released`,
//         createdBy: userId
//       }], { session });

//       released.push({
//         product: log.product,
//         releasedQty: log.quantity,
//         committedStock: inventory.committedStock
//       });
//     }

//     await session.commitTransaction();
//     await CacheService.invalidateInventoryCache(retailerId);

//     return {
//       success: true,
//       message: `Released ${released.length} reserved items`,
//       releasedItems: released
//     };
//   } catch (err) {
//     await session.abortTransaction();
//     throw err;
//   } finally {
//     session.endSession();
//   }
// }


//     /**
//      * Get reserved stock details for an order
//      */
//     async getOrderReservationStatus(orderId, retailerId) {
//         const reservationLogs = await InventoryLog.find({
//             retailer: retailerId,
//             referenceId: orderId,
//             transactionType: 'COMMITMENT',
//             reason: 'ORDER_RESERVATION'
//         }).populate('product', 'name sku unit');

//         return {
//             orderId,
//             retailerId,
//             reservedItems: reservationLogs.map(log => ({
//                 product: log.product,
//                 quantity: log.quantity,
//                 reservedAt: log.createdAt
//             })),
//             totalReserved: reservationLogs.reduce((sum, log) => sum + log.quantity, 0)
//         };
//     }


// }

// export default new InventoryService();