// services/openFoodFacts.service.js

import axios from 'axios';
import { v2 as cloudinary } from 'cloudinary';
import { uploadToCloudinary } from '../utils/cloudinaryUpload.js';

class OpenFoodFactsService {
  constructor() {
    this.baseURL = 'https://world.openfoodfacts.org/api/v0';
    this.rateLimitDelay = 1000; // 1 second between requests
  }

  /**
   * Get product data from OpenFoodFacts API
   */
  async getProductByBarcode(barcode) {
    try {
      console.log(`🔍 Searching OpenFoodFacts for barcode: ${barcode}`);
      
      const response = await axios.get(`${this.baseURL}/product/${barcode}.json`, {
        timeout: 10000,
        headers: {
          'User-Agent': 'Dairy9-App/1.0 - Local Development'
        }
      });

      console.log('📊 OpenFoodFacts API Response Status:', response.status);
      
      if (response.status === 404 || !response.data.product) {
        return {
          found: false,
          barcode: barcode,
          message: 'Product not found in OpenFoodFacts database'
        };
      }

      const productData = response.data.product;
      
      // Extract and transform the data
      const transformedData = this.transformProductData(productData, barcode);
      
      console.log('✅ Successfully transformed OpenFoodFacts data');
      return transformedData;

    } catch (error) {
      console.error('❌ OpenFoodFacts API error:', error.message);
      
      if (error.response?.status === 404) {
        return {
          found: false,
          barcode: barcode,
          message: 'Product not found in OpenFoodFacts database'
        };
      }
      
      if (error.code === 'ECONNABORTED') {
        throw new Error('OpenFoodFacts API request timeout');
      }
      
      throw new Error(`Failed to fetch product data: ${error.message}`);
    }
  }

  /**
   * Transform OpenFoodFacts API response to our format
   */
  transformProductData(productData, barcode) {
    try {
      const images = this.extractImages(productData);
      const categories = this.extractCategories(productData);
      const labels = this.extractLabels(productData);
      const nutritionalInfo = this.extractNutritionalInfo(productData);
      const { unit, unitSize } = this.extractUnitAndSize(productData.quantity);

      return {
        found: true,
        barcode: barcode,
        name: productData.product_name || productData.product_name_en || '',
        description: productData.generic_name || productData.generic_name_en || '',
        brand: productData.brands || productData.brand_owner || '',
        categories: categories,
        quantity: productData.quantity || '',
        unit: unit,
        unitSize: unitSize,
        images: images,
        labels: labels,
        nutritionalInfo: nutritionalInfo,
        rawData: productData // Keep original data for debugging
      };
    } catch (error) {
      console.error('Error transforming product data:', error);
      throw new Error(`Data transformation failed: ${error.message}`);
    }
  }

  /**
   * Extract product images from OpenFoodFacts data
   */
  extractImages(productData) {
    const images = [];
    
    // Main product image
    if (productData.image_url) {
      images.push({
        type: 'front',
        url: productData.image_url,
        size: 'original'
      });
    }
    
    // Additional images
    if (productData.image_front_url) {
      images.push({
        type: 'front',
        url: productData.image_front_url,
        size: 'front'
      });
    }
    
    if (productData.image_ingredients_url) {
      images.push({
        type: 'ingredients',
        url: productData.image_ingredients_url,
        size: 'ingredients'
      });
    }
    
    if (productData.image_nutrition_url) {
      images.push({
        type: 'nutrition',
        url: productData.image_nutrition_url,
        size: 'nutrition'
      });
    }

    return images;
  }

  /**
   * Extract categories from product data
   */
  extractCategories(productData) {
    const categories = [];
    
    if (productData.categories) {
      // Split categories string and clean them up
      categories.push(...productData.categories.split(',').map(cat => cat.trim()).filter(cat => cat));
    }
    
    if (productData.categories_tags && productData.categories_tags.length > 0) {
      // Add category tags (remove language prefixes)
      productData.categories_tags.forEach(tag => {
        const cleanTag = tag.replace(/^[a-z]{2,3}:/, '').replace(/-/g, ' ');
        if (cleanTag && !categories.includes(cleanTag)) {
          categories.push(cleanTag);
        }
      });
    }

    return categories.slice(0, 5); // Return max 5 categories
  }

