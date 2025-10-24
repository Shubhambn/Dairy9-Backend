// Utility functions for location-based operations

/**
 * Calculate distance between two coordinates using Haversine formula
 * @param {number} lat1 - Latitude of first point
 * @param {number} lon1 - Longitude of first point
 * @param {number} lat2 - Latitude of second point
 * @param {number} lon2 - Longitude of second point
 * @returns {number} Distance in kilometers
 */
export function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371; // Earth's radius in kilometers
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  
  const a = 
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const distance = R * c;
  
  return distance;
}

/**
 * Convert degrees to radians
 * @param {number} degrees - Degrees to convert
 * @returns {number} Radians
 */
function toRadians(degrees) {
  return degrees * (Math.PI / 180);
}

/**
 * Find retailers within specified radius of customer location
 * @param {number} customerLat - Customer latitude
 * @param {number} customerLon - Customer longitude
 * @param {Array} retailers - Array of retailer objects with location data
 * @param {number} maxRadius - Maximum radius in kilometers (default: 50)
 * @returns {Array} Array of retailers within radius, sorted by distance
 */
export function findNearbyRetailers(customerLat, customerLon, retailers, maxRadius = 50) {
  const nearbyRetailers = [];
  
  for (const retailer of retailers) {
    if (!retailer.location || !retailer.location.coordinates) {
      continue;
    }
    
    const distance = calculateDistance(
      customerLat,
      customerLon,
      retailer.location.coordinates.latitude,
      retailer.location.coordinates.longitude
    );
    
    // Check if retailer is within their service radius and customer is within max radius
    if (distance <= Math.min(retailer.serviceRadius || 50, maxRadius)) {
      nearbyRetailers.push({
        ...retailer,
        distance: Math.round(distance * 100) / 100 // Round to 2 decimal places
      });
    }
  }
  
  // Sort by distance (closest first)
  return nearbyRetailers.sort((a, b) => a.distance - b.distance);
}

/**
 * Get the closest retailer to customer location
 * @param {number} customerLat - Customer latitude
 * @param {number} customerLon - Customer longitude
 * @param {Array} retailers - Array of retailer objects with location data
 * @param {number} maxRadius - Maximum radius in kilometers (default: 50)
 * @returns {Object|null} Closest retailer or null if none found
 */
export function getClosestRetailer(customerLat, customerLon, retailers, maxRadius = 50) {
  const nearbyRetailers = findNearbyRetailers(customerLat, customerLon, retailers, maxRadius);
  return nearbyRetailers.length > 0 ? nearbyRetailers[0] : null;
}

/**
 * Validate coordinates
 * @param {number} latitude - Latitude to validate
 * @param {number} longitude - Longitude to validate
 * @returns {boolean} True if coordinates are valid
 */
export function validateCoordinates(latitude, longitude) {
  return (
    typeof latitude === 'number' &&
    typeof longitude === 'number' &&
    latitude >= -90 &&
    latitude <= 90 &&
    longitude >= -180 &&
    longitude <= 180
  );
}
