// C:\Users\Krishna\OneDrive\Desktop\backend-dairy9\Dairy9-Backend\routes\order.routes.js

import express from 'express';
import {
  createOrder,
  getCustomerOrders,
  getOrderById,
  cancelOrder,
  updateOrderStatus
} from '../controllers/order.controller.js';
import auth from '../middlewares/auth.js';

const router = express.Router();

// All routes are protected
router.use(auth);

// Customer routes
router.post('/', createOrder);
router.get('/', getCustomerOrders);
router.get('/:id', getOrderById);
router.put('/:id/cancel', cancelOrder);

// Admin routes
router.put('/:id/status', updateOrderStatus);

export default router;