  /**
   * Extract labels/certifications from product data
   */
  extractLabels(productData) {
    const labels = [];
    
    // Extract from labels field
    if (productData.labels) {
      labels.push(...productData.labels.split(',').map(label => label.trim()).filter(label => label));
    }
    
    // Extract from certifications
    if (productData.certifications) {
      labels.push(...productData.certifications.split(',').map(cert => cert.trim()).filter(cert => cert));
    }
    
    // Extract from labels_tags
    if (productData.labels_tags && productData.labels_tags.length > 0) {
      productData.labels_tags.forEach(tag => {
        const cleanLabel = tag.replace(/^[a-z]{2,3}:/, '').replace(/-/g, ' ');
        if (cleanLabel && !labels.includes(cleanLabel)) {
          labels.push(cleanLabel);
        }
      });
    }

    // Add some common dairy-related labels
    const dairyKeywords = ['organic', 'pasteurized', 'homogenized', 'fresh', 'natural', 'premium'];
    dairyKeywords.forEach(keyword => {
      const productString = JSON.stringify(productData).toLowerCase();
      if (productString.includes(keyword) && !labels.includes(keyword)) {
        labels.push(keyword);
      }
    });

    return labels.slice(0, 10); // Return max 10 labels
  }

  /**
   * Extract nutritional information
   */
  extractNutritionalInfo(productData) {
    const nutriments = productData.nutriments || {};
    
    return {
      fat: nutriments.fat_100g?.toString() || '',
      protein: nutriments.proteins_100g?.toString() || '',
      calories: nutriments.energy_100g?.toString() || '',
      carbohydrates: nutriments.carbohydrates_100g?.toString() || '',
      sugar: nutriments.sugars_100g?.toString() || '',
      fiber: nutriments.fiber_100g?.toString() || '',
      sodium: nutriments.sodium_100g?.toString() || '',
      salt: nutriments.salt_100g?.toString() || ''
    };
  }

  /**
   * Extract unit and size from quantity string
   */
  extractUnitAndSize(quantity) {
    if (!quantity) {
      return { unit: 'piece', unitSize: '1' };
    }

    const quantityLower = quantity.toLowerCase();
    
    // Extract unit
    let unit = 'piece';
    if (quantityLower.includes('ml') || quantityLower.includes('milliliter')) {
      unit = 'ml';
    } else if (quantityLower.includes('l') || quantityLower.includes('liter')) {
      unit = 'liter';
    } else if (quantityLower.includes('g') || quantityLower.includes('gram')) {
      unit = 'gm';
    } else if (quantityLower.includes('kg')) {
      unit = 'kg';
    } else if (quantityLower.includes('pack') || quantityLower.includes('pouch')) {
      unit = 'pack';
    }

    // Extract size
    let unitSize = '1';
    const sizeMatch = quantity.match(/(\d+(\.\d+)?)\s*(ml|l|g|kg|pack)/i);
    if (sizeMatch) {
      unitSize = sizeMatch[1];
    } else {
      // Try to extract any number
      const numberMatch = quantity.match(/(\d+(\.\d+)?)/);
      if (numberMatch) {
        unitSize = numberMatch[1];
      }
    }

    return { unit, unitSize };
  }

  /**
   * Extract milk type from product data
   */
  extractMilkType(productData) {
    if (!productData) return 'Cow';
    
    const productString = JSON.stringify(productData).toLowerCase();
    
    if (productString.includes('buffalo') || productString.includes('bhains')) {
      return 'Buffalo';
    } else if (productString.includes('goat') || productString.includes('bakar')) {
      return 'Goat';
    } else if (productString.includes('camel')) {
      return 'Camel';
    } else if (productString.includes('mixed') || productString.includes('blend')) {
      return 'Mixed';
    } else if (productString.includes('plant') || productString.includes('soy') || productString.includes('almond')) {
      return 'None'; // For plant-based "milks"
    }
    
    return 'Cow'; // Default
  }

