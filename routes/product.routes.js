// routes/product.routes.js - UPDATED

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
  scanAndAssignBarcode,
  generateProductBarcode,
  removeScannedBarcode,
  deleteGeneratedBarcode,
  getProductByBarcode,
  scanBarcode,
  getProductBarcodeInfo,
  getProductsBarcodeStatus,
  createProductFromBarcode,
  scanBarcodeForProductData,
  getProductByAnyBarcode,
  searchProductByBarcode,
  updateProductBarcode,
  removeProductBarcode
} from '../controllers/product.controller.js';
import { generateProductQR,scanProductQR  } from '../controllers/product.controller.js';
import { testCloudinaryConnection } from '../utils/cloudinaryUpload.js'; // adjust path if needed

const router = express.Router();

// =============================================
// PUBLIC ROUTES
// =============================================
router.get('/', getAllProducts);
router.get('/featured', getFeaturedProducts);
router.get('/search', searchProducts);

// 🎯 Unified barcode lookup for offline orders
router.get('/barcode/:barcodeId', getProductByAnyBarcode);
router.get('/barcode-lookup/:barcodeId', getProductByBarcode);

// Public barcode scanning
router.post('/scan', scanBarcode);
router.post('/scan-public', scanBarcode);

// =============================================
// PROTECTED ADMIN ROUTES
// =============================================
router.get('/barcode/status', auth, adminAuth, getProductsBarcodeStatus);
// 🎯 ENHANCED: Barcode scanning for product creation
router.post('/scan-barcode', auth, adminAuth, scanBarcodeForProductData);
router.post('/scan-create', auth, adminAuth, createProductFromBarcode);

// =============================================
// PARAMETERIZED ROUTES
// =============================================
router.get('/:id', getProductById);
router.get('/:id/barcode-info', getProductBarcodeInfo);
router.get('/id/:productId', getProductById);

// 🎯 FIX: Product creation - support BOTH JSON (with Cloudinary URLs) and FormData
router.post('/', 
  auth, 
  adminAuth, 
  upload.fields([
    { name: 'image', maxCount: 1 },
    { name: 'additionalImages', maxCount: 10 }
  ]), 
  createProduct
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

router.delete('/:id', auth, adminAuth, deleteProduct);

// Product images
router.post('/:id/images', auth, adminAuth, upload.array('images', 10), uploadProductImages);
router.delete('/:id/images/:imageId', auth, adminAuth, deleteProductImage);

// Barcode management
router.post('/:id/generate-barcode', auth, adminAuth, generateProductBarcode);
router.post('/:id/scan-barcode', auth, adminAuth, scanAndAssignBarcode);
router.delete('/:id/scanned-barcode', auth, adminAuth, removeScannedBarcode);
router.delete('/:id/generated-barcode', auth, adminAuth, deleteGeneratedBarcode);

// Legacy barcode routes
router.put('/:id/barcode', auth, adminAuth, updateProductBarcode);
router.delete('/:id/barcode', auth, adminAuth, removeProductBarcode);

export default router;