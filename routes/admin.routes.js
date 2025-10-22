// C:\Users\Krishna\OneDrive\Desktop\backend-dairy9\Dairy9-Backend\routes\admin.routes.js

import express from 'express';
import {
  getDashboardStats,
  getAdminOrders,
  updateOrderStatus,
  getInvoiceSummary
} from '../controllers/adminDashboard.controller.js';

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

export default router;