  /**
   * Find matching category from available categories
   */
  findMatchingCategory(openFoodFactsCategories, availableCategories) {
    if (!openFoodFactsCategories || openFoodFactsCategories.length === 0) {
      return null;
    }

    // Convert available categories to lowercase for matching
    const availableCategoryMap = {};
    availableCategories.forEach(cat => {
      availableCategoryMap[cat.name.toLowerCase()] = cat._id;
    });

    // Try to find direct matches first
    for (const ofCategory of openFoodFactsCategories) {
      const lowerCategory = ofCategory.toLowerCase();
      
      // Direct match
      if (availableCategoryMap[lowerCategory]) {
        return availableCategoryMap[lowerCategory];
      }
      
      // Partial match
      for (const [availableName, availableId] of Object.entries(availableCategoryMap)) {
        if (lowerCategory.includes(availableName) || availableName.includes(lowerCategory)) {
          return availableId;
        }
      }
    }

    // Try common dairy categories
    const dairyKeywords = ['milk', 'dairy', 'cheese', 'curd', 'yogurt', 'paneer', 'butter', 'ghee'];
    for (const ofCategory of openFoodFactsCategories) {
      const lowerCategory = ofCategory.toLowerCase();
      
      for (const keyword of dairyKeywords) {
        if (lowerCategory.includes(keyword)) {
          // Return the first available dairy category
          const dairyCategory = availableCategories.find(cat => 
            cat.name.toLowerCase().includes(keyword)
          );
          if (dairyCategory) {
            return dairyCategory._id;
          }
        }
      }
    }

    return null;
  }
// In services/openFoodFacts.service.js - Update the downloadAndUploadImages method

/**
 * Download and upload images to Cloudinary
 */
async downloadAndUploadImages(images, maxImages = 3) {
  const uploadedImages = [];
  
  if (!images || images.length === 0) {
    return uploadedImages;
  }

  // Process images in parallel for better performance
  const imagePromises = [];
  
  for (let i = 0; i < Math.min(images.length, maxImages); i++) {
    imagePromises.push(this.processSingleImage(images[i], i));
  }

  try {
    const results = await Promise.allSettled(imagePromises);
    
    results.forEach((result, index) => {
      if (result.status === 'fulfilled' && result.value) {
        uploadedImages.push(result.value);
        console.log(`✅ Image ${index + 1} processed successfully`);
      } else {
        console.error(`❌ Failed to process image ${index + 1}:`, result.reason);
      }
    });

  } catch (error) {
    console.error('Error processing images:', error);
  }

  return uploadedImages;
}

/**
 * Process single image download and upload
 */
async processSingleImage(image, index) {
  try {
    console.log(`📥 Downloading image ${index + 1}: ${image.url}`);
    
    // Validate image URL
    if (!image.url || !image.url.startsWith('http')) {
      throw new Error('Invalid image URL');
    }

    // Download image with timeout
    const response = await axios({
      method: 'GET',
      url: image.url,
      responseType: 'arraybuffer',
      timeout: 10000, // 10 second timeout
      headers: {
        'User-Agent': 'Dairy9-App/1.0'
      }
    });

    // Check if we got valid image data
    if (!response.data || response.data.length === 0) {
      throw new Error('Empty image data received');
    }

    console.log(`📤 Uploading image ${index + 1} to Cloudinary...`);
    
    // Upload to Cloudinary with proper folder
    const uploadResult = await uploadToCloudinary(
      response.data,
      'dairy9/products/scanned'
    );

    // Verify Cloudinary upload was successful
    if (!uploadResult || !uploadResult.secure_url) {
      throw new Error('Cloudinary upload failed - no secure_url returned');
    }

    console.log(`✅ Image ${index + 1} uploaded: ${uploadResult.secure_url}`);

    return {
      url: uploadResult.secure_url,
      publicId: uploadResult.public_id,
      originalUrl: image.url,
      type: image.type || 'product',
      size: response.data.length
    };

  } catch (error) {
    console.error(`❌ Failed to process image ${index + 1}:`, error.message);
    throw error; // Re-throw to handle in Promise.allSettled
  }
}
}

// Create and export singleton instance
const openFoodFactsService = new OpenFoodFactsService();
export default openFoodFactsService;