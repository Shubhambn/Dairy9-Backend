// controllers/order.controller.js (replace createOrder)
import mongoose from 'mongoose';
import Customer from '../models/customer.model.js';
import Order from '../models/order.model.js';
import Product from '../models/product.model.js';
import Admin from '../models/admin.model.js';
import { getClosestRetailer, validateCoordinates } from '../utils/locationUtils.js';
import inventoryService from '../services/inventory.service.js';

const generateOrderId = () => 'ORD' + Date.now() + Math.floor(Math.random() * 1000);

const findOrderById = async (orderIdentifier) => {
  if (!orderIdentifier) return null;
  if (typeof orderIdentifier === 'string' && orderIdentifier.startsWith('ORD')) {
    return Order.findOne({ orderId: orderIdentifier });
  } else {
    return Order.findById(orderIdentifier);
  }
};

export const createOrder = async (req, res) => {
  const session = await mongoose.startSession();

  try {
    session.startTransaction();

    const userId = req.user._id;
    const {
      items: rawItems,
      deliveryAddress: providedAddress,
      deliveryTime,
      paymentMethod,
      specialInstructions,
      retailerId: requestedRetailerId, // optional override from client
      temporary = true
    } = req.body;

    // basic validation
    if (!Array.isArray(rawItems) || rawItems.length === 0) {
      await session.abortTransaction();
      return res.status(400).json({ success: false, message: 'No items provided' });
    }

    // normalize items and validate quantities
    const items = rawItems.map(it => ({
      productId: it.productId || it.product?._id || it.product?.id,
      quantity: Number(it.quantity) || 0
    }));

    for (const it of items) {
      if (!it.productId || it.quantity <= 0) {
        await session.abortTransaction();
        return res.status(400).json({
          success: false,
          message: 'Invalid product or quantity in items',
          details: it
        });
      }
    }

    // fetch customer
    const customer = await Customer.findOne({ user: userId }).session(session);
    if (!customer) {
      await session.abortTransaction();
      return res.status(404).json({ success: false, message: 'Customer profile not found' });
    }

    // choose delivery address (prefer provided, else profile)
    const addressToUse = providedAddress || customer.deliveryAddress;
    if (!addressToUse) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: 'Delivery address required'
      });
    }

    // coordinates must exist
    const coords = addressToUse.coordinates;
    if (!coords || typeof coords.latitude !== 'number' || typeof coords.longitude !== 'number') {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: 'Delivery address coordinates are required. Please provide latitude and longitude.'
      });
    }

    if (!validateCoordinates(coords.latitude, coords.longitude)) {
      await session.abortTransaction();
      return res.status(400).json({ success: false, message: 'Invalid delivery coordinates' });
    }

    // find assigned retailer: priority -> client requested retailerId -> closest retailer within radius
    let assignedRetailer = null;
    let assignmentDetails = null;

    if (requestedRetailerId) {
      assignedRetailer = await Admin.findById(requestedRetailerId).lean();
      if (!assignedRetailer || !assignedRetailer.isActive) {
        await session.abortTransaction();
        return res.status(400).json({ success: false, message: 'Requested retailer not found or inactive' });
      }
      assignmentDetails = { retailerName: assignedRetailer.fullName, retailerShop: assignedRetailer.shopName };
    } else {
      // fetch active retailers and pick closest
      const retailers = await Admin.find({ isActive: true }).lean();
      if (!retailers || retailers.length === 0) {
        await session.abortTransaction();
        return res.status(400).json({ success: false, message: 'No active retailers available' });
      }

      const closest = getClosestRetailer(coords.latitude, coords.longitude, retailers, 100); // radius kms
      if (!closest || !closest.retailer) {
        await session.abortTransaction();
        return res.status(400).json({
          success: false,
          message: 'No retailer within service radius'
        });
      }
      assignedRetailer = closest.retailer;
      assignmentDetails = {
        distance: closest.distance,
        retailerName: assignedRetailer.fullName,
        retailerShop: assignedRetailer.shopName,
        serviceRadius: assignedRetailer.serviceRadius
      };
    }

    // Check retailer inventory availability and get seller prices via inventoryService
    // Expected return: { allAvailable: boolean, items: [{ productId, available, availableQty, sellingPrice, message }] }
    const stockCheck = await inventoryService.checkStockAvailability(assignedRetailer._id, items);
    if (!stockCheck || !stockCheck.allAvailable) {
      await session.abortTransaction();
      return res.status(409).json({
        success: false,
        message: 'Some items are unavailable at the assigned retailer',
        stockDetails: stockCheck?.items || []
      });
    }

    // Build order items using seller price (fallback to product.price if missing)
    let totalAmount = 0;
    const orderItems = [];

    // create a map from stockCheck items for quick lookups
    const stockMap = new Map();
    (stockCheck.items || []).forEach(si => stockMap.set(String(si.productId), si));

    for (const it of items) {
      // fetch product metadata (name/unit) for richer order line (no heavy checks)
      const product = await Product.findById(it.productId).lean();
      if (!product) {
        await session.abortTransaction();
        return res.status(400).json({ success: false, message: `Product not found: ${it.productId}` });
      }

      const stockInfo = stockMap.get(String(it.productId));
      const unitPrice = stockInfo?.sellingPrice ?? product.discountedPrice ?? product.price ?? 0;
      const itemTotal = unitPrice * it.quantity;
      totalAmount += itemTotal;

      orderItems.push({
        product: product._id,
        productName: product.name,
        quantity: it.quantity,
        price: unitPrice,
        unit: product.unit,
        reservedQuantity: 0,
        isReserved: false
      });
    }

    // Create the Order document (inside session)
    const order = new Order({
      orderId: generateOrderId(),
      customer: customer._id,
      items: orderItems,
      totalAmount,
      finalAmount: totalAmount,
      deliveryAddress: addressToUse,
      deliveryTime: deliveryTime || customer.preferences?.deliveryTime || null,
      paymentMethod: paymentMethod || 'cash',
      specialInstructions: specialInstructions || '',
      deliveryDate: new Date(Date.now() + 24 * 60 * 60 * 1000),
      assignedRetailer: assignedRetailer._id,
      assignmentDetails,
      reservationStatus: 'not_reserved',
      orderStatus: 'pending'
    });

    await order.save({ session });

    // Reserve stock using inventoryService (implementation must update retailer inventory transactionally where possible).
    // reserveStockForOrder should return an object { success: boolean, reservedItems: [...], message }
    const reservationResult = await inventoryService.reserveStockForOrder(order._id, assignedRetailer._id, items, userId);

    if (!reservationResult || !reservationResult.success) {
      // reservation failed -> rollback
      await Order.findByIdAndDelete(order._id).session(session);
      await session.abortTransaction();
      return res.status(409).json({
        success: false,
        message: 'Failed to reserve stock for order',
        details: reservationResult?.message || 'Reservation failed'
      });
    }

    // Update order items with reserved info
    order.reservationStatus = 'reserved';
    order.reservationDate = new Date();

    // map reserved quantities from reservation result
    const reservedMap = new Map();
    (reservationResult.reservedItems || []).forEach(r => reservedMap.set(String(r.productId), r));

    order.items = order.items.map(li => {
      const r = reservedMap.get(String(li.product));
      if (r) {
        li.reservedQuantity = r.quantity;
        li.isReserved = true;
      }
      return li;
    });

    await order.save({ session });

    await session.commitTransaction();

    // populate for response (outside transaction)
    await order.populate('items.product', 'name image unit').execPopulate?.() /* backward compat */; 
    await order.populate('assignedRetailer', 'shopName fullName contactNumber');

    return res.status(201).json({
      success: true,
      message: 'Order created and stock reserved',
      order: {
        _id: order._id,
        orderId: order.orderId,
        totalAmount: order.totalAmount,
        finalAmount: order.finalAmount,
        orderStatus: order.orderStatus,
        reservationStatus: order.reservationStatus,
        assignedRetailer: order.assignedRetailer,
        items: order.items
      },
      reservationSummary: {
        reservedCount: reservationResult.reservedItems.length,
        message: reservationResult.message
      }
    });

  } catch (err) {
    await session.abortTransaction();
    console.error('Create Order Error:', err);
    return res.status(500).json({
      success: false,
      message: 'Server error while creating order',
      error: err.message
    });
  } finally {
    session.endSession();
  }
};

