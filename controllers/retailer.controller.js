import Admin from '../models/admin.model.js';
import Order from '../models/order.model.js';
import User from '../models/user.model.js';
import { calculateDistance, validateCoordinates } from '../utils/locationUtils.js';

// @desc    Get retailer profile
// @route   GET /api/admin/retailer/profile
// @access  Private (Admin/Retailer)
export const getRetailerProfile = async (req, res) => {
  try {
    const userId = req.user._id;

    // Find admin/retailer by user ID
    const retailer = await Admin.findOne({ user: userId })
      .select('shopName serviceRadius location fullName contactNumber address isActive')
      .populate('user', 'phone role');

    if (!retailer) {
      return res.status(404).json({
        success: false,
        message: 'Retailer profile not found'
      });
    }

    res.json({
      success: true,
      profile: {
        _id: retailer._id,
        shopName: retailer.shopName,
        fullName: retailer.fullName,
        contactNumber: retailer.contactNumber,
        address: retailer.address,
        serviceRadius: retailer.serviceRadius,
        location: retailer.location,
        isActive: retailer.isActive,
        phone: retailer.user?.phone,
        role: retailer.user?.role
      }
    });
  } catch (error) {
    console.error('Error fetching retailer profile:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch retailer profile'
    });
  }
};

// @desc    Update retailer profile
// @route   PUT /api/admin/retailer/profile
// @access  Private (Admin/Retailer)
export const updateRetailerProfile = async (req, res) => {
  try {
    const userId = req.user._id;
    const { fullName, shopName, address, contactNumber } = req.body;

    const retailer = await Admin.findOne({ user: userId });
    if (!retailer) {
      return res.status(404).json({
        success: false,
        message: 'Retailer profile not found'
      });
    }

    // Update fields if provided
    if (fullName) retailer.fullName = fullName;
    if (shopName) retailer.shopName = shopName;
    if (address) retailer.address = address;
    if (contactNumber) retailer.contactNumber = contactNumber;

    await retailer.save();

    res.json({
      success: true,
      message: 'Profile updated successfully',
      profile: {
        shopName: retailer.shopName,
        fullName: retailer.fullName,
        contactNumber: retailer.contactNumber,
        address: retailer.address
      }
    });
  } catch (error) {
    console.error('Error updating retailer profile:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update profile'
    });
  }
};

// @desc    Update retailer service radius
// @route   PUT /api/admin/retailer/radius
// @access  Private (Admin/Retailer)
export const updateServiceRadius = async (req, res) => {
  try {
    const { serviceRadius } = req.body;
    const userId = req.user._id;

    if (!serviceRadius || serviceRadius < 1 || serviceRadius > 100) {
      return res.status(400).json({
        success: false,
        message: 'Service radius must be between 1 and 100 km'
      });
    }

    const retailer = await Admin.findOneAndUpdate(
      { user: userId },
      { serviceRadius },
      { new: true }
    ).select('shopName serviceRadius location fullName');

    if (!retailer) {
      return res.status(404).json({
        success: false,
        message: 'Retailer not found'
      });
    }

    res.json({
      success: true,
      message: 'Service radius updated successfully',
      retailer: {
        shopName: retailer.shopName,
        fullName: retailer.fullName,
        serviceRadius: retailer.serviceRadius,
        location: retailer.location
      }
    });
  } catch (error) {
    console.error('Error updating service radius:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update service radius'
    });
  }
};

// @desc    Update retailer location
// @route   PUT /api/admin/retailer/location
// @access  Private (Admin/Retailer)
export const updateLocation = async (req, res) => {
  try {
    const { latitude, longitude, formattedAddress, city, state, pincode } = req.body;
    const userId = req.user._id;

    if (!latitude || !longitude) {
      return res.status(400).json({
        success: false,
        message: 'Latitude and longitude are required'
      });
    }

    if (!validateCoordinates(latitude, longitude)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid coordinates provided'
      });
    }

    const locationData = {
      coordinates: {
        latitude: parseFloat(latitude),
        longitude: parseFloat(longitude)
      },
      formattedAddress: formattedAddress || `Location at ${latitude}, ${longitude}`,
      city: city || '',
      state: state || '',
      pincode: pincode || ''
    };

    const retailer = await Admin.findOneAndUpdate(
      { user: userId },
      { location: locationData },
      { new: true }
    ).select('shopName serviceRadius location fullName');

    if (!retailer) {
      return res.status(404).json({
        success: false,
        message: 'Retailer not found'
      });
    }

    res.json({
      success: true,
      message: 'Location updated successfully',
      retailer: {
        shopName: retailer.shopName,
        fullName: retailer.fullName,
        serviceRadius: retailer.serviceRadius,
        location: retailer.location
      }
    });
  } catch (error) {
    console.error('Error updating location:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update location'
    });
  }
};

