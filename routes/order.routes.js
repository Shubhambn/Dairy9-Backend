// C:\Users\tejas\Downloads\Project-Dairy-9\Dairy9-Backend\routes\order.routes.js

import express from 'express';
import {
  createOrder,
  getCustomerOrders,
  getOrderById,
  cancelOrder,
  updateOrderStatus,
  getRetailerActiveOrders,
  getRetailerOrderHistory,
  createOfflineOrder
} from '../controllers/order.controller.js';
import { generateInvoice } from '../controllers/invoice.controller.js';
import auth from '../middlewares/auth.js';


const router = express.Router();

// All routes are protected
router.use(auth);

// Customer routes
router.post('/', createOrder);
router.get('/', getCustomerOrders);
router.get('/:id', getOrderById);
router.get('/:id/invoice', generateInvoice);
router.put('/:id/cancel', cancelOrder);

// Retailer routes
router.post('/offline', createOfflineOrder);
router.get('/retailer/active-orders', getRetailerActiveOrders);
router.get('/retailer/order-history', getRetailerOrderHistory);

// Admin routes for order status update
router.put('/:id/status', (req, res, next) => {
  if (req.user.role !== 'admin' && req.user.role !== 'retailer') {
    return res.status(403).json({
      success: false,
      message: 'Access denied. Admin or Retailer role required.'
    });
  }
  next();
}, updateOrderStatus);

export default router;
