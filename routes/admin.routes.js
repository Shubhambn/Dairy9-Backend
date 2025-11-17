// C:\Users\Krishna\OneDrive\Desktop\backend-dairy9\Dairy9-Backend\routes\admin.routes.js

import express from 'express';
import {
  getDashboardStats,
  getAdminOrders,
  updateOrderStatus,
  getInvoiceSummary,
  generateOverallInvoice
} from '../controllers/adminDashboard.controller.js';
import {
  updateServiceRadius,
  updateLocation,
  getRetailerOrders,
  getRetailerProfile,
  assignOrderToRetailer  // Add this import
} from '../controllers/retailer.controller.js';
 import { createStockOrder,getRetailerStockOrders,getRetailerStockOrderById,cancelStockOrder ,addNoteToStockOrder} from '../controllers/stockOrders.controller.js';
import auth from '../middlewares/auth.js';
import adminAuth from '../middlewares/adminAuth.js';

const router = express.Router();

// All admin routes require authentication and admin role
router.use(auth);
router.use(adminAuth);

// Dashboard routes
router.get('/dashboard/stats', getDashboardStats);
router.get('/orders', getAdminOrders);
router.put('/orders/:orderId/status', updateOrderStatus);
router.get('/invoices', getInvoiceSummary);
router.get('/invoices/pdf', generateOverallInvoice);

// Retailer-specific routes
router.get('/retailer/profile', getRetailerProfile);
router.put('/retailer/radius', updateServiceRadius);
router.put('/retailer/location', updateLocation);
router.get('/retailer/orders', getRetailerOrders);
router.put('/retailer/orders/:orderId/assign', assignOrderToRetailer); // Add this route

// POST create stock order
router.post('/stock-orders', createStockOrder);
router.get('/stock-orders', getRetailerStockOrders); // list for retailer
router.get('/stock-orders/:id', getRetailerStockOrderById);
router.put('/stock-orders/:id/cancel', cancelStockOrder);
router.post('/stock-orders/:id/notes', addNoteToStockOrder);


export default router;