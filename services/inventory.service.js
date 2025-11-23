// services/inventory.service.js - COMPLETE UPDATED VERSION WITH PRICE VALIDATION
import RetailerInventory from '../models/retailerInventory.model.js';
import InventoryLog from '../models/inventoryLog.model.js';
import Product from '../models/product.model.js';
import Order from '../models/order.model.js';
import mongoose from 'mongoose';
import CacheService from './cache.service.js';

class InventoryService {
    constructor() {
        this.batchSize = 50;
    }

    /**
     * 🔥 NEW: Validate and correct suspicious retailer prices
     */
    async validateAndCorrectRetailerPrice(retailerId, productId, userId = 'system') {
        try {
            const inventoryItem = await RetailerInventory.findOne({
                retailer: retailerId,
                product: productId,
                isActive: true
            }).populate('product', 'name price');

            if (!inventoryItem || !inventoryItem.product) {
                return { valid: false, message: 'Inventory item not found' };
            }

            const catalogPrice = inventoryItem.product.price || 0;
            const retailerPrice = inventoryItem.sellingPrice || 0;

            // If retailer price is suspiciously high (more than 5x catalog price), correct it
            if (retailerPrice > catalogPrice * 5 && catalogPrice > 0) {
                console.warn(`🔄 Correcting suspicious retailer price: ${retailerPrice} → ${catalogPrice} for product ${inventoryItem.product.name}`);
                
                const previousPrice = retailerPrice;
                inventoryItem.sellingPrice = catalogPrice;
                await inventoryItem.save();
                
                // Log the correction
                await InventoryLog.create({
                    retailer: retailerId,
                    product: productId,
                    inventoryItem: inventoryItem._id,
                    transactionType: 'STOCK_ADJUSTMENT',
                    quantity: 0,
                    previousStock: inventoryItem.currentStock,
                    newStock: inventoryItem.currentStock,
                    reason: 'PRICE_CORRECTION',
                    notes: `Auto-corrected suspicious price from ${previousPrice} to ${catalogPrice}`,
                    createdBy: userId
                });

                // Invalidate cache
                await CacheService.invalidateInventoryCache(retailerId);

                return {
                    valid: true,
                    corrected: true,
                    previousPrice,
                    correctedPrice: catalogPrice,
                    message: 'Price auto-corrected'
                };
            }

            return {
                valid: true,
                corrected: false,
                currentPrice: retailerPrice,
                message: 'Price is valid'
            };
        } catch (error) {
            console.error('Price validation error:', error);
            return { valid: false, message: error.message };
        }
    }

    /**
     * 🔥 NEW: Get validated product price with auto-correction
     */
    async getValidatedProductPrice(retailerId, productId, userId = 'system') {
        try {
            const inventoryItem = await RetailerInventory.findOne({
                retailer: retailerId,
                product: productId,
                isActive: true
            }).populate('product', 'name price category');

            if (!inventoryItem) {
                throw new Error('Product not found in retailer inventory');
            }

            const catalogPrice = inventoryItem.product?.price || 0;
            let retailerPrice = inventoryItem.sellingPrice || 0;

            // Validate and correct price if suspicious
            let priceCorrected = false;
            if (retailerPrice > catalogPrice * 5 && catalogPrice > 0) {
                console.warn(`🔄 Auto-correcting price: ${retailerPrice} → ${catalogPrice}`);
                retailerPrice = catalogPrice;
                priceCorrected = true;
                
                // Update the price in database
                inventoryItem.sellingPrice = catalogPrice;
                await inventoryItem.save();

                // Log the correction
                await InventoryLog.create({
                    retailer: retailerId,
                    product: productId,
                    inventoryItem: inventoryItem._id,
                    transactionType: 'STOCK_ADJUSTMENT',
                    quantity: 0,
                    previousStock: inventoryItem.currentStock,
                    newStock: inventoryItem.currentStock,
                    reason: 'PRICE_CORRECTION',
                    notes: `Auto-corrected suspicious price for offline order`,
                    createdBy: userId
                });

                await CacheService.invalidateInventoryCache(retailerId);
            }

            // Calculate pricing with discounts
            const priceInfo = await this.calculatePriceWithDiscounts(inventoryItem, retailerPrice, 1);

            return {
                productId,
                productName: inventoryItem.productName,
                catalogPrice,
                retailerPrice,
                ...priceInfo,
                priceCorrected,
                hasQuantityPricing: inventoryItem.enableQuantityPricing,
                pricingSlabs: inventoryItem.pricingSlabs || [],
                currentStock: inventoryItem.currentStock,
                availableStock: inventoryItem.currentStock - inventoryItem.committedStock
            };
        } catch (error) {
            console.error('Get validated product price error:', error);
            throw error;
        }
    }