// @desc    Get retailer's assigned orders
// @route   GET /api/admin/retailer/orders
// @access  Private (Admin/Retailer)
export const getRetailerOrders = async (req, res) => {
  try {
    const userId = req.user._id;
    const { status, page = 1, limit = 20 } = req.query;

    // Get retailer profile
    const retailer = await Admin.findOne({ user: userId });
    if (!retailer) {
      return res.status(404).json({
        success: false,
        message: 'Retailer not found'
      });
    }

    // Build filter for orders assigned to this retailer
    const filter = { assignedRetailer: retailer._id };
    
    if (status && status !== 'all') {
      filter.orderStatus = status;
    }

    const orders = await Order.find(filter)
      .populate('customer', 'personalInfo.fullName deliveryAddress')
      .populate('items.product', 'name price unit image')
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .lean();

    // Add distance information to each order if retailer has location
    const ordersWithDistance = orders.map(order => {
      let distance = null;
      
      if (retailer.location?.coordinates && order.customer?.deliveryAddress?.coordinates) {
        const retailerLat = retailer.location.coordinates.latitude;
        const retailerLon = retailer.location.coordinates.longitude;
        const customerLat = order.customer.deliveryAddress.coordinates.latitude;
        const customerLon = order.customer.deliveryAddress.coordinates.longitude;

        distance = calculateDistance(retailerLat, retailerLon, customerLat, customerLon);
        distance = Math.round(distance * 100) / 100; // Round to 2 decimal places
      }

      return {
        ...order,
        distance,
        customerName: order.customer?.personalInfo?.fullName || 'N/A',
        deliveryAddress: order.deliveryAddress || order.customer?.deliveryAddress
      };
    });

    const total = await Order.countDocuments(filter);

    res.json({
      success: true,
      orders: ordersWithDistance,
      retailer: {
        shopName: retailer.shopName,
        serviceRadius: retailer.serviceRadius,
        hasLocation: !!retailer.location?.coordinates
      },
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(total / limit),
        totalOrders: total
      }
    });
  } catch (error) {
    console.error('Error fetching retailer orders:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch orders'
    });
  }
};

// @desc    Get orders within retailer's service radius (available for assignment)
// @route   GET /api/admin/retailer/orders/available
// @access  Private (Admin/Retailer)
export const getAvailableOrders = async (req, res) => {
  try {
    const userId = req.user._id;
    const { page = 1, limit = 20 } = req.query;

    // Get retailer profile with location
    const retailer = await Admin.findOne({ user: userId });
    if (!retailer) {
      return res.status(404).json({
        success: false,
        message: 'Retailer not found'
      });
    }

    if (!retailer.location?.coordinates) {
      return res.status(400).json({
        success: false,
        message: 'Retailer location not set. Please update your location first.'
      });
    }

    // Find unassigned orders or orders assigned to this retailer
    const filter = {
      $or: [
        { assignedRetailer: null },
        { assignedRetailer: retailer._id }
      ],
      orderStatus: { $in: ['pending', 'confirmed'] }
    };

    const orders = await Order.find(filter)
      .populate('customer', 'personalInfo.fullName deliveryAddress')
      .populate('items.product', 'name price unit')
      .populate('assignedRetailer', 'shopName')
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .lean();

    // Filter orders within retailer's service radius
    const nearbyOrders = orders.filter(order => {
      if (!order.customer?.deliveryAddress?.coordinates) {
        return false;
      }

      const customerLat = order.customer.deliveryAddress.coordinates.latitude;
      const customerLon = order.customer.deliveryAddress.coordinates.longitude;
      const retailerLat = retailer.location.coordinates.latitude;
      const retailerLon = retailer.location.coordinates.longitude;

      const distance = calculateDistance(retailerLat, retailerLon, customerLat, customerLon);
      return distance <= retailer.serviceRadius;
    });

    // Add distance information
    const ordersWithDistance = nearbyOrders.map(order => {
      const customerLat = order.customer.deliveryAddress.coordinates.latitude;
      const customerLon = order.customer.deliveryAddress.coordinates.longitude;
      const retailerLat = retailer.location.coordinates.latitude;
      const retailerLon = retailer.location.coordinates.longitude;

      const distance = calculateDistance(retailerLat, retailerLon, customerLat, customerLon);

      return {
        ...order,
        distance: Math.round(distance * 100) / 100,
        customerName: order.customer?.personalInfo?.fullName || 'N/A',
        isAssignedToMe: order.assignedRetailer?._id?.toString() === retailer._id.toString()
      };
    });

    // Sort by distance (closest first)
    ordersWithDistance.sort((a, b) => a.distance - b.distance);

    const totalAvailable = await Order.countDocuments(filter);

    res.json({
      success: true,
      orders: ordersWithDistance,
      currentRadius: retailer.serviceRadius,
      stats: {
        totalAvailable: totalAvailable,
        ordersWithinRadius: ordersWithDistance.length,
        radius: retailer.serviceRadius
      },
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(ordersWithDistance.length / limit),
        totalOrders: ordersWithDistance.length
      }
    });
  } catch (error) {
    console.error('Error fetching available orders:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch available orders'
    });
  }
};

