// controllers/order.controller.js
import mongoose from 'mongoose';
import Customer from '../models/customer.model.js';
import Order from '../models/order.model.js';
import Product from '../models/product.model.js';
import Admin from '../models/admin.model.js';
import { getClosestRetailer, validateCoordinates, calculateDistance } from '../utils/locationUtils.js';
import inventoryService from '../services/inventory.service.js';

// Generate unique order ID
const generateOrderId = () => {
  return 'ORD' + Date.now() + Math.floor(Math.random() * 1000);
};

// Helper function to find order by ID (supports both orderId string and MongoDB _id)
const findOrderById = async (orderIdentifier) => {
  if (orderIdentifier.startsWith('ORD')) {
    return await Order.findOne({ orderId: orderIdentifier });
  } else {
    return await Order.findById(orderIdentifier);
  }
};

// @desc    Create new order WITH INVENTORY RESERVATION
// @route   POST /api/orders
// @access  Private
export const createOrder = async (req, res) => {
  const session = await mongoose.startSession(); // 👈 ADD SESSION
  
  try {
    session.startTransaction(); // 👈 START TRANSACTION

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

    // Validate items and calculate total
    let totalAmount = 0;
    const orderItems = [];

    // 👇 REMOVE OLD STOCK CHECK - We'll check retailer inventory instead
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

      // ✅ REMOVE: product.stock check - we'll check retailer inventory

      const itemTotal = product.price * item.quantity;
      totalAmount += itemTotal;

      orderItems.push({
        product: product._id,
        quantity: item.quantity,
        price: product.price,
        unit: product.unit,
        reservedQuantity: 0, // 👈 ADD RESERVATION TRACKING
        isReserved: false    // 👈 ADD RESERVATION STATUS
      });
    }

    // Find the closest retailer for order assignment
    let assignedRetailer = null;
    let assignmentDetails = null;
    
    // Use provided delivery address or customer's default address
    const addressToUse = deliveryAddress || customer.deliveryAddress;
    
    if (!addressToUse) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: 'Delivery address is required. Please add a delivery address to your profile or provide one during checkout.'
      });
    }

    let customerLocation = addressToUse.coordinates;
    
    if (!customerLocation || !customerLocation.latitude || !customerLocation.longitude) {
      await session.abortTransaction();
      console.log('Coordinates missing in delivery address');
      return res.status(400).json({
        success: false,
        message: 'Delivery address coordinates are required. Please provide a valid address with location coordinates to place an order.',
        suggestion: 'Please update your delivery address with proper location coordinates or select your location on the map.'
      });
    } else {
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
        100 // 50km max radius
      );
      
      if (closestRetailerInfo && closestRetailerInfo.retailer) {
        assignedRetailer = closestRetailerInfo.retailer._id;
        assignmentDetails = {
          distance: closestRetailerInfo.distance,
          retailerName: closestRetailerInfo.retailer.fullName,
          retailerShop: closestRetailerInfo.retailer.shopName,
          serviceRadius: closestRetailerInfo.retailer.serviceRadius
        };
        
        console.log(`Order assigned to retailer: ${closestRetailerInfo.retailer.shopName} (${closestRetailerInfo.distance}km away)`);
      } else {
        await session.abortTransaction();
        console.log('No retailer found within service radius');
        return res.status(400).json({
          success: false,
          message: 'No retailer available within your delivery area. Please try a different address or contact customer support.',
          suggestion: 'No active retailer found within the service radius for your delivery location.'
        });
      }
    }

    // 👇 CHECK RETAILER INVENTORY AVAILABILITY
    const stockCheck = await inventoryService.checkStockAvailability(assignedRetailer, items);
    if (!stockCheck.allAvailable) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: 'Some items are out of stock with the assigned retailer',
        stockDetails: stockCheck.items,
        retailer: assignmentDetails.retailerShop
      });
    }

    // Create order
    const order = new Order({
      orderId: generateOrderId(),
      customer: customer._id,
      items: orderItems,
      totalAmount,
      finalAmount: totalAmount,
      deliveryAddress: addressToUse,
      deliveryTime: deliveryTime || customer.preferences?.deliveryTime,
      paymentMethod: paymentMethod || 'cash',
      specialInstructions,
      deliveryDate: new Date(Date.now() + 24 * 60 * 60 * 1000),
      assignedRetailer,
      assignmentDetails,
      reservationStatus: 'not_reserved', // 👈 ADD RESERVATION STATUS
      orderStatus: 'pending'
    });

    await order.save({ session });

    // 👇 RESERVE STOCK IN RETAILER INVENTORY
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
      await session.commitTransaction(); // 👈 COMMIT TRANSACTION

      // Populate order for response
      await order.populate('items.product', 'name image unit');
      await order.populate('assignedRetailer', 'shopName fullName contactNumber');

      res.status(201).json({
        success: true,
        message: 'Order created successfully and stock reserved',
        order: {
          _id: order._id,
          orderId: order.orderId,
          totalAmount: order.totalAmount,
          finalAmount: order.finalAmount,
          orderStatus: order.orderStatus,
          reservationStatus: order.reservationStatus,
          assignedRetailer: order.assignedRetailer,
          items: order.items,
          reservationDetails: {
            reservedItems: reservationResult.reservedItems.length,
            message: reservationResult.message
          }
        }
      });

    } catch (reservationError) {
      // If reservation fails, delete the order
      await Order.findByIdAndDelete(order._id).session(session);
      await session.abortTransaction();
      
      console.error('Stock reservation failed:', reservationError);
      
      res.status(400).json({
        success: false,
        message: 'Order creation failed: Could not reserve stock. ' + reservationError.message,
        suggestion: 'Please try again or contact customer support.'
      });
    }

  } catch (error) {
    await session.abortTransaction();
    console.error('Create Order Error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while creating order',
      error: error.message
    });
  } finally {
    session.endSession(); // 👈 END SESSION
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

