import Customer from "../models/customer.model.js";
import Admin from "../models/admin.model.js";
import { assignNearestRetailer } from "../utils/retailerAssignment.js";

export const updateCurrentLocation = async (req, res) => {
  try {
    const userId = req.user._id;
    const { latitude, longitude, formattedAddress } = req.body;

    if (!latitude || !longitude) {
      return res.status(400).json({
        success: false,
        message: "Latitude and longitude required"
      });
    }

    const customer = await Customer.findOne({ user: userId });
    if (!customer) {
      return res.status(404).json({ success: false, message: "Customer not found" });
    }

    // Save current location
    customer.currentLocation = {
      coordinates: { latitude, longitude },
      formattedAddress: formattedAddress || "",
      updatedAt: new Date()
    };

    // Assign nearest retailer
    const result = await assignNearestRetailer(latitude, longitude);

    if (result?.retailer) {
      customer.currentRetailer = result.retailer._id;
    }

    await customer.save();

    res.status(200).json({
      success: true,
      message: "Current location updated and retailer assigned",
      retailer: result?.retailer || null,
      distance: result?.distance || null
    });

  } catch (err) {
    console.error("Update current location failed:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};
