// Google Maps API service for geocoding and reverse geocoding

const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY || 'AIzaSyDf1vfB2AGpVCGh1fdwB5mMZ-ClAnYh0ic';

/**
 * Get coordinates from address using Google Geocoding API
 * @param {string} address - Address to geocode
 * @returns {Object} { latitude, longitude, formattedAddress } or null if failed
 */
export async function geocodeAddress(address) {
  try {
    const encodedAddress = encodeURIComponent(address);
    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodedAddress}&key=${GOOGLE_MAPS_API_KEY}`;
    
    const response = await fetch(url);
    const data = await response.json();
    
    if (data.status === 'OK' && data.results.length > 0) {
      const result = data.results[0];
      const location = result.geometry.location;
      
      return {
        latitude: location.lat,
        longitude: location.lng,
        formattedAddress: result.formatted_address,
        addressComponents: result.address_components
      };
    }
    
    console.error('Geocoding failed:', data.status, data.error_message);
    return null;
  } catch (error) {
    console.error('Geocoding error:', error);
    return null;
  }
}

/**
 * Get address from coordinates using Google Reverse Geocoding API
 * @param {number} latitude - Latitude
 * @param {number} longitude - Longitude
 * @returns {Object} { formattedAddress, addressComponents } or null if failed
 */
export async function reverseGeocode(latitude, longitude) {
  try {
    const url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${latitude},${longitude}&key=${GOOGLE_MAPS_API_KEY}`;
    
    const response = await fetch(url);
    const data = await response.json();
    
    if (data.status === 'OK' && data.results.length > 0) {
      const result = data.results[0];
      
      return {
        formattedAddress: result.formatted_address,
        addressComponents: result.address_components
      };
    }
    
    console.error('Reverse geocoding failed:', data.status, data.error_message);
    return null;
  } catch (error) {
    console.error('Reverse geocoding error:', error);
    return null;
  }
}

/**
 * Get place suggestions for autocomplete
 * @param {string} input - User input
 * @param {string} location - Optional location bias (lat,lng)
 * @returns {Array} Array of place suggestions
 */
export async function getPlaceSuggestions(input, location = null) {
  try {
    let url = `https://maps.googleapis.com/maps/api/place/autocomplete/json?input=${encodeURIComponent(input)}&key=${GOOGLE_MAPS_API_KEY}`;
    
    if (location) {
      url += `&location=${location}&radius=50000`; // 50km radius
    }
    
    const response = await fetch(url);
    const data = await response.json();
    
    if (data.status === 'OK') {
      return data.predictions.map(prediction => ({
        placeId: prediction.place_id,
        description: prediction.description,
        mainText: prediction.structured_formatting?.main_text || prediction.description,
        secondaryText: prediction.structured_formatting?.secondary_text || ''
      }));
    }
    
    console.error('Place suggestions failed:', data.status, data.error_message);
    return [];
  } catch (error) {
    console.error('Place suggestions error:', error);
    return [];
  }
}

/**
 * Get place details by place ID
 * @param {string} placeId - Google Place ID
 * @returns {Object} Place details or null if failed
 */
export async function getPlaceDetails(placeId) {
  try {
    const fields = 'place_id,formatted_address,geometry,address_components,name';
    const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=${fields}&key=${GOOGLE_MAPS_API_KEY}`;
    
    const response = await fetch(url);
    const data = await response.json();
    
    if (data.status === 'OK' && data.result) {
      const result = data.result;
      const location = result.geometry.location;
      
      return {
        placeId: result.place_id,
        name: result.name,
        formattedAddress: result.formatted_address,
        latitude: location.lat,
        longitude: location.lng,
        addressComponents: result.address_components
      };
    }
    
    console.error('Place details failed:', data.status, data.error_message);
    return null;
  } catch (error) {
    console.error('Place details error:', error);
    return null;
  }
}

/**
 * Extract address components from Google Maps response
 * @param {Array} addressComponents - Address components from Google Maps
 * @returns {Object} Structured address components
 */
export function extractAddressComponents(addressComponents) {
  const components = {};
  
  for (const component of addressComponents) {
    const types = component.types;
    
    if (types.includes('locality')) {
      components.city = component.long_name;
    } else if (types.includes('administrative_area_level_1')) {
      components.state = component.long_name;
    } else if (types.includes('postal_code')) {
      components.pincode = component.long_name;
    } else if (types.includes('country')) {
      components.country = component.long_name;
    }
  }
  
  return components;
}