    /**
     * 🔥 NEW: Calculate price with discounts for given quantity
     */
    async calculatePriceWithDiscounts(inventoryItem, basePrice, quantity) {
        let discountedPrice = basePrice;
        let appliedDiscount = 0;
        let discountType = null;
        let applicableSlab = null;

        // Apply pricing slab discounts if available
        if (inventoryItem.enableQuantityPricing && inventoryItem.pricingSlabs?.length > 0) {
            applicableSlab = inventoryItem.pricingSlabs.find(slab => 
                quantity >= slab.minQuantity && quantity <= slab.maxQuantity
            );
            
            if (applicableSlab) {
                if (applicableSlab.discountType === 'PERCENTAGE') {
                    appliedDiscount = (basePrice * applicableSlab.discountValue) / 100;
                    discountedPrice = basePrice - appliedDiscount;
                    discountType = 'percentage';
                } else if (applicableSlab.discountType === 'FLAT') {
                    appliedDiscount = applicableSlab.discountValue;
                    discountedPrice = basePrice - appliedDiscount;
                    discountType = 'flat';
                }
            }
        }

        return {
            basePrice,
            discountedPrice,
            appliedDiscount,
            discountType,
            applicableSlab,
            finalPrice: discountedPrice * quantity,
            baseTotal: basePrice * quantity,
            discountTotal: appliedDiscount * quantity,
            finalUnitPrice: discountedPrice
        };
    }

    /**
     * 🔥 UPDATED: Calculate price for quantity with validation
     */
    async calculatePriceForQuantity(retailerId, productId, quantity, userId = 'system') {
        try {
            const inventoryItem = await RetailerInventory.findOne({
                retailer: retailerId,
                product: productId,
                isActive: true
            }).populate('product', 'name sku unit unitSize image price');

            if (!inventoryItem) {
                throw new Error('Product not found in inventory');
            }

            const catalogPrice = inventoryItem.product?.price || 0;
            let retailerPrice = inventoryItem.sellingPrice || 0;

            // Validate and correct price if suspicious
            let priceCorrected = false;
            if (retailerPrice > catalogPrice * 5 && catalogPrice > 0) {
                console.warn(`🔄 Auto-correcting price in calculatePriceForQuantity: ${retailerPrice} → ${catalogPrice}`);
                retailerPrice = catalogPrice;
                priceCorrected = true;
                
                // Update the price in database
                inventoryItem.sellingPrice = catalogPrice;
                await inventoryItem.save();

                // Log the correction
                await InventoryLog.create({
                    retailer: retailerId,
                    product: productId,
                    inventoryItem: inventoryItem._id,
                    transactionType: 'STOCK_ADJUSTMENT',
                    quantity: 0,
                    previousStock: inventoryItem.currentStock,
                    newStock: inventoryItem.currentStock,
                    reason: 'PRICE_CORRECTION',
                    notes: `Auto-corrected suspicious price during price calculation`,
                    createdBy: userId
                });

                await CacheService.invalidateInventoryCache(retailerId);
            }

            // Calculate pricing with discounts
            const priceInfo = await this.calculatePriceWithDiscounts(inventoryItem, retailerPrice, quantity);

            return {
                productId,
                productName: inventoryItem.productName,
                catalogPrice,
                retailerPrice,
                ...priceInfo,
                priceCorrected,
                hasQuantityPricing: inventoryItem.enableQuantityPricing,
                pricingSlabs: inventoryItem.enableQuantityPricing ? inventoryItem.pricingSlabs : []
            };
        } catch (error) {
            console.error('Calculate price error:', error);
            throw error;
        }
    }

