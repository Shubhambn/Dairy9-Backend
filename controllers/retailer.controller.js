// Retailer-specific controller functions

import Admin from '../models/admin.model.js';
import Order from '../models/order.model.js';
import { geocodeAddress, reverseGeocode, extractAddressComponents } from '../services/googleMapsService.js';

// @desc    Update retailer service radius
// @route   PUT /api/admin/retailer/radius
// @access  Private (Admin)
export const updateServiceRadius = async (req, res) => {
  try {
    const { radius } = req.body;
    const adminId = req.user.adminProfile;

    if (!radius || radius < 1 || radius > 100) {
      return res.status(400).json({
        success: false,
        message: 'Service radius must be between 1 and 100 kilometers'
      });
    }

    const admin = await Admin.findByIdAndUpdate(
      adminId,
      { serviceRadius: radius },
      { new: true }
    );

    if (!admin) {
      return res.status(404).json({
        success: false,
        message: 'Retailer profile not found'
      });
    }

    res.json({
      success: true,
      message: 'Service radius updated successfully',
      data: { serviceRadius: admin.serviceRadius }
    });
  } catch (error) {
    console.error('Update Service Radius Error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

// @desc    Update retailer location
// @route   PUT /api/admin/retailer/location
// @access  Private (Admin)
export const updateLocation = async (req, res) => {
  try {
    const { address, coordinates } = req.body;
    const adminId = req.user.adminProfile;

    if (!address && !coordinates) {
      return res.status(400).json({
        success: false,
        message: 'Address or coordinates are required'
      });
    }

    let locationData = null;

    if (coordinates && coordinates.latitude && coordinates.longitude) {
      // Use provided coordinates
      const reverseGeocodeResult = await reverseGeocode(coordinates.latitude, coordinates.longitude);
      if (reverseGeocodeResult) {
        locationData = {
          coordinates: {
            latitude: coordinates.latitude,
            longitude: coordinates.longitude
          },
          formattedAddress: reverseGeocodeResult.formatted_address,
          addressComponents: extractAddressComponents(reverseGeocodeResult.address_components)
        };
      }
    } else if (address) {
      // Geocode the provided address
      const geocodeResult = await geocodeAddress(address);
      if (geocodeResult) {
        locationData = {
          coordinates: {
            latitude: geocodeResult.latitude,
            longitude: geocodeResult.longitude
          },
          formattedAddress: geocodeResult.formattedAddress,
          addressComponents: extractAddressComponents(geocodeResult.addressComponents)
        };
      }
    }

    if (!locationData) {
      return res.status(400).json({
        success: false,
        message: 'Unable to determine location from provided data'
      });
    }

    const updateData = {
      location: {
        coordinates: locationData.coordinates,
        formattedAddress: locationData.formattedAddress
      }
    };

    // Add address components if available
    if (locationData.addressComponents.city) {
      updateData.location.city = locationData.addressComponents.city;
    }
    if (locationData.addressComponents.state) {
      updateData.location.state = locationData.addressComponents.state;
    }
    if (locationData.addressComponents.pincode) {
      updateData.location.pincode = locationData.addressComponents.pincode;
    }

    const admin = await Admin.findByIdAndUpdate(
      adminId,
      updateData,
      { new: true }
    );

    if (!admin) {
      return res.status(404).json({
        success: false,
        message: 'Retailer profile not found'
      });
    }

    res.json({
      success: true,
      message: 'Location updated successfully',
      data: { location: admin.location }
    });
  } catch (error) {
    console.error('Update Location Error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

// @desc    Get retailer's assigned orders
// @route   GET /api/admin/retailer/orders
// @access  Private (Admin)
export const getRetailerOrders = async (req, res) => {
  try {
    const adminId = req.user.adminProfile;
    const { page = 1, limit = 10, status } = req.query;

    const filter = { assignedRetailer: adminId };
    if (status && status !== 'all') {
      filter.orderStatus = status;
    }

    const orders = await Order.find(filter)
      .populate('customer', 'personalInfo.fullName')
      .populate('items.product', 'name image unit')
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await Order.countDocuments(filter);

    res.json({
      success: true,
      orders,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(total / limit),
        totalOrders: total
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

// @desc    Get retailer profile
// @route   GET /api/admin/retailer/profile
// @access  Private (Admin)
export const getRetailerProfile = async (req, res) => {
  try {
    const adminId = req.user.adminProfile;

    const admin = await Admin.findById(adminId);
    if (!admin) {
      return res.status(404).json({
        success: false,
        message: 'Retailer profile not found'
      });
    }

    res.json({
      success: true,
      data: admin
    });
  } catch (error) {
    console.error('Get Retailer Profile Error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};
