import mongoose from 'mongoose';
import Customer from '../models/customer.model.js';
import Order from '../models/order.model.js';
import Product from '../models/product.model.js';
import Admin from '../models/admin.model.js';
import RetailerInventory from '../models/retailerInventory.model.js';
import { getClosestRetailer, validateCoordinates, calculateDistance } from '../utils/locationUtils.js';
import inventoryService from '../services/inventory.service.js';

// Generate unique order ID
const generateOrderId = () => {
  return 'ORD' + Date.now() + Math.floor(Math.random() * 1000);
};

// Helper function to find order by ID
const findOrderById = async (orderIdentifier) => {
  if (!orderIdentifier) return null;
  if (typeof orderIdentifier === 'string' && orderIdentifier.startsWith('ORD')) {
    return await Order.findOne({ orderId: orderIdentifier });
  } else {
    return await Order.findById(orderIdentifier);
  }
};

// Enhanced pricing calculation for order items
const calculateOrderItemPricing = (product, inventoryItem, quantity) => {
  const basePrice = inventoryItem?.sellingPrice || product.price || 0;
  let currentPrice = basePrice;
  let hasDiscount = false;
  let discountPercentage = 0;
  let savings = 0;
  let currentAppliedSlab = null;
  let isExtendedRange = false;

  // Get active pricing slabs
  if (inventoryItem?.enableQuantityPricing && inventoryItem.pricingSlabs) {
    const activeSlabs = inventoryItem.pricingSlabs
      .filter(slab => slab.isActive)
      .sort((a, b) => a.minQuantity - b.minQuantity);

    if (activeSlabs.length > 0) {
      // Find applicable slab - with extended range logic
      let applicableSlab = activeSlabs.find(slab => 
        quantity >= slab.minQuantity && quantity <= slab.maxQuantity
      );

      // EXTENDED RANGE LOGIC: Use last slab if quantity exceeds all ranges
      if (!applicableSlab && quantity > 0) {
        applicableSlab = activeSlabs[activeSlabs.length - 1];
        isExtendedRange = quantity >= applicableSlab.minQuantity;
        
        // Only apply extended range if quantity meets the last slab's minimum
        if (!isExtendedRange) {
          applicableSlab = null;
        }
      }

      if (applicableSlab) {
        currentAppliedSlab = applicableSlab;
        
        // Calculate discounted price
        if (applicableSlab.discountType === 'FLAT') {
          currentPrice = Math.max(0, basePrice - applicableSlab.discountValue);
        } else if (applicableSlab.discountType === 'PERCENTAGE') {
          const discountAmount = (basePrice * applicableSlab.discountValue) / 100;
          currentPrice = Math.max(0, basePrice - discountAmount);
        }
        
        hasDiscount = currentPrice < basePrice;
        discountPercentage = applicableSlab.discountType === 'PERCENTAGE' 
          ? applicableSlab.discountValue 
          : Math.round(((basePrice - currentPrice) / basePrice) * 100);
        savings = (basePrice - currentPrice) * quantity;
      }
    }
  }

  return {
    basePrice: Math.round(basePrice * 100) / 100,
    currentPrice: Math.round(currentPrice * 100) / 100,
    hasDiscount,
    discountPercentage: Math.round(discountPercentage * 100) / 100,
    savings: Math.round(savings * 100) / 100,
    currentAppliedSlab,
    totalQuantity: quantity,
    isExtendedRange,
    itemTotal: Math.round(currentPrice * quantity * 100) / 100,
    baseTotal: Math.round(basePrice * quantity * 100) / 100
  };
};

// Helper function to get retailer's inventory prices
const getRetailerInventoryPrices = async (retailerId) => {
  try {
    console.log(`💰 Fetching inventory for retailer: ${retailerId}`);
    
    const inventoryItems = await RetailerInventory.find({
      retailer: retailerId,
      isActive: true
    })
    .populate('product', 'name sku price unit')
    .lean();

    console.log(`📦 Retrieved ${inventoryItems.length} inventory items directly from DB`);
    
    const formattedInventory = inventoryItems.map(item => ({
      _id: item._id,
      product: {
        _id: item.product?._id,
        name: item.product?.name,
        sku: item.product?.sku,
        price: item.product?.price,
        unit: item.product?.unit
      },
      sellingPrice: item.sellingPrice,
      currentStock: item.currentStock,
      committedStock: item.committedStock,
      enableQuantityPricing: item.enableQuantityPricing,
      pricingSlabs: item.pricingSlabs || []
    }));

    return formattedInventory;
  } catch (error) {
    console.log('❌ Error fetching retailer inventory:', error.message);
    return [];
  }
};