// @desc    Get retailer order statistics
// @route   GET /api/admin/retailer/stats
// @access  Private (Admin/Retailer)
export const getRetailerOrderStats = async (req, res) => {
  try {
    const userId = req.user._id;

    const retailer = await Admin.findOne({ user: userId });
    if (!retailer) {
      return res.status(404).json({
        success: false,
        message: 'Retailer not found'
      });
    }

    // Get order counts by status
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

    res.json({
      success: true,
      stats: {
        total: totalOrders,
        today: todayOrders,
        byStatus: statusMap,
        retailer: {
          shopName: retailer.shopName,
          serviceRadius: retailer.serviceRadius,
          hasLocation: !!retailer.location?.coordinates
        }
      }
    });
  } catch (error) {
    console.error('Error fetching retailer stats:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch statistics'
    });
  }
};

// @desc    Assign order to retailer
// @route   PUT /api/admin/retailer/orders/:orderId/assign
// @access  Private (Admin/Retailer)
export const assignOrderToRetailer = async (req, res) => {
  try {
    const { orderId } = req.params;
    const userId = req.user._id;

    // Get retailer
    const retailer = await Admin.findOne({ user: userId });
    if (!retailer) {
      return res.status(404).json({
        success: false,
        message: 'Retailer not found'
      });
    }

    const order = await Order.findById(orderId)
      .populate('customer', 'personalInfo.fullName deliveryAddress');
    
    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    // Check if order is already assigned to another retailer
    if (order.assignedRetailer && order.assignedRetailer.toString() !== retailer._id.toString()) {
      return res.status(400).json({
        success: false,
        message: 'Order is already assigned to another retailer'
      });
    }

    // Calculate distance if both locations are available
    let distance = null;
    if (retailer.location?.coordinates && order.customer?.deliveryAddress?.coordinates) {
      const retailerLat = retailer.location.coordinates.latitude;
      const retailerLon = retailer.location.coordinates.longitude;
      const customerLat = order.customer.deliveryAddress.coordinates.latitude;
      const customerLon = order.customer.deliveryAddress.coordinates.longitude;

      distance = calculateDistance(retailerLat, retailerLon, customerLat, customerLon);
    }

    // Assign order to current retailer
    order.assignedRetailer = retailer._id;
    order.assignmentDetails = {
      assignedAt: new Date(),
      distance: distance ? Math.round(distance * 100) / 100 : null,
      retailerName: retailer.fullName,
      retailerShop: retailer.shopName,
      serviceRadius: retailer.serviceRadius
    };

    await order.save();

    // Populate for response
    await order.populate('items.product', 'name price unit');

    res.json({
      success: true,
      message: 'Order assigned successfully',
      order: {
        _id: order._id,
        orderId: order.orderId,
        assignedRetailer: order.assignedRetailer,
        orderStatus: order.orderStatus,
        customerName: order.customer?.personalInfo?.fullName,
        totalAmount: order.totalAmount,
        distance: order.assignmentDetails?.distance
      }
    });
  } catch (error) {
    console.error('Error assigning order:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to assign order'
    });
  }
};

// @desc    Update order status (for assigned orders)
// @route   PUT /api/admin/retailer/orders/:orderId/status
// @access  Private (Admin/Retailer)
export const updateOrderStatus = async (req, res) => {
  try {
    const { orderId } = req.params;
    const { status } = req.body;
    const userId = req.user._id;

    const validStatuses = ['confirmed', 'preparing', 'out_for_delivery', 'delivered', 'cancelled'];
    
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid order status'
      });
    }

    // Get retailer
    const retailer = await Admin.findOne({ user: userId });
    if (!retailer) {
      return res.status(404).json({
        success: false,
        message: 'Retailer not found'
      });
    }

    // Find order assigned to this retailer
    const order = await Order.findOne({
      _id: orderId,
      assignedRetailer: retailer._id
    });

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found or not assigned to you'
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

    res.json({
      success: true,
      message: 'Order status updated successfully',
      order: {
        orderId: order.orderId,
        orderStatus: order.orderStatus,
        deliveredAt: order.deliveredAt
      }
    });
  } catch (error) {
    console.error('Error updating order status:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update order status'
    });
  }
};