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
  // Enhanced barcode functions
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
  createProductFromScanData,
  // Legacy barcode functions (for backward compatibility)
  updateProductBarcode,
  removeProductBarcode
} from '../controllers/product.controller.js';
import auth from '../middlewares/auth.js';
import adminAuth from '../middlewares/adminAuth.js';
import upload from '../middlewares/upload.js';

const router = express.Router();

// =============================================
// PUBLIC ROUTES (Static routes first)
// =============================================
router.get('/', getAllProducts);
router.get('/featured', getFeaturedProducts);
router.get('/search', searchProducts);
router.get('/barcode/:barcodeId', getProductByBarcode);
router.post('/scan', scanBarcode);

// =============================================
// PROTECTED ADMIN ROUTES (Static routes first)
// =============================================
router.get('/barcode/status', auth, adminAuth, getProductsBarcodeStatus);

// 🎯 ENHANCED BARCODE SCANNING ROUTES
router.post('/scan-barcode', auth, adminAuth, scanBarcodeForProductData);
router.post('/scan-create', auth, adminAuth, createProductFromBarcode);
router.post('/create-from-scan', auth, adminAuth, createProductFromScanData);

// =============================================
// PARAMETERIZED ROUTES (After static routes)
// =============================================
router.get('/:id', getProductById);
router.get('/:id/barcode-info', getProductBarcodeInfo);

// Product CRUD operations
router.post('/', auth, adminAuth, upload.fields([
  { name: 'image', maxCount: 1 },
  { name: 'additionalImages', maxCount: 10 }
]), createProduct);

router.put('/:id', auth, adminAuth, upload.fields([
  { name: 'image', maxCount: 1 },
  { name: 'additionalImages', maxCount: 10 }
]), updateProduct);

router.delete('/:id', auth, adminAuth, deleteProduct);

// Product images
router.post('/:id/images', auth, adminAuth, upload.array('images', 10), uploadProductImages);
router.delete('/:id/images/:imageId', auth, adminAuth, deleteProductImage);

// 🎯 ENHANCED BARCODE MANAGEMENT ROUTES
router.post('/:id/generate-barcode', auth, adminAuth, generateProductBarcode);
router.post('/:id/scan-barcode', auth, adminAuth, scanAndAssignBarcode);
router.delete('/:id/scanned-barcode', auth, adminAuth, removeScannedBarcode);
router.delete('/:id/generated-barcode', auth, adminAuth, deleteGeneratedBarcode);

// 🎯 LEGACY BARCODE ROUTES (for backward compatibility)
router.put('/:id/barcode', auth, adminAuth, updateProductBarcode);
router.delete('/:id/barcode', auth, adminAuth, removeProductBarcode);

export default router;