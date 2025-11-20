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
import { generateInvoice } from '../controllers/invoice.controller.js';
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
router.get('/orders/:id/invoice', generateInvoice); // Keep existing


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
router.post('/products',  upload.single('image'), createProduct);
router.put('/products/:id',  upload.single('image'), updateProduct);
router.delete('/products/:id',  deleteProduct);

// Image management routes
router.post('/products/:id/images',  upload.array('images', 5), uploadProductImages);
router.delete('/products/:id/images/:imageId',  deleteProductImage);


// Protected routes (SuperAdmin only)
router.post('/categories', upload.single('image'), createCategory);
router.put('/categories/:id', upload.single('image'), updateCategory);
router.delete('/categories/:id', deleteCategory);

// Logs
router.get('/logs/actions', getActionLogs);
router.delete('/logs/clear', clearOldLogs);
router.get('/logs/export', exportLogs);




// =============================================
// PROTECTED Superadmin (Admin only)
// =============================================

// Create category (both patterns supported)
router.post('/categories',upload.single('image'), createCategory);
router.post('/', upload.single('image'), createCategory); // Alternative pattern

// Update category (both patterns supported)
router.put('/categories/:id', upload.single('image'), updateCategory);
router.put('/:id', upload.single('image'), updateCategory); // Alternative pattern

// Delete category (both patterns supported)
router.delete('/categories/:id', deleteCategory);
router.delete('/:id', deleteCategory); // Alternative pattern




// =============================================
// PROTECTED SuperAdmin ROUTES
// =============================================

// Barcode status and management
router.get('/barcode/status', getProductsBarcodeStatus);
router.get('/products/barcode/status', getProductsBarcodeStatus); // Legacy pattern

// Enhanced barcode scanning for product creation
router.post('/scan-barcode' ,scanBarcodeForProductData);
router.post('/products/scan-barcode', scanBarcodeForProductData); // Legacy pattern
router.post('/scan-create', createProductFromBarcode);
router.post('/:id/generate-barcode',  generateProductBarcode);
// router.post('/:id/scan-barcode', auth, scanAndAssignBarcode);
router.delete('/:id/scanned-barcode',    removeScannedBarcode);
router.delete('/:id/generated-barcode', deleteGeneratedBarcode);




// Legacy barcode routes (for backward compatibility)






// Legacy barcode routes (for backward compatibility)
router.post('/:id/barcode',  scanAndAssignBarcode);
router.post('/products/:id/barcode',  scanAndAssignBarcode); // Legacy pattern
router.put('/:id/barcode',  updateProductBarcode);
router.put('/products/:id/barcode',  updateProductBarcode); // Legacy pattern
router.delete('/:id/barcode',  removeProductBarcode);
router.delete('/products/:id/barcode', removeProductBarcode); // Legacy pattern

// =============================================
// ADDITIONAL UTILITY ROUTES
// =============================================

// Product info routes
router.get('/:id/barcode-info', getProductBarcodeInfo);
router.get('/id/:productId', getProductById);

console.log('✅ [ROUTES] All SuperAdmin routes setup complete');



export default router;