    /**
     * 🔥 NEW: Bulk validate and correct prices
     */
    async bulkValidateAndCorrectPrices(retailerId, productIds, userId = 'system') {
        try {
            const inventoryItems = await RetailerInventory.find({
                retailer: retailerId,
                product: { $in: productIds },
                isActive: true
            }).populate('product', 'name price category');

            const results = [];
            let correctedCount = 0;

            for (const inventoryItem of inventoryItems) {
                const catalogPrice = inventoryItem.product?.price || 0;
                let retailerPrice = inventoryItem.sellingPrice || 0;

                // Validate price and correct if suspicious
                let priceCorrected = false;
                if (retailerPrice > catalogPrice * 5 && catalogPrice > 0) {
                    retailerPrice = catalogPrice;
                    priceCorrected = true;
                    correctedCount++;
                    
                    // Update the price in database
                    inventoryItem.sellingPrice = catalogPrice;
                    await inventoryItem.save();

                    // Log the correction
                    await InventoryLog.create({
                        retailer: retailerId,
                        product: inventoryItem.product._id,
                        inventoryItem: inventoryItem._id,
                        transactionType: 'STOCK_ADJUSTMENT',
                        quantity: 0,
                        previousStock: inventoryItem.currentStock,
                        newStock: inventoryItem.currentStock,
                        reason: 'PRICE_CORRECTION',
                        notes: `Auto-corrected suspicious price in bulk validation`,
                        createdBy: userId
                    });
                }

                // Calculate pricing with discounts (for quantity = 1)
                const priceInfo = await this.calculatePriceWithDiscounts(inventoryItem, retailerPrice, 1);

                results.push({
                    productId: inventoryItem.product._id,
                    productName: inventoryItem.productName,
                    catalogPrice,
                    retailerPrice,
                    ...priceInfo,
                    priceCorrected,
                    hasQuantityPricing: inventoryItem.enableQuantityPricing,
                    pricingSlabs: inventoryItem.pricingSlabs || [],
                    currentStock: inventoryItem.currentStock,
                    availableStock: inventoryItem.currentStock - inventoryItem.committedStock
                });
            }

            // Invalidate cache if any corrections were made
            if (correctedCount > 0) {
                await CacheService.invalidateInventoryCache(retailerId);
            }

            return {
                products: results,
                totalProducts: results.length,
                correctedCount,
                message: correctedCount > 0 ? 
                    `Corrected ${correctedCount} suspicious prices automatically` : 
                    'All prices are valid'
            };
        } catch (error) {
            console.error('Bulk validate prices error:', error);
            throw error;
        }
    }

    /**
     * Calculate revenue metrics from ORDERS (SIMPLE & ACCURATE APPROACH)
     */
    async calculateRevenueMetrics(retailerId, timeFilter = 'all') {
        try {
            const { startDate, endDate } = this.getDateRange(timeFilter);
            
            console.log(`💰 Calculating revenue for retailer ${retailerId} from ${startDate} to ${endDate}`);

            // Get all DELIVERED orders (completed transactions) within date range
            const deliveredOrders = await Order.find({
                assignedRetailer: retailerId,
                 orderStatus: { $in: ['delivered', 'completed'] },
                $or: [
                { deliveredAt: { $gte: startDate, $lte: endDate } },
                { createdAt: { $gte: startDate, $lte: endDate } } // ✅ Fallback to createdAt
            ]
            }).populate('items.product', 'name category');

            console.log(`📦 Found ${deliveredOrders.length} delivered orders for revenue calculation`);

            // Calculate metrics from actual orders
            return this.calculateMetricsFromOrders(deliveredOrders);

        } catch (error) {
            console.error('Revenue calculation error:', error);
            return this.getDefaultRevenueMetrics();
        }
    }