// @desc    Get customer orders
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
      .populate('items.product', 'name image unit')
      .populate('assignedRetailer', 'shopName fullName contactNumber')
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await Order.countDocuments(filter);

    res.status(200).json({
      success: true,
      orders,
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

// @desc    Get single order details
// @route   GET /api/orders/:id
// @access  Private
export const getOrderById = async (req, res) => {
  try {
    const userId = req.user._id;
    const orderIdentifier = req.params.id;

    // Use helper function to find order
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

    res.status(200).json({
      success: true,
      order
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

    // Use helper function to find order
    const order = await findOrderById(orderIdentifier);

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    // Check if customer owns this order
    if (order.customer.toString() !== customer._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. You can only cancel your own orders.'
      });
    }

    // Only pending or confirmed orders can be cancelled
    if (!['pending', 'confirmed'].includes(order.orderStatus)) {
      return res.status(400).json({
        success: false,
        message: `Cannot cancel order in ${order.orderStatus} status`
      });
    }

    // 👇 RELEASE RESERVED STOCK if order was reserved
    let stockReleaseResult = null;
    if (order.reservationStatus === 'reserved') {
      stockReleaseResult = await inventoryService.cancelOrderReservation(
        order._id,
        order.assignedRetailer,
        req.user._id,
        reason
      );
    }

    // Update order status
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

    // Use helper function to find order
    const order = await findOrderById(orderIdentifier);

    if (!order) {
      console.log('Order not found for identifier:', orderIdentifier);
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    // If user is retailer, check if order is assigned to them
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

    console.log('Found order:', order._id, 'current status:', order.orderStatus);

    // 👇 HANDLE DELIVERY - DEDUCT RESERVED STOCK
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

    // 👇 HANDLE CANCELLATION - RELEASE RESERVED STOCK
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
          // Continue with cancellation even if stock release fails
        }
      }
    }

    order.orderStatus = status;
    
    // If delivered, set delivered at timestamp
    if (status === 'delivered') {
      order.deliveredAt = new Date();
    }

    await order.save();

    // Populate order for response
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

// @desc    Get retailer's assigned orders
// @route   GET /api/orders/retailer/my-orders
// @access  Private/Retailer
// @desc    Get retailer's assigned orders (ALL orders - no radius filtering)
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

    // Get all orders assigned to this retailer with pagination
    const orders = await Order.find(filter)
      .populate('items.product', 'name image unit milkType')
      .populate('customer', 'personalInfo.fullName deliveryAddress')
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    console.log(`Found ${orders.length} orders for retailer`);

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

export const getRetailerOrderHistory = async (req, res) => {
  try {
    const userId = req.user._id;
    const { page = 1, limit = 10, status } = req.query;

    console.log('Retailer order history request:', { retailerId: userId, status, page, limit });

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

    console.log('Order history filter:', filter);

    // Get all orders assigned to this retailer with pagination
    const orders = await Order.find(filter)
      .populate('items.product', 'name image unit milkType')
      .populate('customer', 'personalInfo.fullName deliveryAddress')
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    console.log(`Found ${orders.length} orders in history for retailer`);

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
    console.error('Get Retailer Order History Error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