// @desc    Create new order WITH COMPLETE DISCOUNT CALCULATION
// @route   POST /api/orders
// @access  Private
export const createOrder = async (req, res) => {
  const session = await mongoose.startSession();
  
  try {
    session.startTransaction();

    const userId = req.user._id;
    const { 
      items, 
      deliveryAddress, 
      deliveryTime, 
      paymentMethod, 
      specialInstructions 
    } = req.body;

    // Get customer profile
    const customer = await Customer.findOne({ user: userId });
    if (!customer) {
      await session.abortTransaction();
      return res.status(404).json({
        success: false,
        message: 'Customer profile not found. Please complete your profile first.'
      });
    }

    // Find the closest retailer for order assignment
    let assignedRetailer = null;
    let assignmentDetails = null;
    
    const addressToUse = deliveryAddress || customer.deliveryAddress;
    
    if (!addressToUse) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: 'Delivery address is required.'
      });
    }

    let customerLocation = addressToUse.coordinates;
    
    if (!customerLocation || !customerLocation.latitude || !customerLocation.longitude) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: 'Delivery address coordinates are required.'
      });
    }

    // Validate customer coordinates
    if (!validateCoordinates(customerLocation.latitude, customerLocation.longitude)) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: 'Invalid delivery address coordinates'
      });
    }

    // Get all active retailers
    const retailers = await Admin.find({ isActive: true });
    
    if (retailers.length === 0) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: 'No active retailers available at the moment'
      });
    }

    // Find the closest retailer within service radius
    const closestRetailerInfo = getClosestRetailer(
      customerLocation.latitude,
      customerLocation.longitude,
      retailers,
      100
    );
    
    if (closestRetailerInfo && closestRetailerInfo.retailer) {
      assignedRetailer = closestRetailerInfo.retailer._id;
      assignmentDetails = {
        distance: closestRetailerInfo.distance,
        retailerName: closestRetailerInfo.retailer.fullName,
        retailerShop: closestRetailerInfo.retailer.shopName,
        serviceRadius: closestRetailerInfo.retailer.serviceRadius
      };
      
      console.log(`📍 Order assigned to retailer: ${closestRetailerInfo.retailer.shopName} (${closestRetailerInfo.distance}km away)`);
    } else {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: 'No retailer available within your delivery area.'
      });
    }

    // Get retailer's inventory prices
    console.log('💰 Fetching retailer inventory prices for order...');
    const inventoryItems = await getRetailerInventoryPrices(assignedRetailer);
    console.log(`📦 Retrieved ${inventoryItems.length} inventory items for retailer`);

    // Process order items with COMPLETE DISCOUNT CALCULATION
    let totalAmount = 0;
    let totalBaseAmount = 0;
    let totalDiscount = 0;
    const orderItems = [];

    for (const item of items) {
      const product = await Product.findById(item.productId);
      if (!product) {
        await session.abortTransaction();
        return res.status(400).json({
          success: false,
          message: `Product not found: ${item.productId}`
        });
      }

      if (!product.isAvailable) {
        await session.abortTransaction();
        return res.status(400).json({
          success: false,
          message: `Product not available: ${product.name}`
        });
      }

      // Find this product in retailer's inventory
      const inventoryItem = inventoryItems.find(inv => {
        const inventoryProductId = inv.product?._id ? inv.product._id.toString() : inv.product?.toString();
        const itemProductId = item.productId.toString();
        return inventoryProductId === itemProductId;
      });

      // Calculate pricing with discounts
      const pricing = calculateOrderItemPricing(product, inventoryItem, item.quantity);

      let finalPrice = pricing.currentPrice;
      let isPriceOverridden = false;
      
      if (inventoryItem && inventoryItem.sellingPrice > 0) {
        finalPrice = pricing.currentPrice; // Use discounted price
        isPriceOverridden = finalPrice !== product.price;
        console.log(`💰 Price for ${product.name}: Base ₹${product.price} → Final ₹${finalPrice} (Discount: ₹${pricing.savings})`);
      } else {
        console.log(`💰 Using catalog price for ${product.name}: ₹${finalPrice}`);
      }

      const itemTotal = pricing.itemTotal;
      totalAmount += itemTotal;
      totalBaseAmount += pricing.baseTotal;
      totalDiscount += pricing.savings;

      orderItems.push({
        product: product._id,
        quantity: item.quantity,
        price: finalPrice,
        originalPrice: product.price,
        isPriceOverridden: isPriceOverridden,
        priceSource: isPriceOverridden ? 'retailer_inventory' : 'catalog',
        unit: product.unit,
        reservedQuantity: 0,
        isReserved: false,
        // DISCOUNT DETAILS - Store complete pricing information
        discountDetails: {
          basePrice: pricing.basePrice,
          currentPrice: pricing.currentPrice,
          hasDiscount: pricing.hasDiscount,
          discountPercentage: pricing.discountPercentage,
          savings: pricing.savings,
          itemTotal: pricing.itemTotal,
          baseTotal: pricing.baseTotal,
          isExtendedRange: pricing.isExtendedRange,
          appliedSlab: pricing.currentAppliedSlab
        }
      });
    }

    console.log(`🧮 Order totals - Base: ₹${totalBaseAmount}, Discount: ₹${totalDiscount}, Final: ₹${totalAmount}`);
    console.log(`📊 Price sources: ${orderItems.filter(item => item.isPriceOverridden).length} overridden, ${orderItems.filter(item => !item.isPriceOverridden).length} catalog`);

    // Check retailer inventory availability
    const stockCheck = await inventoryService.checkStockAvailability(assignedRetailer, items);
    if (!stockCheck.allAvailable) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: 'Currently Some Stocks are not Available at your Location, Try different Location',
        stockDetails: stockCheck.items,
        retailer: assignmentDetails.retailerShop
      });
    }

    // Create order with discount summary
    const order = new Order({
      orderId: generateOrderId(),
      customer: customer._id,
      items: orderItems,
      totalAmount: totalBaseAmount, // Total before discounts
      finalAmount: totalAmount, // Total after discounts
      discount: totalDiscount, // Total discount amount
      deliveryAddress: addressToUse,
      deliveryTime: deliveryTime || customer.preferences?.deliveryTime,
      paymentMethod: paymentMethod || 'cash',
      specialInstructions,
      deliveryDate: new Date(Date.now() + 24 * 60 * 60 * 1000),
      assignedRetailer,
      assignmentDetails,
      reservationStatus: 'not_reserved',
      orderStatus: 'pending',
      priceSource: orderItems.some(item => item.isPriceOverridden) ? 'retailer_inventory' : 'catalog',
      // DISCOUNT SUMMARY - Store overall discount information
      discountSummary: {
        totalDiscount: totalDiscount,
        totalBaseAmount: totalBaseAmount,
        finalAmount: totalAmount,
        savingsPercentage: totalBaseAmount > 0 ? Math.round((totalDiscount / totalBaseAmount) * 100 * 100) / 100 : 0,
        itemsWithDiscount: orderItems.filter(item => item.discountDetails.hasDiscount).length,
        totalItems: orderItems.length
      }
    });

    await order.save({ session });

    // Reserve stock in retailer inventory
    try {
      const reservationResult = await inventoryService.reserveStockForOrder(
        order._id,
        assignedRetailer,
        items,
        req.user._id
      );

      // Update order with reservation status
      order.reservationStatus = 'reserved';
      order.reservationDate = new Date();
      
      // Update order items with reservation info
      order.items.forEach((item, index) => {
        item.reservedQuantity = items[index].quantity;
        item.isReserved = true;
      });

      await order.save({ session });
      await session.commitTransaction();

      // Populate order for response
      await order.populate('items.product', 'name image unit');
      await order.populate('assignedRetailer', 'shopName fullName contactNumber');

      console.log(`✅ Online order created successfully with discounts`);
      console.log(`💰 Final order breakdown:`);
      order.items.forEach(item => {
        console.log(`   ${item.product.name}: ${item.quantity} × ₹${item.price} = ₹${item.quantity * item.price} (Saved: ₹${item.discountDetails.savings})`);
      });

      res.status(201).json({
        success: true,
        message: 'Order created successfully and stock reserved',
        order: {
          _id: order._id,
          orderId: order.orderId,
          totalAmount: order.totalAmount,
          finalAmount: order.finalAmount,
          discount: order.discount,
          orderStatus: order.orderStatus,
          reservationStatus: order.reservationStatus,
          assignedRetailer: order.assignedRetailer,
          items: order.items.map(item => ({
            product: {
              _id: item.product._id,
              name: item.product.name,
              image: item.product.image,
              unit: item.product.unit
            },
            quantity: item.quantity,
            price: item.price,
            originalPrice: item.originalPrice,
            isPriceOverridden: item.isPriceOverridden,
            priceSource: item.priceSource,
            unit: item.unit,
            itemTotal: item.quantity * item.price,
            // Include discount details in response
            discountDetails: item.discountDetails
          })),
          priceSource: order.priceSource,
          discountSummary: order.discountSummary
        },
        reservationDetails: {
          reservedItems: reservationResult.reservedItems.length,
          message: reservationResult.message
        }
      });

    } catch (reservationError) {
      await Order.findByIdAndDelete(order._id).session(session);
      await session.abortTransaction();
      
      console.error('❌ Stock reservation failed:', reservationError);
      
      res.status(400).json({
        success: false,
        message: 'Order creation failed: Could not reserve stock. ' + reservationError.message
      });
    }

  } catch (error) {
    await session.abortTransaction();
    console.error('❌ Create Order Error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while creating order',
      error: error.message
    });
  } finally {
    session.endSession();
  }
};

