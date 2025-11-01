import express from 'express';
import {
  createOrder,
  getCustomerOrders,
  getOrderById,
  cancelOrder,
  updateOrderStatus
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