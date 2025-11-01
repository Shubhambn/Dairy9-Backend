import Customer from '../models/customer.model.js';
import Order from '../models/order.model.js';
import Product from '../models/product.model.js';
import Admin from '../models/admin.model.js';
import { getClosestRetailer, validateCoordinates } from '../utils/locationUtils.js';

// Generate unique order ID
const generateOrderId = () => {
  return 'ORD' + Date.now() + Math.floor(Math.random() * 1000);
};

// Helper function to get coordinates from address using geocoding
const getCoordinatesFromAddress = async (address) => {
  try {
    // You can integrate with a geocoding service here
    // For now, we'll return null and handle it gracefully
    console.log('Geocoding not implemented for address:', address.formattedAddress);
    return null;
  } catch (error) {
    console.error('Geocoding error:', error);
    return null;
  }
};

// Helper function to find order by ID (supports both orderId string and MongoDB _id)
const findOrderById = async (orderIdentifier) => {
  // Check if the ID looks like an orderId (starts with ORD)
  if (orderIdentifier.startsWith('ORD')) {
    return await Order.findOne({ orderId: orderIdentifier });
  } else {
    // Otherwise treat it as MongoDB _id
    return await Order.findById(orderIdentifier);
  }
};

// @desc    Create new order
// @route   POST /api/orders
// @access  Private
export const createOrder = async (req, res) => {
  try {
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
      return res.status(404).json({
        success: false,
        message: 'Customer profile not found. Please complete your profile first.'
      });
    }

    // Validate items and calculate total
    let totalAmount = 0;
    const orderItems = [];

    for (const item of items) {
      const product = await Product.findById(item.productId);
      if (!product) {
        return res.status(400).json({
          success: false,
          message: `Product not found: ${item.productId}`
        });
      }

      if (!product.isAvailable) {
        return res.status(400).json({
          success: false,
          message: `Product not available: ${product.name}`
        });
      }

      if (product.stock < item.quantity) {
        return res.status(400).json({
          success: false,
          message: `Insufficient stock for ${product.name}. Available: ${product.stock}`
        });
      }

      const itemTotal = product.price * item.quantity;
      totalAmount += itemTotal;

      orderItems.push({
        product: product._id,
        quantity: item.quantity,
        price: product.price,
        unit: product.unit
      });
    }

    // Find the closest retailer for order assignment
    let assignedRetailer = null;
    let assignmentDetails = null;
    
    // Use provided delivery address or customer's default address
    const addressToUse = deliveryAddress || customer.deliveryAddress;
    
    if (!addressToUse) {
      return res.status(400).json({
        success: false,
        message: 'Delivery address is required. Please add a delivery address to your profile or provide one during checkout.'
      });
    }

    let customerLocation = addressToUse.coordinates;
    
    // If coordinates are missing, try to get them or assign to any available retailer
    if (!customerLocation || !customerLocation.latitude || !customerLocation.longitude) {
      console.log('Coordinates missing in delivery address, attempting to assign retailer...');
      
      // For now, we'll assign to any available retailer as fallback
      const availableRetailers = await Admin.find({ isActive: true }).limit(1);
      
      if (availableRetailers.length > 0) {
        assignedRetailer = availableRetailers[0]._id;
        assignmentDetails = {
          distance: null,
          retailerName: availableRetailers[0].fullName,
          retailerShop: availableRetailers[0].shopName,
          serviceRadius: availableRetailers[0].serviceRadius,
          note: 'Assigned without coordinates validation'
        };
        console.log(`Order assigned to default retailer: ${availableRetailers[0].shopName} (coordinates missing)`);
      } else {
        console.log('No retailers available for assignment');
        return res.status(400).json({
          success: false,
          message: 'No retailers available at the moment. Please try again later.'
        });
      }
    } else {
      // Validate customer coordinates
      if (!validateCoordinates(customerLocation.latitude, customerLocation.longitude)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid delivery address coordinates'
        });
      }

      // Get all active retailers
      const retailers = await Admin.find({ isActive: true });
      
      if (retailers.length === 0) {
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
        50 // 50km max radius
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
        console.log('No retailer found within service radius, trying fallback...');
        
        // Fallback: assign to any available retailer
        const fallbackRetailers = await Admin.find({ isActive: true }).limit(1);
        if (fallbackRetailers.length > 0) {
          assignedRetailer = fallbackRetailers[0]._id;
          assignmentDetails = {
            distance: null,
            retailerName: fallbackRetailers[0].fullName,
            retailerShop: fallbackRetailers[0].shopName,
            serviceRadius: fallbackRetailers[0].serviceRadius,
            note: 'Fallback assignment - no retailer in radius'
          };
          console.log(`Order assigned to fallback retailer: ${fallbackRetailers[0].shopName}`);
        } else {
          return res.status(400).json({
            success: false,
            message: 'No retailer available in your delivery area. Please try a different address or contact customer support.'
          });
        }
      }
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
      deliveryDate: new Date(Date.now() + 24 * 60 * 60 * 1000), // Next day delivery
      assignedRetailer,
      assignmentDetails
    });

    await order.save();
    
    // Populate order for response
    await order.populate('items.product', 'name image unit');
    await order.populate('assignedRetailer', 'shopName fullName contactNumber');

    res.status(201).json({
      success: true,
      message: 'Order created successfully',
      order
    });
  } catch (error) {
    console.error('Create Order Error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
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

// @desc    Cancel order
// @route   PUT /api/orders/:id/cancel
// @access  Private
export const cancelOrder = async (req, res) => {
  try {
    const userId = req.user._id;
    const orderIdentifier = req.params.id;

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

    order.orderStatus = 'cancelled';
    await order.save();

    res.status(200).json({
      success: true,
      message: 'Order cancelled successfully',
      order
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

// @desc    Update order status (Admin/Retailer)
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

// @desc    Update order status by retailer
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