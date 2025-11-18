// C:\Users\Krishna\OneDrive\Desktop\backend-dairy9\Dairy9-Backend\routes\product.routes.js

import express from 'express';
import {
  createProduct,
  getAllProducts,
  getProductById,
  updateProduct,
  deleteProduct,
  getFeaturedProducts,
  searchProducts,
  uploadProductImages,
  deleteProductImage,
  // QR Code functions
  generateProductQR,
  scanProductQR,
  // Barcode functions (first version)
  scanAndAssignBarcode,
  updateProductBarcode,
  removeProductBarcode,
  getProductByBarcode,
  scanBarcode,
  // Enhanced barcode functions (second version)
  generateProductBarcode,
  removeScannedBarcode,
  deleteGeneratedBarcode,
  getProductBarcodeInfo,
  getProductsBarcodeStatus,
  createProductFromBarcode,
  scanBarcodeForProductData,
  getProductByAnyBarcode,
  searchProductByBarcode
} from '../controllers/product.controller.js';
import auth from '../middlewares/auth.js';
import adminAuth from '../middlewares/adminAuth.js';
import upload from '../middlewares/upload.js';
import { testCloudinaryConnection } from '../utils/cloudinaryUpload.js';

const router = express.Router();

// =============================================
// PUBLIC ROUTES
// =============================================

// Product listing routes (both patterns supported)
router.get('/products', getAllProducts);
router.get('/', getAllProducts); // Alternative pattern

router.get('/products/featured', getFeaturedProducts);
router.get('/featured', getFeaturedProducts); // Alternative pattern

router.get('/products/search', searchProducts);
router.get('/search', searchProducts); // Alternative pattern

// Product detail routes (both patterns supported)
router.get('/products/:id', getProductById);
router.get('/:id', getProductById); // Alternative pattern

// Barcode lookup routes (multiple patterns supported)
router.get('/barcode/:barcodeId', getProductByBarcode);
router.get('/products/barcode/:barcodeId', getProductByBarcode); // Legacy pattern
router.get('/barcode-lookup/:barcodeId', getProductByBarcode); // Enhanced pattern
router.get('/barcode-search/:barcodeId', getProductByAnyBarcode); // Unified lookup

// Public barcode scanning
router.post('/scan', scanBarcode);
router.post('/products/scan', scanBarcode); // Legacy pattern
router.post('/scan-public', scanBarcode); // Enhanced pattern
router.post('/scan-product', scanProductQR); // QR scanning


// =============================================
// PRODUCT MANAGEMENT ROUTES
// =============================================

// Product creation - support BOTH JSON (with Cloudinary URLs) and FormData
router.post('/products', 
  auth, 
  adminAuth, 
  upload.fields([
    { name: 'image', maxCount: 1 },
    { name: 'additionalImages', maxCount: 10 }
  ]), 
  createProduct
);

// Alternative product creation route
router.post('/', 
  auth, 
  adminAuth, 
  upload.fields([
    { name: 'image', maxCount: 1 },
    { name: 'additionalImages', maxCount: 10 }
  ]), 
  createProduct
);

// Product update routes
router.put('/products/:id', 
  auth, 
  adminAuth, 
  upload.fields([
    { name: 'image', maxCount: 1 },
    { name: 'additionalImages', maxCount: 10 }
  ]), 
  updateProduct
);

router.put('/:id', 
  auth, 
  adminAuth, 
  upload.fields([
    { name: 'image', maxCount: 1 },
    { name: 'additionalImages', maxCount: 10 }
  ]), 
  updateProduct
);

// Product deletion routes
router.delete('/products/:id', auth, adminAuth, deleteProduct);
router.delete('/:id', auth, adminAuth, deleteProduct);

// =============================================
// IMAGE MANAGEMENT ROUTES
// =============================================

router.post('/products/:id/images', auth, adminAuth, upload.array('images', 5), uploadProductImages);
router.post('/:id/images', auth, adminAuth, upload.array('images', 10), uploadProductImages);

router.delete('/products/:id/images/:imageId', auth, adminAuth, deleteProductImage);
router.delete('/:id/images/:imageId', auth, adminAuth, deleteProductImage);

// =============================================
// QR CODE MANAGEMENT ROUTES
// =============================================

router.post("/generate/:id", generateProductQR);
router.post("/products/generate/:id", generateProductQR); // Legacy pattern
router.post("/:id/generate-qr", generateProductQR); // Enhanced pattern

// =============================================
// BARCODE MANAGEMENT ROUTES
// =============================================

// Enhanced barcode management
router.post('/:id/generate-barcode', auth, adminAuth, generateProductBarcode);
router.post('/:id/scan-barcode', auth, adminAuth, scanAndAssignBarcode);
router.delete('/:id/scanned-barcode', auth, adminAuth, removeScannedBarcode);
router.delete('/:id/generated-barcode', auth, adminAuth, deleteGeneratedBarcode);

// Legacy barcode routes (for backward compatibility)
router.post('/:id/barcode', auth, adminAuth, scanAndAssignBarcode);
router.post('/products/:id/barcode', auth, adminAuth, scanAndAssignBarcode); // Legacy pattern
router.put('/:id/barcode', auth, adminAuth, updateProductBarcode);
router.put('/products/:id/barcode', auth, adminAuth, updateProductBarcode); // Legacy pattern
router.delete('/:id/barcode', auth, adminAuth, removeProductBarcode);
router.delete('/products/:id/barcode', auth, adminAuth, removeProductBarcode); // Legacy pattern

// =============================================
// ADDITIONAL UTILITY ROUTES
// =============================================

// Product info routes
router.get('/:id/barcode-info', getProductBarcodeInfo);
router.get('/id/:productId', getProductById); // Alternative ID route

// Cloudinary test route
router.get('/test-cloudinary', async (req, res) => {
  try {
    const cloudinaryConnected = await testCloudinaryConnection();
    if (cloudinaryConnected) {
      res.json({ 
        success: true, 
        message: 'Cloudinary is properly configured' 
      });
    } else {
      res.status(503).json({ 
        success: false, 
        message: 'Cloudinary configuration issue' 
      });
    }
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      message: 'Cloudinary test failed',
      error: error.message 
    });
  }
});

// Alternative cloudinary test route
router.get('/products/test-cloudinary', async (req, res) => {
  try {
    const cloudinaryConnected = await testCloudinaryConnection();
    if (cloudinaryConnected) {
      res.json({ 
        success: true, 
        message: 'Cloudinary is properly configured' 
      });
    } else {
      res.status(503).json({ 
        success: false, 
        message: 'Cloudinary configuration issue' 
      });
    }
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      message: 'Cloudinary test failed',
      error: error.message 
    });
  }
});

export default router;