// In your order controller - Enhanced offline order creation
// @desc    Create offline order WITH COMPLETE DISCOUNT CALCULATION
// @route   POST /api/orders/offline
// @access  Private/Retailer
export const createOfflineOrder = async (req, res) => {
  const session = await mongoose.startSession();

  try {
    session.startTransaction();

    const retailerId = req.user._id;
    const {
      items,
      paymentMethod,
      specialInstructions,
      customerName,
      customerPhone,
      total,
      subtotal,
      discount
    } = req.body;

    // Verify retailer exists and is active
    const retailer = await Admin.findOne({ user: retailerId, isActive: true });
    if (!retailer) {
      await session.abortTransaction();
      return res.status(404).json({
        success: false,
        message: 'Retailer profile not found or inactive'
      });
    }

    // Get retailer's inventory
    console.log('💰 Fetching retailer inventory for offline order...');
    const inventoryItems = await getRetailerInventoryPrices(retailer._id);
    console.log(`📦 Retrieved ${inventoryItems.length} inventory items for offline order`);

    // Validate items and calculate total with DISCOUNT CALCULATION
    let calculatedTotal = 0;
    let calculatedSubtotal = 0;
    let calculatedDiscount = 0;
    const orderItems = [];

    for (const item of items) {
      const product = await Product.findById(item.productId);
      if (!product) {
        await session.abortTransaction();
        return res.status(400).json({
          success: false,
          message: `Product not found: ${item.productId}`
        });
      }

      if (!product.isAvailable) {
        await session.abortTransaction();
        return res.status(400).json({
          success: false,
          message: `Product not available: ${product.name}`
        });
      }

      // Find this product in retailer's inventory
      const inventoryItem = inventoryItems.find(inv => {
        const inventoryProductId = inv.product?._id ? inv.product._id.toString() : inv.product?.toString();
        const itemProductId = item.productId.toString();
        return inventoryProductId === itemProductId;
      });

      // Calculate pricing with discounts - USING THE SAME LOGIC
      const pricing = calculateOrderItemPricing(product, inventoryItem, item.quantity);

      let finalPrice = pricing.currentPrice;
      let isPriceOverridden = false;

      if (inventoryItem && inventoryItem.sellingPrice > 0) {
        finalPrice = pricing.currentPrice;
        isPriceOverridden = finalPrice !== product.price;
        console.log(`💰 Price for ${product.name}: Base ₹${product.price} → Final ₹${finalPrice} (Discount: ₹${pricing.savings})`);
      } else {
        console.log(`💰 Using catalog price for ${product.name}: ₹${finalPrice}`);
      }

      const itemTotal = pricing.itemTotal;
      calculatedTotal += itemTotal;
      calculatedSubtotal += pricing.baseTotal;
      calculatedDiscount += pricing.savings;

      orderItems.push({
        product: product._id,
        quantity: item.quantity,
        price: finalPrice,
        originalPrice: product.price,
        isPriceOverridden: isPriceOverridden,
        priceSource: isPriceOverridden ? 'retailer_inventory' : 'catalog',
        unit: product.unit,
        reservedQuantity: 0,
        isReserved: false,
        productName: product.name,
        barcodeId: item.barcodeId,
        scannedBarcodeId: item.scannedBarcodeId,
        // COMPLETE DISCOUNT DETAILS - SAME AS ONLINE ORDERS
        discountDetails: {
          basePrice: pricing.basePrice,
          currentPrice: pricing.currentPrice,
          hasDiscount: pricing.hasDiscount,
          discountPercentage: pricing.discountPercentage,
          savings: pricing.savings,
          itemTotal: pricing.itemTotal,
          baseTotal: pricing.baseTotal,
          isExtendedRange: pricing.isExtendedRange,
          appliedSlab: pricing.currentAppliedSlab,
          singlePieceDiscount: pricing.singlePieceDiscount
        }
      });
    }

    // Use provided totals or calculate our own
    const finalTotal = total || calculatedTotal;
    const finalSubtotal = subtotal || calculatedSubtotal;
    const finalDiscount = discount || calculatedDiscount;

    console.log('🧮 Offline order totals:', {
      calculatedTotal,
      calculatedSubtotal,
      calculatedDiscount,
      providedTotal: total,
      providedSubtotal: subtotal,
      finalTotal,
      finalSubtotal,
      finalDiscount
    });

    // Check retailer inventory availability
    const stockCheck = await inventoryService.checkStockAvailability(retailer._id, items);
    if (!stockCheck.allAvailable) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: 'Some items are out of stock',
        stockDetails: stockCheck.items
      });
    }

    // Create offline order with discount summary
    const order = new Order({
      orderId: generateOrderId(),
      items: orderItems,
      totalAmount: finalSubtotal,
      finalAmount: finalTotal,
      discount: finalDiscount,
      paymentMethod: paymentMethod || 'cash',
      paymentStatus: 'paid',
      specialInstructions,
      orderType: 'offline',
      processedBy: retailer._id,
      assignedRetailer: retailer._id,
      assignmentDetails: {
        assignedAt: new Date(),
        distance: 0,
        retailerName: retailer.fullName,
        retailerShop: retailer.shopName,
        serviceRadius: retailer.serviceRadius
      },
      reservationStatus: 'not_reserved',
      orderStatus: 'delivered',
      deliveryDate: new Date(),
      customerName,
      customerPhone,
      priceSource: orderItems.some(item => item.isPriceOverridden) ? 'retailer_inventory' : 'catalog',
      // COMPLETE DISCOUNT SUMMARY
      discountSummary: {
        totalDiscount: finalDiscount,
        totalBaseAmount: finalSubtotal,
        finalAmount: finalTotal,
        savingsPercentage: finalSubtotal > 0 ? Math.round((finalDiscount / finalSubtotal) * 100 * 100) / 100 : 0,
        itemsWithDiscount: orderItems.filter(item => item.discountDetails.hasDiscount).length,
        totalItems: orderItems.length,
        extendedRangeItems: orderItems.filter(item => item.discountDetails.isExtendedRange).length
      },
      createdAt: new Date(),
      updatedAt: new Date()
    });

    await order.save({ session });

    // Reserve stock for offline order
    try {
      const reservationResult = await inventoryService.reserveStockForOrder(
        order._id,
        retailer._id,
        items.map(item => ({
          productId: item.productId,
          quantity: item.quantity
        })),
        req.user._id
      );

      // Update order with reservation status
      order.reservationStatus = 'reserved';
      order.reservationDate = new Date();

      // Update order items with reservation info
      order.items.forEach((item, index) => {
        item.reservedQuantity = items[index].quantity;
        item.isReserved = true;
      });

      await order.save({ session });

      // Immediately mark as delivered and deduct stock
      const deliveryResult = await inventoryService.confirmOrderDelivery(
        order._id,
        retailer._id,
        req.user._id
      );

      order.reservationStatus = 'delivered';
      order.deliveredAt = new Date();
      await order.save({ session });

      await session.commitTransaction();

      // Populate order for response
      await order.populate('items.product', 'name image unit');

      console.log('✅ Offline order created successfully with discounts');
      console.log(`💰 Final offline order breakdown:`);
      order.items.forEach(item => {
        console.log(`   ${item.product.name}: ${item.quantity} × ₹${item.price} = ₹${item.quantity * item.price} (Saved: ₹${item.discountDetails.savings})`);
      });

      res.status(201).json({
        success: true,
        message: 'Offline order created and completed successfully',
        order: {
          _id: order._id,
          orderId: order.orderId,
          totalAmount: order.totalAmount,
          finalAmount: order.finalAmount,
          discount: order.discount,
          orderStatus: order.orderStatus,
          reservationStatus: order.reservationStatus,
          orderType: order.orderType,
          items: order.items.map(item => ({
            product: {
              _id: item.product._id,
              name: item.product.name,
              image: item.product.image,
              unit: item.product.unit
            },
            quantity: item.quantity,
            price: item.price,
            originalPrice: item.originalPrice,
            isPriceOverridden: item.isPriceOverridden,
            priceSource: item.priceSource,
            unit: item.unit,
            productName: item.productName,
            itemTotal: item.quantity * item.price,
            // Include complete discount details
            discountDetails: item.discountDetails
          })),
          customerName: order.customerName,
          customerPhone: order.customerPhone,
          processedBy: {
            retailerName: retailer.fullName,
            shopName: retailer.shopName
          },
          priceSource: order.priceSource,
          discountSummary: order.discountSummary
        },
        inventoryUpdate: {
          reserved: reservationResult.reservedItems.length,
          delivered: deliveryResult.deliveredItems?.length || 0
        }
      });

    } catch (reservationError) {
      await Order.findByIdAndDelete(order._id).session(session);
      await session.abortTransaction();

      console.error('❌ Stock reservation failed for offline order:', reservationError);

      res.status(400).json({
        success: false,
        message: 'Order creation failed: Could not reserve stock. ' + reservationError.message
      });
    }

  } catch (error) {
    await session.abortTransaction();
    console.error('❌ Create Offline Order Error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while creating offline order',
      error: error.message
    });
  } finally {
    session.endSession();
  }
};

