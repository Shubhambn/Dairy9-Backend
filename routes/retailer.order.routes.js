// C:\Users\ADMIN\Desktop\d9\Dairy9-Backend\routes\retailer.order.routes.js

import express from 'express';
import {
  getRetailerOrders,
  updateOrderStatusByRetailer,
  getRetailerOrderStats
} from '../controllers/order.controller.js';
import { getAvailableOrders, assignOrderToRetailer } from '../controllers/retailer.controller.js';
import auth from '../middlewares/auth.js';

const router = express.Router();

// All routes are protected
router.use(auth);

// Middleware to check retailer role
const requireRetailer = (req, res, next) => {
  if (req.user.role !== 'retailer' && req.user.role !== 'admin') {
    return res.status(403).json({
      success: false,
      message: 'Access denied. Retailer role required.'
    });
  }
  next();
};

// Retailer specific routes - only retailers can access these
router.get('/my-orders', requireRetailer, getRetailerOrders);

router.get('/available', requireRetailer, getAvailableOrders);

router.get('/stats', requireRetailer, getRetailerOrderStats);

router.put('/:id/status', requireRetailer, updateOrderStatusByRetailer);

router.put('/:orderId/assign', requireRetailer, assignOrderToRetailer);

export default router;