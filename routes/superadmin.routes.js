// routes/superadmin.routes.js
import express from 'express';
import { authenticateSuperAdmin } from '../middlewares/superadmin.auth.js'; // Your existing middleware

// Import ALL controllers
import { getDashboardOverview, getRealTimeStats } from '../controllers/superadmin.analytics.controller.js';
import { getAllRetailers, getRetailerDetails, updateRetailerStatus, getRetailerPerformance } from '../controllers/superadmin.retailers.controller.js';
import { getAllCustomers, getCustomerDetails, getCustomerOrders } from '../controllers/superadmin.customers.controller.js';
import { generateSalesReport, generateRetailerPerformanceReport, generateCustomerAnalyticsReport, generateProductPerformanceReport, generateSystemOverviewReport } from '../controllers/superadmin.reports.controller.js';
import { getActionLogs, clearOldLogs, exportLogs } from '../controllers/superadmin.logs.controller.js';
import { getStockOrders,getStockOrderById,lockStockOrder ,releaseStockOrderLock,superAdminActOnOrder,getStockOrderTransactions,addNoteToStockOrder} from '../controllers/stockOrders.controller.js';
import {createProduct,updateProduct,deleteProduct,uploadProductImages,deleteProductImage} from '../controllers/product.controller.js';
import {createCategory,deleteCategory,updateCategory} from '../controllers/category.controller.js';
import auth from '../middlewares/auth.js';
import upload from '../middlewares/upload.js';

import {generateProductBarcode,removeScannedBarcode,deleteGeneratedBarcode,getProductBarcodeInfo,getProductsBarcodeStatus,createProductFromBarcode,scanBarcodeForProductData,getProductByAnyBarcode,searchProductByBarcode} from '../controllers/product.controller.js';

import {scanAndAssignBarcode,updateProductBarcode,removeProductBarcode} from '../controllers/product.controller.js';
import {getProductById} from '../controllers/product.controller.js';
const router = express.Router();

// Test endpoint
router.get('/test', (req, res) => {
  console.log('✅ [ROUTES] /test endpoint called');
  res.json({
    success: true,
    message: 'SuperAdmin API is working!',
    timestamp: new Date().toISOString()
  });
});

// ===================== 🔐 PROTECTED ROUTES =====================
// Use your existing authenticateSuperAdmin middleware
router.use(authenticateSuperAdmin);

// All routes below this line require SuperAdmin authentication
console.log('✅ [ROUTES] SuperAdmin protected routes setup');

// Dashboard
router.get('/dashboard/overview', getDashboardOverview);
router.get('/dashboard/real-time-stats', getRealTimeStats);

// Retailers
router.get('/retailers', getAllRetailers);
router.get('/retailers/:id', getRetailerDetails); 
router.get('/retailers/:id/performance', getRetailerPerformance);
router.patch('/retailers/:id/status', updateRetailerStatus);
router.get('/stock-orders', getStockOrders); // list & filter
router.get('/stock-orders/:id', getStockOrderById);
router.post('/stock-orders/:id/lock', lockStockOrder);
router.post('/stock-orders/:id/release-lock', releaseStockOrderLock);
router.post('/stock-orders/:id/action', superAdminActOnOrder); // approve/fulfill/reject/partial
router.get('/stock-orders/:id/transactions', getStockOrderTransactions);
router.post('/stock-orders/:id/notes', addNoteToStockOrder); // both sides can add notes


// Customers
router.get('/customers', getAllCustomers);
router.get('/customers/:id', getCustomerDetails);
router.get('/customers/:id/orders', getCustomerOrders);

// Reports
router.get('/reports/sales', generateSalesReport);
router.get('/reports/retailer-performance', generateRetailerPerformanceReport);
router.get('/reports/customer-analytics', generateCustomerAnalyticsReport);
router.get('/reports/product-performance', generateProductPerformanceReport);
router.get('/reports/system-overview', generateSystemOverviewReport);


// Product & Category
// Protected routes (SuperAdmin) with file upload
router.post('/products', auth, upload.single('image'), createProduct);
router.put('/products/:id', auth, upload.single('image'), updateProduct);
router.delete('/products/:id', auth, deleteProduct);

// Image management routes
router.post('/products/:id/images', auth, upload.array('images', 5), uploadProductImages);
router.delete('/products/:id/images/:imageId', auth, deleteProductImage);


// Protected routes (SuperAdmin only)
router.post('/categories',auth, upload.single('image'), createCategory);
router.put('/categories/:id',auth, upload.single('image'), updateCategory);
router.delete('/categories/:id',auth, deleteCategory);

// Logs
router.get('/logs/actions',auth, getActionLogs);
router.delete('/logs/clear',auth, clearOldLogs);
router.get('/logs/export',auth, exportLogs);




// =============================================
// PROTECTED Superadmin (Admin only)
// =============================================

// Create category (both patterns supported)
router.post('/categories',auth,upload.single('image'), createCategory);
router.post('/',auth, upload.single('image'), createCategory); // Alternative pattern

// Update category (both patterns supported)
router.put('/categories/:id',auth, upload.single('image'), updateCategory);
router.put('/:id',auth, upload.single('image'), updateCategory); // Alternative pattern

// Delete category (both patterns supported)
router.delete('/categories/:id',auth, deleteCategory);
router.delete('/:id',auth, deleteCategory); // Alternative pattern




// =============================================
// PROTECTED SuperAdmin ROUTES
// =============================================

// Barcode status and management
router.get('/barcode/status',auth, getProductsBarcodeStatus);
router.get('/products/barcode/status', getProductsBarcodeStatus); // Legacy pattern

// Enhanced barcode scanning for product creation
router.post('/scan-barcode',auth,scanBarcodeForProductData);
router.post('/products/scan-barcode',); // Legacy pattern
router.post('/scan-create',auth,createProductFromBarcode);
router.post('/:id/generate-barcode', auth, generateProductBarcode);
// router.post('/:id/scan-barcode', auth, scanAndAssignBarcode);
router.delete('/:id/scanned-barcode', auth, removeScannedBarcode);
router.delete('/:id/generated-barcode', auth, deleteGeneratedBarcode);




// Legacy barcode routes (for backward compatibility)






// Legacy barcode routes (for backward compatibility)
router.post('/:id/barcode', auth, scanAndAssignBarcode);
router.post('/products/:id/barcode', auth, scanAndAssignBarcode); // Legacy pattern
router.put('/:id/barcode', auth, updateProductBarcode);
router.put('/products/:id/barcode', auth,  updateProductBarcode); // Legacy pattern
router.delete('/:id/barcode', auth,  removeProductBarcode);
router.delete('/products/:id/barcode', auth,  removeProductBarcode); // Legacy pattern

// =============================================
// ADDITIONAL UTILITY ROUTES
// =============================================

// Product info routes
router.get('/:id/barcode-info', getProductBarcodeInfo);
router.get('/id/:productId', getProductById);

console.log('✅ [ROUTES] All SuperAdmin routes setup complete');



export default router;