// @desc    Get customer orders WITH DISCOUNT DETAILS
// @route   GET /api/orders
// @access  Private
export const getCustomerOrders = async (req, res) => {
  try {
    const userId = req.user._id;
    const { page = 1, limit = 10, status } = req.query;

    const customer = await Customer.findOne({ user: userId });
    if (!customer) {
      return res.status(404).json({
        success: false,
        message: 'Customer profile not found'
      });
    }

    const filter = { customer: customer._id };
    if (status && status !== 'all') {
      filter.orderStatus = status;
    }

    const orders = await Order.find(filter)
      .populate('items.product', 'name image unit price')
      .populate('assignedRetailer', 'shopName fullName contactNumber')
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    // Process orders to include discount details
    const processedOrders = orders.map(order => ({
      ...order.toObject(),
      items: order.items.map(item => ({
        ...item.toObject(),
        displayPrice: item.price,
        finalPrice: item.price,
        isPriceOverridden: item.isPriceOverridden || false,
        originalPrice: item.originalPrice || item.product?.price || 0,
        // Ensure discount details are included
        discountDetails: item.discountDetails || {
          basePrice: item.originalPrice || item.product?.price || 0,
          currentPrice: item.price,
          hasDiscount: false,
          discountPercentage: 0,
          savings: 0,
          itemTotal: item.quantity * item.price,
          baseTotal: (item.originalPrice || item.product?.price || 0) * item.quantity,
          isExtendedRange: false,
          appliedSlab: null
        }
      }))
    }));

    const total = await Order.countDocuments(filter);

    res.status(200).json({
      success: true,
      orders: processedOrders,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(total / limit),
        totalOrders: total
      }
    });
  } catch (error) {
    console.error('Get Orders Error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

// @desc    Get single order details WITH DISCOUNT DETAILS
// @route   GET /api/orders/:id
// @access  Private
export const getOrderById = async (req, res) => {
  try {
    const userId = req.user._id;
    const orderIdentifier = req.params.id;

    let order = await findOrderById(orderIdentifier);

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    // If user is customer, check if they own this order
    if (req.user.role === 'customer') {
      const customer = await Customer.findOne({ user: userId });
      if (!customer) {
        return res.status(404).json({
          success: false,
          message: 'Customer profile not found'
        });
      }
      
      if (order.customer.toString() !== customer._id.toString()) {
        return res.status(403).json({
          success: false,
          message: 'Access denied. You can only view your own orders.'
        });
      }
    }

    // Populate order details
    await order.populate('items.product', 'name image unit milkType');
    await order.populate('customer', 'personalInfo.fullName');
    await order.populate('assignedRetailer', 'shopName fullName contactNumber address');

    // Ensure discount details are properly formatted
    const processedOrder = {
      ...order.toObject(),
      items: order.items.map(item => ({
        ...item.toObject(),
        discountDetails: item.discountDetails || {
          basePrice: item.originalPrice || item.product?.price || 0,
          currentPrice: item.price,
          hasDiscount: false,
          discountPercentage: 0,
          savings: 0,
          itemTotal: item.quantity * item.price,
          baseTotal: (item.originalPrice || item.product?.price || 0) * item.quantity,
          isExtendedRange: false,
          appliedSlab: null
        }
      }))
    };

    res.status(200).json({
      success: true,
      order: processedOrder
    });
  } catch (error) {
    console.error('Get Order Error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

// @desc    Calculate order pricing with discounts (for cart preview)
// @route   POST /api/orders/calculate-pricing
// @access  Private
export const calculateOrderPricing = async (req, res) => {
  try {
    const userId = req.user._id;
    const { items } = req.body;

    const customer = await Customer.findOne({ user: userId });
    if (!customer) {
      return res.status(404).json({
        success: false,
        message: 'Customer profile not found'
      });
    }

    // Find the closest retailer (similar to createOrder)
    const addressToUse = customer.deliveryAddress;
    if (!addressToUse?.coordinates) {
      return res.status(400).json({
        success: false,
        message: 'Delivery address is required for pricing calculation'
      });
    }

    const retailers = await Admin.find({ isActive: true });
    const closestRetailerInfo = getClosestRetailer(
      addressToUse.coordinates.latitude,
      addressToUse.coordinates.longitude,
      retailers,
      100
    );

    if (!closestRetailerInfo) {
      return res.status(400).json({
        success: false,
        message: 'No retailer available in your area'
      });
    }

    const assignedRetailer = closestRetailerInfo.retailer._id;

    // Get retailer inventory
    const inventoryItems = await getRetailerInventoryPrices(assignedRetailer);

    // Calculate pricing for each item
    let totalBaseAmount = 0;
    let totalFinalAmount = 0;
    let totalDiscount = 0;
    const pricedItems = [];

    for (const item of items) {
      const product = await Product.findById(item.productId);
      if (!product) continue;

      const inventoryItem = inventoryItems.find(inv => {
        const inventoryProductId = inv.product?._id ? inv.product._id.toString() : inv.product?.toString();
        return inventoryProductId === item.productId.toString();
      });

      const pricing = calculateOrderItemPricing(product, inventoryItem, item.quantity);

      pricedItems.push({
        productId: item.productId,
        productName: product.name,
        quantity: item.quantity,
        unit: product.unit,
        pricing: pricing
      });

      totalBaseAmount += pricing.baseTotal;
      totalFinalAmount += pricing.itemTotal;
      totalDiscount += pricing.savings;
    }

    res.status(200).json({
      success: true,
      data: {
        items: pricedItems,
        summary: {
          totalBaseAmount: Math.round(totalBaseAmount * 100) / 100,
          totalFinalAmount: Math.round(totalFinalAmount * 100) / 100,
          totalDiscount: Math.round(totalDiscount * 100) / 100,
          savingsPercentage: totalBaseAmount > 0 ? Math.round((totalDiscount / totalBaseAmount) * 100 * 100) / 100 : 0,
          retailer: {
            name: closestRetailerInfo.retailer.shopName,
            distance: closestRetailerInfo.distance
          }
        }
      }
    });

  } catch (error) {
    console.error('Calculate pricing error:', error);
    res.status(500).json({
      success: false,
      message: 'Error calculating order pricing',
      error: error.message
    });
  }
};

// The rest of your existing functions remain the same (cancelOrder, updateOrderStatus, etc.)
// ... [Keep all your existing functions like cancelOrder, updateOrderStatus, getRetailerOrders, etc.]

// @desc    Cancel order AND RELEASE RESERVED STOCK
// @route   PUT /api/orders/:id/cancel
// @access  Private
export const cancelOrder = async (req, res) => {
  try {
    const userId = req.user._id;
    const orderIdentifier = req.params.id;
    const { reason = 'Customer cancellation' } = req.body;

    const customer = await Customer.findOne({ user: userId });
    if (!customer) {
      return res.status(404).json({
        success: false,
        message: 'Customer profile not found'
      });
    }

    const order = await findOrderById(orderIdentifier);

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    if (order.customer.toString() !== customer._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. You can only cancel your own orders.'
      });
    }

    if (!['pending', 'confirmed'].includes(order.orderStatus)) {
      return res.status(400).json({
        success: false,
        message: `Cannot cancel order in ${order.orderStatus} status`
      });
    }

    let stockReleaseResult = null;
    if (order.reservationStatus === 'reserved') {
      stockReleaseResult = await inventoryService.cancelOrderReservation(
        order._id,
        order.assignedRetailer,
        req.user._id,
        reason
      );
    }

    order.orderStatus = 'cancelled';
    order.reservationStatus = 'released';
    order.releaseDate = new Date();
    order.cancellationReason = reason;
    await order.save();

    res.status(200).json({
      success: true,
      message: 'Order cancelled successfully and reserved stock released',
      order: {
        _id: order._id,
        orderId: order.orderId,
        orderStatus: order.orderStatus,
        reservationStatus: order.reservationStatus
      },
      stockReleased: stockReleaseResult
    });
  } catch (error) {
    console.error('Cancel Order Error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

// @desc    Update order status WITH INVENTORY HANDLING
// @route   PUT /api/orders/:id/status
// @access  Private/Admin/Retailer
export const updateOrderStatus = async (req, res) => {
  try {
    const { status } = req.body;
    const orderIdentifier = req.params.id;

    const validStatuses = ['pending', 'confirmed', 'preparing', 'out_for_delivery', 'delivered', 'cancelled'];

    console.log('Update Order Status Request:', { orderIdentifier, status, user: req.user });

    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid order status'
      });
    }

    const order = await findOrderById(orderIdentifier);

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    if (req.user.role === 'retailer') {
      const retailer = await Admin.findOne({ user: req.user._id });
      if (!retailer) {
        return res.status(404).json({
          success: false,
          message: 'Retailer profile not found'
        });
      }

      if (!order.assignedRetailer || order.assignedRetailer.toString() !== retailer._id.toString()) {
        return res.status(403).json({
          success: false,
          message: 'Access denied. This order is not assigned to you.'
        });
      }
    }

    if (status === 'delivered' && order.orderStatus !== 'delivered') {
      if (order.reservationStatus === 'reserved') {
        try {
          const deliveryResult = await inventoryService.confirmOrderDelivery(
            order._id,
            order.assignedRetailer,
            req.user._id
          );
          console.log('Stock deducted on delivery:', deliveryResult);
          order.reservationStatus = 'delivered';
        } catch (deliveryError) {
          console.error('Failed to deduct stock on delivery:', deliveryError);
          return res.status(400).json({
            success: false,
            message: 'Failed to update inventory: ' + deliveryError.message
          });
        }
      }
    }

    if (status === 'cancelled' && order.orderStatus !== 'cancelled') {
      if (order.reservationStatus === 'reserved') {
        try {
          const releaseResult = await inventoryService.cancelOrderReservation(
            order._id,
            order.assignedRetailer,
            req.user._id,
            'Status update cancellation'
          );
          console.log('Stock released on cancellation:', releaseResult);
          order.reservationStatus = 'released';
        } catch (releaseError) {
          console.error('Failed to release stock on cancellation:', releaseError);
        }
      }
    }

    order.orderStatus = status;
    
    if (status === 'delivered') {
      order.deliveredAt = new Date();
    }

    await order.save();

    await order.populate('items.product', 'name image unit');
    await order.populate('customer', 'personalInfo.fullName');
    await order.populate('assignedRetailer', 'shopName fullName contactNumber');

    console.log('Order status updated successfully to:', status);

    res.status(200).json({
      success: true,
      message: 'Order status updated successfully',
      order
    });
  } catch (error) {
    console.error('Update Order Status Error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

// ... [Keep all other existing functions as they are]


// @desc    Get retailer's assigned orders
// @route   GET /api/orders/retailer/my-orders
// @access  Private/Retailer
export const getRetailerOrders = async (req, res) => {
  try {
    const userId = req.user._id;
    const { page = 1, limit = 10, status } = req.query;

    console.log('Retailer orders request:', { retailerId: userId, status, page, limit });

    // Verify retailer exists and is active
    const retailer = await Admin.findOne({ user: userId, isActive: true });
    if (!retailer) {
      return res.status(404).json({
        success: false,
        message: 'Retailer profile not found or inactive'
      });
    }

    const filter = { assignedRetailer: retailer._id };
    
    // Filter by status if provided
    if (status && status !== 'all') {
      filter.orderStatus = status;
    }

    console.log('Query filter:', filter);

    // Get all orders assigned to this retailer
    const allOrders = await Order.find(filter)
      .populate('items.product', 'name image unit milkType')
      .populate('customer', 'personalInfo.fullName deliveryAddress')
      .sort({ createdAt: -1 })
      .lean();

    console.log(`Found ${allOrders.length} total assigned orders for retailer`);

    // Filter orders by retailer's service radius if location is available
    let ordersWithinRadius = allOrders;
    if (retailer.location?.coordinates && retailer.serviceRadius) {
      ordersWithinRadius = allOrders.filter(order => {
        if (!order.customer?.deliveryAddress?.coordinates) {
          // If customer address coordinates are missing, exclude the order
          return false;
        }

        const retailerLat = retailer.location.coordinates.latitude;
        const retailerLon = retailer.location.coordinates.longitude;
        const customerLat = order.customer.deliveryAddress.coordinates.latitude;
        const customerLon = order.customer.deliveryAddress.coordinates.longitude;

        const distance = calculateDistance(retailerLat, retailerLon, customerLat, customerLon);
        return distance <= retailer.serviceRadius;
      });

      console.log(`Found ${ordersWithinRadius.length} orders within ${retailer.serviceRadius}km radius`);
    }

    // Apply pagination after filtering
    const paginatedOrders = ordersWithinRadius.slice(
      (page - 1) * limit,
      page * limit
    );

    res.status(200).json({
      success: true,
      orders: paginatedOrders,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(ordersWithinRadius.length / limit),
        totalOrders: ordersWithinRadius.length,
        totalAssigned: allOrders.length,
        withinRadius: ordersWithinRadius.length
      },
      retailer: {
        shopName: retailer.shopName,
        serviceRadius: retailer.serviceRadius,
        hasLocation: !!retailer.location?.coordinates
      }
    });
  } catch (error) {
    console.error('Get Retailer Orders Error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

// @desc    Get retailer order statistics
// @route   GET /api/orders/retailer/stats
// @access  Private/Retailer
export const getRetailerOrderStats = async (req, res) => {
  try {
    const userId = req.user._id;

    const retailer = await Admin.findOne({ user: userId });
    if (!retailer) {
      return res.status(404).json({
        success: false,
        message: 'Retailer profile not found'
      });
    }

    const stats = await Order.aggregate([
      {
        $match: {
          assignedRetailer: retailer._id
        }
      },
      {
        $group: {
          _id: '$orderStatus',
          count: { $sum: 1 },
          totalAmount: { $sum: '$finalAmount' }
        }
      }
    ]);

    const totalOrders = await Order.countDocuments({ assignedRetailer: retailer._id });
    const todayOrders = await Order.countDocuments({
      assignedRetailer: retailer._id,
      createdAt: {
        $gte: new Date(new Date().setHours(0, 0, 0, 0))
      }
    });

    const statusMap = {
      pending: 0,
      confirmed: 0,
      preparing: 0,
      out_for_delivery: 0,
      delivered: 0,
      cancelled: 0
    };

    stats.forEach(stat => {
      statusMap[stat._id] = stat.count;
    });

    res.status(200).json({
      success: true,
      stats: {
        total: totalOrders,
        today: todayOrders,
        byStatus: statusMap
      }
    });
  } catch (error) {
    console.error('Get Retailer Stats Error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

// @desc    Update order status by retailer WITH INVENTORY HANDLING
// @route   PUT /api/orders/retailer/:id/status
// @access  Private/Retailer
export const updateOrderStatusByRetailer = async (req, res) => {
  try {
    const userId = req.user._id;
    const { status } = req.body;
    const orderIdentifier = req.params.id;

    console.log('Retailer updating order status:', { retailerId: userId, orderIdentifier, status });

    const validStatuses = ['confirmed', 'preparing', 'out_for_delivery', 'delivered'];
    
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid order status for retailer'
      });
    }

    // Verify retailer exists
    const retailer = await Admin.findOne({ user: userId });
    if (!retailer) {
      return res.status(404).json({
        success: false,
        message: 'Retailer profile not found'
      });
    }

    // Use helper function to find order
    const order = await findOrderById(orderIdentifier);

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    // Check if order is assigned to this retailer
    if (!order.assignedRetailer || order.assignedRetailer.toString() !== retailer._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Order not assigned to you'
      });
    }

    // Validate status transition
    const statusFlow = {
      pending: ['confirmed', 'cancelled'],
      confirmed: ['preparing', 'cancelled'],
      preparing: ['out_for_delivery'],
      out_for_delivery: ['delivered']
    };

    if (!statusFlow[order.orderStatus]?.includes(status)) {
      return res.status(400).json({
        success: false,
        message: `Cannot change status from ${order.orderStatus} to ${status}`
      });
    }

    // 👇 HANDLE DELIVERY - DEDUCT RESERVED STOCK
    if (status === 'delivered' && order.reservationStatus === 'reserved') {
      try {
        const deliveryResult = await inventoryService.confirmOrderDelivery(
          order._id,
          order.assignedRetailer,
          req.user._id
        );
        console.log('Stock deducted on delivery:', deliveryResult);
        order.reservationStatus = 'delivered';
      } catch (deliveryError) {
        console.error('Failed to deduct stock on delivery:', deliveryError);
        return res.status(400).json({
          success: false,
          message: 'Failed to update inventory: ' + deliveryError.message
        });
      }
    }

    order.orderStatus = status;
    
    // If delivered, set delivered at timestamp
    if (status === 'delivered') {
      order.deliveredAt = new Date();
    }

    await order.save();

    // Populate for response
    await order.populate('items.product', 'name image unit');
    await order.populate('customer', 'personalInfo.fullName');

    res.status(200).json({
      success: true,
      message: 'Order status updated successfully',
      order
    });
  } catch (error) {
    console.error('Update Order Status by Retailer Error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

// @desc    Mark order as delivered and deduct stock (SPECIFIC ENDPOINT)
// @route   PUT /api/orders/:id/deliver
// @access  Private/Retailer/Admin
export const markOrderDelivered = async (req, res) => {
  try {
    const orderIdentifier = req.params.id;

    const order = await findOrderById(orderIdentifier);
    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    // Verify the retailer is authorized to update this order
    if (req.user.role === 'retailer') {
      const retailer = await Admin.findOne({ user: req.user._id });
      if (!retailer || order.assignedRetailer.toString() !== retailer._id.toString()) {
        return res.status(403).json({
          success: false,
          message: 'Not authorized to update this order'
        });
      }
    }

    if (order.orderStatus === 'delivered') {
      return res.status(400).json({
        success: false,
        message: 'Order is already delivered'
      });
    }

    if (order.reservationStatus !== 'reserved') {
      return res.status(400).json({
        success: false,
        message: 'Order stock is not reserved'
      });
    }

    // DEDUCT STOCK from retailer inventory
    const deliveryResult = await inventoryService.confirmOrderDelivery(
      order._id,
      order.assignedRetailer,
      req.user._id
    );

    // Update order status
    order.orderStatus = 'delivered';
    order.reservationStatus = 'delivered';
    order.deliveredAt = new Date();
    await order.save();

    res.json({
      success: true,
      message: 'Order marked as delivered and stock updated',
      order: {
        _id: order._id,
        orderId: order.orderId,
        orderStatus: order.orderStatus,
        reservationStatus: order.reservationStatus,
        deliveredAt: order.deliveredAt
      },
      inventoryUpdate: deliveryResult
    });

  } catch (error) {
    console.error('Mark order delivered error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to mark order as delivered',
      error: error.message
    });
  }
};

// @desc    Get retailer's active orders (non-delivered, non-cancelled)
// @route   GET /api/orders/retailer/active
// @access  Private/Retailer
export const getRetailerActiveOrders = async (req, res) => {
  try {
    const userId = req.user._id;
    const { page = 1, limit = 10, status } = req.query;

    console.log('Retailer active orders request:', { retailerId: userId, status, page, limit });

    // Verify retailer exists and is active
    const retailer = await Admin.findOne({ user: userId, isActive: true });
    if (!retailer) {
      return res.status(404).json({
        success: false,
        message: 'Retailer profile not found or inactive'
      });
    }

    // For active orders, only show non-delivered and non-cancelled orders
    const filter = { 
      assignedRetailer: retailer._id,
      orderStatus: { $nin: ['delivered', 'cancelled'] }
    };
    
    // Additional status filter if provided
    if (status && status !== 'all') {
      filter.orderStatus = status;
    }

    console.log('Active orders filter:', filter);

    // Get active orders assigned to this retailer with pagination
    const orders = await Order.find(filter)
      .populate('items.product', 'name image unit milkType')
      .populate('customer', 'personalInfo.fullName deliveryAddress')
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    console.log(`Found ${orders.length} active orders for retailer`);

    const total = await Order.countDocuments(filter);

    res.status(200).json({
      success: true,
      orders,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(total / limit),
        totalOrders: total
      },
      retailer: {
        shopName: retailer.shopName,
        serviceRadius: retailer.serviceRadius
      }
    });
  } catch (error) {
    console.error('Get Retailer Active Orders Error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

// @desc    Get retailer order history (ALL orders with optional filters)
// @route   GET /api/orders/retailer/history
// @access  Private/Retailer
export const getRetailerOrderHistory = async (req, res) => {
  try {
    const userId = req.user._id;
    const { page = 1, limit = 10, status, type } = req.query;

    console.log('📋 Retailer order history request:', { retailerId: userId, status, page, limit, type });

    // Verify retailer exists
    const retailer = await Admin.findOne({ user: userId });
    if (!retailer) {
      return res.status(404).json({
        success: false,
        message: 'Retailer profile not found'
      });
    }

    // For order history, show ALL assigned orders regardless of status
    const filter = { assignedRetailer: retailer._id };

    // Additional status filter if provided
    if (status && status !== 'all') {
      filter.orderStatus = status;
    }

    // Filter by order type if provided
    if (type && type !== 'all') {
      filter.orderType = type;
    }

    console.log('🔍 Order history filter:', filter);

    // Get all orders assigned to this retailer with pagination
    const orders = await Order.find(filter)
      .populate('items.product', 'name image unit milkType price')
      .populate('customer', 'personalInfo.fullName deliveryAddress')
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    console.log(`📊 Found ${orders.length} orders in history for retailer`);

    // Process orders to ensure correct price display
    const processedOrders = orders.map(order => {
      const processedItems = order.items.map(item => {
        // For ALL orders, ensure we use the stored price from the order (which includes overrides)
        return {
          ...item.toObject(),
          // Use the price that was actually charged (from order creation)
          displayPrice: item.price,
          finalPrice: item.price,
          isPriceOverridden: item.isPriceOverridden || false,
          originalPrice: item.originalPrice || item.product?.price || 0,
          priceSource: item.priceSource || 'catalog'
        };
      });

      return {
        ...order.toObject(),
        items: processedItems
      };
    });

    const total = await Order.countDocuments(filter);

    res.status(200).json({
      success: true,
      orders: processedOrders,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(total / limit),
        totalOrders: total
      },
      retailer: {
        shopName: retailer.shopName,
        serviceRadius: retailer.serviceRadius
      }
    });
  } catch (error) {
    console.error('❌ Get Retailer Order History Error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};