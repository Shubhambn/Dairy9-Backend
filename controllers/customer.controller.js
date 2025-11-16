// controllers/customer.controller.js
import Customer from '../models/customer.model.js';
import User from '../models/user.model.js';
import Admin from '../models/admin.model.js';
import RetailerInventory from '../models/retailerInventory.model.js'; // <- ADDED
import { assignNearestRetailer } from '../utils/retailerAssignment.js';
import { validateCoordinates } from '../utils/locationUtils.js';

// Create or Update Customer Profile
export const createUpdateProfile = async (req, res) => {
  try {
    const userId = req.user?.id || req.user?._id;
    const { personalInfo, deliveryAddress } = req.body;

    // Convert empty strings to null for date fields and validate date
    const processedPersonalInfo = { ...personalInfo };
    if (processedPersonalInfo.dateOfBirth && processedPersonalInfo.dateOfBirth.trim() !== '') {
      const date = new Date(processedPersonalInfo.dateOfBirth);
      processedPersonalInfo.dateOfBirth = isNaN(date.getTime()) ? null : date;
    } else {
      processedPersonalInfo.dateOfBirth = null;
    }

    let customer = await Customer.findOne({ user: userId });

    if (customer) {
      // Update existing profile
      customer.personalInfo = { ...customer.personalInfo, ...processedPersonalInfo };
      customer.deliveryAddress = { ...customer.deliveryAddress, ...deliveryAddress };
    } else {
      // Create new profile
      customer = new Customer({
        user: userId,
        personalInfo: processedPersonalInfo,
        deliveryAddress
      });
    }

    // Ensure coordinates is always present in deliveryAddress
    if (!customer.deliveryAddress) customer.deliveryAddress = {};
    if (!customer.deliveryAddress.coordinates) {
      customer.deliveryAddress.coordinates = { latitude: null, longitude: null };
    }

    await customer.save();

    // Link customer profile to user
    await User.findByIdAndUpdate(userId, { customerProfile: customer._id });

    // If coordinates provided, try assigning nearest retailer (Admin as retailer)
    const coords = customer.deliveryAddress?.coordinates;
    if (coords && typeof coords.latitude === 'number' && typeof coords.longitude === 'number') {
      try {
        const result = await assignNearestRetailer(coords.latitude, coords.longitude);
        if (result?.retailer) {
          customer.assignedRetailer = result.retailer._id; // Admin document _id
          customer.assignedOn = new Date();
          await customer.save();
          console.log('✅ Retailer auto-assigned on profile save:', result.retailer.shopName);
        } else {
          console.log('⚠ No retailer found when saving profile');
        }
      } catch (err) {
        console.error('Error assigning retailer on profile save:', err);
      }
    }

    res.status(200).json({
      message: 'Profile saved successfully',
      customer
    });
  } catch (error) {
    console.error('createUpdateProfile error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// Get Customer Profile
export const getProfile = async (req, res) => {
  try {
    let customer = await Customer.findOne({ user: req.user._id })
      .populate('user', 'phone')
      .populate('assignedRetailer', 'shopName location serviceRadius');

    if (!customer) {
      // Create a default profile structure if none exists
      customer = new Customer({
        user: req.user._id,
        personalInfo: {
          fullName: '',
          email: '',
          alternatePhone: '',
          dateOfBirth: null
        },
        deliveryAddress: {
          addressLine1: '',
          addressLine2: '',
          city: '',
          state: '',
          pincode: '',
          landmark: '',
          coordinates: {
            latitude: null,
            longitude: null
          },
          formattedAddress: ''
        },
        orderHistory: [],
        walletBalance: 0
      });

      await customer.save();

      // Link customer profile to user
      await User.findByIdAndUpdate(req.user._id, { customerProfile: customer._id });
    }

    res.status(200).json(customer);
  } catch (error) {
    console.error('getProfile error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// Add Order to Customer History
export const addOrder = async (req, res) => {
  try {
    const { products, totalAmount } = req.body;

    const customer = await Customer.findOne({ user: req.user._id });
    if (!customer) return res.status(404).json({ message: 'Customer profile not found' });

    const newOrder = {
      orderId: 'ORD' + Date.now(),
      products,
      totalAmount,
      status: 'pending'
    };

    customer.orderHistory.push(newOrder);
    await customer.save();

    res.status(201).json({
      message: 'Order added successfully',
      order: newOrder
    });
  } catch (error) {
    console.error('addOrder error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// Update customer delivery address
export const updateDeliveryAddress = async (req, res) => {
  try {
    const userId = req.user._id;
    const { deliveryAddress } = req.body;

    if (!deliveryAddress) {
      return res.status(400).json({
        success: false,
        message: 'Delivery address is required'
      });
    }

    // Validate required fields
    if (!deliveryAddress.addressLine1 || !deliveryAddress.city || !deliveryAddress.state || !deliveryAddress.pincode) {
      return res.status(400).json({
        success: false,
        message: 'Address line 1, city, state, and pincode are required'
      });
    }

    const customer = await Customer.findOne({ user: userId });
    if (!customer) {
      return res.status(404).json({
        success: false,
        message: 'Customer profile not found'
      });
    }

    // Update delivery address
    customer.deliveryAddress = {
      ...customer.deliveryAddress,
      ...deliveryAddress
    };

    await customer.save();

    // Try reassigning retailer when address has coordinates
    const coords = customer.deliveryAddress?.coordinates;
    if (coords && typeof coords.latitude === 'number' && typeof coords.longitude === 'number') {
      try {
        const result = await assignNearestRetailer(coords.latitude, coords.longitude);
        if (result?.retailer) {
          customer.assignedRetailer = result.retailer._id; // Admin doc id
          customer.assignedOn = new Date();
          await customer.save();
          console.log('🔄 Retailer reassigned on address update:', result.retailer.shopName);
        } else {
          console.log('⚠ No retailer found in new address area');
        }
      } catch (err) {
        console.error('Error while reassigning retailer on address update:', err);
      }
    }

    res.status(200).json({
      success: true,
      message: 'Delivery address updated successfully',
      deliveryAddress: customer.deliveryAddress
    });
  } catch (error) {
    console.error('updateDeliveryAddress error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

// Add coordinates to customer address
export const addAddressCoordinates = async (req, res) => {
  try {
    const userId = req.user._id;
    const { latitude, longitude } = req.body;

    if (latitude === undefined || longitude === undefined) {
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

    const customer = await Customer.findOne({ user: userId });
    if (!customer) {
      return res.status(404).json({
        success: false,
        message: 'Customer profile not found'
      });
    }

    if (!customer.deliveryAddress) {
      return res.status(400).json({
        success: false,
        message: 'Please set a delivery address first'
      });
    }

    // Update coordinates
    customer.deliveryAddress.coordinates = {
      latitude,
      longitude
    };

    await customer.save();

    // Assign nearest retailer immediately
    try {
      const result = await assignNearestRetailer(latitude, longitude);
      if (result?.retailer) {
        customer.assignedRetailer = result.retailer._id;
        customer.assignedOn = new Date();
        await customer.save();
        console.log('✅ Retailer assigned on coordinates add:', result.retailer.shopName);
      } else {
        console.log('⚠ No retailer found for provided coordinates');
      }
    } catch (err) {
      console.error('Error assigning retailer on coordinates add:', err);
    }

    res.status(200).json({
      success: true,
      message: 'Address coordinates updated successfully',
      deliveryAddress: customer.deliveryAddress
    });
  } catch (error) {
    console.error('addAddressCoordinates error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

// Get Order History
export const getOrderHistory = async (req, res) => {
  try {
    const customer = await Customer.findOne({ user: req.user._id });
    if (!customer) return res.status(404).json({ message: 'Customer profile not found' });

    res.status(200).json(customer.orderHistory);
  } catch (error) {
    console.error('getOrderHistory error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

export async function assignRetailerForCustomer(req, res) {
  try {
    const userId = req.user?.id || req.user?._id;
    const { lat, lng, address, temporary = true } = req.body;

    const customer = await Customer.findOne({ user: userId });
    if (!customer) {
      return res.status(404).json({ success: false, message: "Customer profile not found" });
    }

    // If coordinates provided -> find nearest retailer (Admin model)
    let nearestRetailer = null;
    let distance = null;
    if (typeof lat === "number" && typeof lng === "number") {
      const result = await assignNearestRetailer(lat, lng);
      if (result && result.retailer) {
        nearestRetailer = result.retailer;
        distance = result.distance;
      }
    }

    // If no coords or no nearby retailer found -> fallback to assignedRetailer or any active admin/retailer
    if (!nearestRetailer) {
      if (customer.assignedRetailer) {
        nearestRetailer = await Admin.findById(customer.assignedRetailer).lean();
      } else {
        nearestRetailer = await Admin.findOne({ isActive: true }).lean();
      }
    }

    if (!nearestRetailer) {
      return res.status(404).json({ success: false, message: "No active retailer found" });
    }

    // Save current location when coords provided
    if (typeof lat === "number" && typeof lng === "number") {
      customer.currentLocation = {
        coordinates: { latitude: lat, longitude: lng },
        formattedAddress: address || customer.currentLocation?.formattedAddress || "",
        updatedAt: new Date(),
      };
    }

    // Set currentRetailer (temporary override)
    customer.currentRetailer = nearestRetailer._id;

    // If temporary=false => persist to assignedRetailer (home)
    if (!temporary) {
      customer.assignedRetailer = nearestRetailer._id;
      customer.assignedOn = new Date();
    }

    await customer.save();

    // Fetch inventory for this retailer
    const inventory = await RetailerInventory.find({
      retailer: nearestRetailer._id,
      isActive: true
    }).populate("product").lean();

    return res.json({
      success: true,
      temporary: !!temporary,
      distance,
      retailer: {
        _id: nearestRetailer._id,
        shopName: nearestRetailer.shopName,
        address: nearestRetailer.address,
        location: nearestRetailer.location,
        serviceRadius: nearestRetailer.serviceRadius
      },
      inventory,
    });

  } catch (err) {
    console.error("assignRetailerForCustomer error:", err);
    return res.status(500).json({ success: false, message: "Server error", error: err.message });
  }
}

/**
 * GET /api/customer/inventory
 * Optional query ?assignUsingCoords=true to attempt auto-assign using stored currentLocation
 */
export const getCustomerInventory = async (req, res) => {
  try {
    const userId = req.user?.id || req.user?._id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });

    const customer = await Customer.findOne({ user: userId }).lean();
    if (!customer) return res.json({ success: true, data: { inventory: [] } });

    // If client requested auto-assign using stored currentLocation and customer has it
    if (!customer.assignedRetailer && customer.currentLocation?.coordinates?.latitude && req.query?.assignUsingCoords === "true") {
      try {
        const lat = customer.currentLocation.coordinates.latitude;
        const lng = customer.currentLocation.coordinates.longitude;
        const result = await assignNearestRetailer(lat, lng);
        if (result?.retailer) {
          await Customer.updateOne({ user: userId }, {
            $set: {
              assignedRetailer: result.retailer._id,
              assignedOn: new Date()
            }
          });
          customer.assignedRetailer = result.retailer._id;
        }
      } catch(e) {
        console.warn("Auto-assign using stored coords failed", e);
      }
    }

    // Prefer currentRetailer (temporary) over assignedRetailer (home)
    const retailerId = customer.currentRetailer || customer.assignedRetailer;
    if (!retailerId) {
      console.log("⚠ No retailer assigned for customer");
      return res.json({ success: true, data: { inventory: [] } });
    }

    const inventory = await RetailerInventory.find({
      retailer: retailerId,
      isActive: true
    })
      .populate({
        path: "product",
        select: "_id id name price discountedPrice barcodeId sku image unit unitSize isAvailable"
      })
      .lean();

    // Fetch retailer info (Admin)
    const retailerDoc = await Admin.findById(retailerId).select('shopName address location serviceRadius').lean();

    return res.json({
      success: true,
      retailer: retailerDoc || null,
      data: { inventory }
    });

  } catch (err) {
    console.error("getCustomerInventory error:", err);
    return res.status(500).json({ success: false, message: "Server error", error: err.message });
  }
};
