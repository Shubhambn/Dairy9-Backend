// controllers/customer.controller.js
import Customer from '../models/customer.model.js';
import User from '../models/user.model.js';
import Admin from '../models/admin.model.js';
import RetailerInventory from '../models/retailerInventory.model.js'; // <- ADDED
import { assignNearestRetailer } from '../utils/retailerAssignment.js';
import { validateCoordinates } from '../utils/locationUtils.js';

// Create or Update Customer Profile
// export const createUpdateProfile 
export const createUpdateProfile = async (req, res) => {
  try {
    const userId = req.user?.id || req.user?._id;
    const { personalInfo, deliveryAddress } = req.body;

    // Process DOB
    const processedPersonalInfo = { ...personalInfo };
    if (processedPersonalInfo.dateOfBirth && processedPersonalInfo.dateOfBirth.trim() !== "") {
      const date = new Date(processedPersonalInfo.dateOfBirth);
      processedPersonalInfo.dateOfBirth = isNaN(date.getTime()) ? null : date;
    } else {
      processedPersonalInfo.dateOfBirth = null;
    }

    // Check if customer profile already exists
    const existingProfile = await Customer.findOne({ user: userId });

    if (existingProfile) {
      return res.status(400).json({
        message: "Profile already exists. Update is not allowed."
      });
    }

    // Create new customer profile
    const customer = new Customer({
      user: userId,
      personalInfo: processedPersonalInfo,
      deliveryAddress: {
        ...deliveryAddress,
        coordinates: deliveryAddress?.coordinates || {
          latitude: null,
          longitude: null
        }
      }
    });

    await customer.save();

    // Link to User
    await User.findByIdAndUpdate(userId, { customerProfile: customer._id });

    // Auto assign retailer if coordinates exist
    await autoAssignRetailer(customer);

    return res.status(201).json({
      message: "Profile created successfully",
      customer
    });

  } catch (error) {
    console.error("createUserProfile error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};


// ------------------------------
// Retailer assignment helper
// ------------------------------
const autoAssignRetailer = async (customer) => {
  try {
    const coords = customer.deliveryAddress?.coordinates;

    if (
      coords &&
      typeof coords.latitude === "number" &&
      typeof coords.longitude === "number"
    ) {
      const result = await assignNearestRetailer(coords.latitude, coords.longitude);

      if (result?.retailer) {
        customer.assignedRetailer = result.retailer._id;
        customer.assignedOn = new Date();
        await customer.save();

        console.log("✅ Retailer auto-assigned:", result.retailer.shopName);
      }
    }
  } catch (err) {
    console.error("Retailer assignment error:", err);
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
    const { lat, lng, address, temporary = true, useCached = false } = req.body;

    const customer = await Customer.findOne({ user: userId });
    if (!customer) {
      return res.status(404).json({ success: false, message: "Customer profile not found" });
    }

    // NEW: Check if client wants to use cached retailer
    if (useCached && customer.currentRetailer) {
      const cachedRetailer = await Admin.findById(customer.currentRetailer).lean();
      if (cachedRetailer) {
        const inventory = await RetailerInventory.find({
          retailer: cachedRetailer._id,
          isActive: true
        }).populate("product").lean();

        return res.json({
          success: true,
          cached: true, // flag to indicate cached data
          temporary: true,
          retailer: {
            _id: cachedRetailer._id,
            shopName: cachedRetailer.shopName,
            address: cachedRetailer.address,
            location: cachedRetailer.location,
            serviceRadius: cachedRetailer.serviceRadius
          },
          inventory,
        });
      }
    }

    // Existing logic for new retailer assignment
    let nearestRetailer = null;
    let distance = null;
    if (typeof lat === "number" && typeof lng === "number") {
      const result = await assignNearestRetailer(lat, lng);
      if (result && result.retailer) {
        nearestRetailer = result.retailer;
        distance = result.distance;
      }
    }

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

    // Save location and retailer
    if (typeof lat === "number" && typeof lng === "number") {
      customer.currentLocation = {
        coordinates: { latitude: lat, longitude: lng },
        formattedAddress: address || customer.currentLocation?.formattedAddress || "",
        updatedAt: new Date(),
      };
    }

    // ALWAYS update currentRetailer (session retailer)
    customer.currentRetailer = nearestRetailer._id;

    if (!temporary) {
      customer.assignedRetailer = nearestRetailer._id;
      customer.assignedOn = new Date();
    }

    await customer.save();

    const inventory = await RetailerInventory.find({
      retailer: nearestRetailer._id,
      isActive: true
    }).populate("product").lean();

    return res.json({
      success: true,
      cached: false,
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