    /**
     * Calculate metrics directly from order data
     */
    calculateMetricsFromOrders(orders) {
        let totalSales = 0;
        let totalRevenue = 0;
        let totalItemsSold = 0;
        let totalDiscount = 0;
        
        orders.forEach(order => {
            // Use FINAL amount from order (this includes all overrides and discounts)
            const orderTotal = order.finalAmount || order.totalAmount || 0;
            totalSales += orderTotal;

            // Calculate revenue (sales - cost)
            let orderRevenue = 0;
            let orderItemsSold = 0;

            order.items.forEach(item => {
                const quantity = item.quantity || 0;
                const sellingPrice = item.price || 0; // ACTUAL charged price
                const costPrice = item.costPrice || sellingPrice * 0.7; // Estimate cost if not available
                
                orderItemsSold += quantity;
                
                // Revenue = (Selling Price - Cost Price) * Quantity
                const itemRevenue = (sellingPrice - costPrice) * quantity;
                orderRevenue += itemRevenue;
            });

            totalRevenue += orderRevenue;
            totalItemsSold += orderItemsSold;
            totalDiscount += order.discount || 0;
        });

        // Calculate averages and percentages
        const averageOrderValue = orders.length > 0 ? totalSales / orders.length : 0;
        const profitMargin = totalSales > 0 ? (totalRevenue / totalSales) * 100 : 0;

        return {
            totalSales: Math.round(totalSales * 100) / 100,
            totalRevenue: Math.round(totalRevenue * 100) / 100,
            totalItemsSold,
            totalDiscount: Math.round(totalDiscount * 100) / 100,
            averageOrderValue: Math.round(averageOrderValue * 100) / 100,
            profitMargin: Math.round(profitMargin * 100) / 100,
            totalOrders: orders.length
        };
    }

