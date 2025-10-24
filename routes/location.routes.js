// Location-related routes for Google Maps integration

import { Router } from 'express';
import { 
  geocodeAddress, 
  reverseGeocode, 
  getPlaceSuggestions, 
  getPlaceDetails 
} from '../services/googleMapsService.js';

const router = Router();

// @route   POST /api/location/geocode
// @desc    Get coordinates from address
// @access  Public
router.post('/geocode', async (req, res) => {
  try {
    const { address } = req.body;
    
    if (!address) {
      return res.status(400).json({
        success: false,
        message: 'Address is required'
      });
    }

    const result = await geocodeAddress(address);
    
    if (!result) {
      return res.status(400).json({
        success: false,
        message: 'Unable to geocode the provided address'
      });
    }

    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    console.error('Geocode error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @route   POST /api/location/reverse-geocode
// @desc    Get address from coordinates
// @access  Public
router.post('/reverse-geocode', async (req, res) => {
  try {
    const { latitude, longitude } = req.body;
    
    if (!latitude || !longitude) {
      return res.status(400).json({
        success: false,
        message: 'Latitude and longitude are required'
      });
    }

    const result = await reverseGeocode(latitude, longitude);
    
    if (!result) {
      return res.status(400).json({
        success: false,
        message: 'Unable to reverse geocode the provided coordinates'
      });
    }

    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    console.error('Reverse geocode error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @route   GET /api/location/suggestions
// @desc    Get place suggestions for autocomplete
// @access  Public
router.get('/suggestions', async (req, res) => {
  try {
    const { input, location } = req.query;
    
    if (!input) {
      return res.status(400).json({
        success: false,
        message: 'Input is required'
      });
    }

    const suggestions = await getPlaceSuggestions(input, location);
    
    res.json({
      success: true,
      data: suggestions
    });
  } catch (error) {
    console.error('Suggestions error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @route   GET /api/location/place-details
// @desc    Get place details by place ID
// @access  Public
router.get('/place-details', async (req, res) => {
  try {
    const { placeId } = req.query;
    
    if (!placeId) {
      return res.status(400).json({
        success: false,
        message: 'Place ID is required'
      });
    }

    const details = await getPlaceDetails(placeId);
    
    if (!details) {
      return res.status(400).json({
        success: false,
        message: 'Unable to get place details'
      });
    }

    res.json({
      success: true,
      data: details
    });
  } catch (error) {
    console.error('Place details error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

export default router;
