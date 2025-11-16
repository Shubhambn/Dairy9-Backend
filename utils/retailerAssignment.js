// C:\Users\Krishna\OneDrive\Desktop\backend-dairy9\Dairy9-Backend\utils\retailerAssignment.js

import Admin from "../models/admin.model.js";
import { calculateDistance, validateCoordinates } from "./locationUtils.js";

/**
 * Find and return the nearest active retailer within their serviceRadius.
 * Returns: { retailer, distance } or null
 */
export async function assignNearestRetailer(customerLat, customerLon) {
  if (!validateCoordinates(customerLat, customerLon)) {
    return null;
  }

  // Fetch active retailers that have coordinates
  const retailers = await Admin.find({
    isActive: true,
    "location.coordinates.latitude": { $ne: null },
    "location.coordinates.longitude": { $ne: null }
  }).lean();

  if (!retailers || retailers.length === 0) return null;

  let nearest = null;
  let minDistance = Infinity;

  for (const r of retailers) {
    const rLat = r.location?.coordinates?.latitude;
    const rLon = r.location?.coordinates?.longitude;

    if (!validateCoordinates(rLat, rLon)) continue;

    const distance = calculateDistance(customerLat, customerLon, rLat, rLon);

    // Check retailer's own service radius
    const serviceRadius = typeof r.serviceRadius === "number" ? r.serviceRadius : 50;

    if (distance <= serviceRadius && distance < minDistance) {
      minDistance = distance;
      nearest = r;
    }
  }

  if (!nearest) return null;

  return { retailer: nearest, distance: minDistance };
}