    /**
     * Get date range based on time filter
     */
    getDateRange(timeFilter) {
        const now = new Date();
        let startDate = new Date('2020-01-01');
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

    getDefaultRevenueMetrics() {
        return {
            totalSales: 0,
            totalRevenue: 0,
            totalItemsSold: 0,
            totalDiscount: 0,
            averageOrderValue: 0,
            profitMargin: 0,
            totalOrders: 0
        };
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
     * Get retailer inventory with REVENUE-BASED calculations
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
                sortOrder = 'asc',
                timeFilter = 'all' // NEW: Time filter for revenue context
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

            // 🔥 REVENUE-BASED CALCULATIONS: Get metrics from ORDERS
            const revenueMetrics = await this.calculateRevenueMetrics(retailerId, timeFilter);

            // Calculate inventory-specific metrics
            let totalInventoryValue = 0;
            let lowStockCount = 0;
            let outOfStockCount = 0;

            formattedInventory.forEach(item => {
                const itemCurrentStock = item.currentStock || 0;
                const itemSellingPrice = item.sellingPrice || 0;
                const itemInventoryValue = itemCurrentStock * itemSellingPrice;
                totalInventoryValue += itemInventoryValue;

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
                    totalInventoryValue: Math.round(totalInventoryValue * 100) / 100,
                    // 🔥 USE ACTUAL REVENUE FROM ORDERS
                    totalSales: revenueMetrics.totalSales,
                    totalRevenue: revenueMetrics.totalRevenue,
                    lowStockCount,
                    outOfStockCount,
                    // Additional revenue metrics
                    totalItemsSold: revenueMetrics.totalItemsSold,
                    profitMargin: revenueMetrics.profitMargin,
                    averageOrderValue: revenueMetrics.averageOrderValue
                },
                pagination: {
                    currentPage: parseInt(page),
                    totalPages: Math.ceil(total / limit),
                    totalItems: total,
                    itemsPerPage: parseInt(limit)
                },
                revenueContext: {
                    timeFilter,
                    period: this.getDateRange(timeFilter)
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

            // Update allowed fields including pricing slabs
            const allowedFields = [
                'sellingPrice', 'costPrice', 'minStockLevel', 'maxStockLevel',
                'enableQuantityPricing', 'pricingSlabs'
            ];

            allowedFields.forEach(field => {
                if (updateData[field] !== undefined) {
                    inventoryItem[field] = updateData[field];
                }
            });

            // Validate pricing slabs if enabled
            if (updateData.enableQuantityPricing && updateData.pricingSlabs) {
                this.validatePricingSlabs(updateData.pricingSlabs);
            }

            await inventoryItem.save({ session });
            savedInventoryItemId = inventoryItem._id;

            // Create comprehensive log
            const inventoryLog = new InventoryLog({
                retailer: retailerId,
                product: inventoryItem.product,
                inventoryItem: inventoryItem._id,
                transactionType: 'STOCK_ADJUSTMENT',
                quantity: 0,
                previousStock: inventoryItem.currentStock,
                newStock: inventoryItem.currentStock,
                reason: 'SETTINGS_UPDATE',
                notes: `Product settings updated - Price: ₹${inventoryItem.sellingPrice}, Quantity Pricing: ${inventoryItem.enableQuantityPricing ? 'Enabled' : 'Disabled'}`,
                createdBy: userId
            });
            await inventoryLog.save({ session });

            await session.commitTransaction();

            // Get updated inventory item
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
     * Get inventory analytics with REVENUE-BASED calculations
     */
    async getInventoryAnalytics(retailerId, timeFilter = 'all') {
        try {
            const inventoryData = await this.getRetailerInventory(retailerId, { limit: 1000, timeFilter });
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
     * Get inventory statistics for dashboard WITH REVENUE
     */
    async getInventoryDashboardStats(retailerId, timeFilter = 'all') {
    try {
        const revenueMetrics = await this.calculateRevenueMetrics(retailerId, timeFilter);
        
        const [
            totalProducts,
            lowStockItems,
            outOfStockItems,
            recentActivity,
            completedOrdersCount
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
            // ✅ FIXED: Proper Order model usage
            Order.countDocuments({ 
                assignedRetailer: retailerId,
                orderStatus: { $in: ['delivered', 'completed'] }
            })
        ]);

        // Calculate inventory value
        const inventoryItems = await RetailerInventory.find({ 
            retailer: retailerId, 
            isActive: true 
        });
        
        let totalInventoryValue = 0;
        inventoryItems.forEach(item => {
            totalInventoryValue += (item.currentStock || 0) * (item.sellingPrice || 0);
        });

        return {
            totalProducts,
            lowStockItems,
            outOfStockItems,
            recentActivity,
            totalCompletedOrders: completedOrdersCount,
            totalInventoryValue: Math.round(totalInventoryValue * 100) / 100,
            totalSales: revenueMetrics.totalSales,
            totalRevenue: revenueMetrics.totalRevenue,
            totalItemsSold: revenueMetrics.totalItemsSold,
            profitMargin: revenueMetrics.profitMargin,
            averageOrderValue: revenueMetrics.averageOrderValue,
            timestamp: new Date(),
            timePeriod: {
                filter: timeFilter,
                ...this.getDateRange(timeFilter)
            }
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

    /**
     * Update pricing slabs for an inventory item
     */
    async updatePricingSlabs(inventoryId, retailerId, pricingSlabs, userId) {
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

            // Validate pricing slabs
            this.validatePricingSlabs(pricingSlabs);

            // Update pricing slabs
            inventoryItem.pricingSlabs = pricingSlabs;
            inventoryItem.enableQuantityPricing = pricingSlabs.length > 0;
            inventoryItem.updatedBy = userId;

            await inventoryItem.save({ session });
            savedInventoryItemId = inventoryItem._id;

            // Create log for pricing changes
            const inventoryLog = new InventoryLog({
                retailer: retailerId,
                product: inventoryItem.product,
                inventoryItem: inventoryItem._id,
                transactionType: 'STOCK_ADJUSTMENT',
                quantity: 0,
                previousStock: inventoryItem.currentStock,
                newStock: inventoryItem.currentStock,
                reason: 'PRICING_UPDATE',
                notes: `Quantity-based pricing slabs updated - ${pricingSlabs.length} slabs configured`,
                createdBy: userId
            });
            await inventoryLog.save({ session });

            await session.commitTransaction();

            // Get updated inventory item
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
     * Validate pricing slabs
     */
    validatePricingSlabs(pricingSlabs) {
        if (!Array.isArray(pricingSlabs)) {
            throw new Error('Pricing slabs must be an array');
        }

        // Check for overlapping ranges and validate each slab
        const sortedSlabs = [...pricingSlabs].sort((a, b) => a.minQuantity - b.minQuantity);
        
        for (let i = 0; i < sortedSlabs.length; i++) {
            const slab = sortedSlabs[i];
            
            // Validate individual slab
            if (slab.minQuantity < 0) {
                throw new Error(`Slab ${i + 1}: minQuantity cannot be negative`);
            }
            if (slab.maxQuantity <= slab.minQuantity) {
                throw new Error(`Slab ${i + 1}: maxQuantity must be greater than minQuantity`);
            }
            if (slab.discountValue < 0) {
                throw new Error(`Slab ${i + 1}: discountValue cannot be negative`);
            }
            if (!['FLAT', 'PERCENTAGE'].includes(slab.discountType)) {
                throw new Error(`Slab ${i + 1}: discountType must be FLAT or PERCENTAGE`);
            }
            if (slab.discountType === 'PERCENTAGE' && slab.discountValue > 100) {
                throw new Error(`Slab ${i + 1}: percentage discount cannot exceed 100%`);
            }

            // Check for overlaps with next slab
            if (i < sortedSlabs.length - 1) {
                const nextSlab = sortedSlabs[i + 1];
                if (slab.maxQuantity >= nextSlab.minQuantity) {
                    throw new Error(`Slab ${i + 1} and ${i + 2} have overlapping quantity ranges`);
                }
            }
        }
    }

    /**
     * Calculate per-piece pricing for order items
     */
    async calculateOrderPricing(retailerId, orderItems) {
        try {
            const pricedItems = [];

            for (const item of orderItems) {
                const priceInfo = await this.calculatePriceForQuantity(
                    retailerId,
                    item.productId,
                    item.quantity
                );

                pricedItems.push({
                    ...item,
                    pricing: priceInfo,
                    finalPrice: priceInfo.finalPrice,
                    unitPrice: priceInfo.finalUnitPrice
                });
            }

            // Calculate order totals
            const orderTotal = pricedItems.reduce((sum, item) => sum + item.finalPrice, 0);
            const totalDiscount = pricedItems.reduce((sum, item) => sum + item.pricing.appliedDiscount * item.quantity, 0);
            const baseTotal = pricedItems.reduce((sum, item) => sum + item.pricing.baseTotal, 0);

            return {
                items: pricedItems,
                summary: {
                    baseTotal: Math.round(baseTotal * 100) / 100,
                    finalTotal: Math.round(orderTotal * 100) / 100,
                    totalDiscount: Math.round(totalDiscount * 100) / 100,
                    totalSavings: Math.round((baseTotal - orderTotal) * 100) / 100,
                    savingsPercentage: baseTotal > 0 ? 
                        Math.round(((baseTotal - orderTotal) / baseTotal) * 100 * 100) / 100 : 0
                }
            };
        } catch (error) {
            console.error('Calculate order pricing error:', error);
            throw error;
        }
    }

    /**
     * Bulk calculate prices for multiple products
     */
    async bulkCalculatePrices(retailerId, items) {
        try {
            const results = [];

            for (const item of items) {
                try {
                    const priceInfo = await this.calculatePriceForQuantity(
                        retailerId, 
                        item.productId, 
                        item.quantity
                    );
                    results.push({
                        ...item,
                        success: true,
                        priceInfo
                    });
                } catch (error) {
                    results.push({
                        ...item,
                        success: false,
                        error: error.message
                    });
                }
            }

            return {
                success: true,
                results,
                timestamp: new Date()
            };
        } catch (error) {
            console.error('Bulk calculate prices error:', error);
            throw error;
        }
    }
}

// ✅ IMPORTANT: Export as default instance
export default new InventoryService();