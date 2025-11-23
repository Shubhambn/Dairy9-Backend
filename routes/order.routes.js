import express from 'express';
import {
  createOrder,
  getCustomerOrders,
  getOrderById,
  cancelOrder,
  updateOrderStatus,
  getRetailerActiveOrders,
  getRetailerOrderHistory,
  createOfflineOrder,
  getRetailerOrders,
  getRetailerOrderStats,
  updateOrderStatusByRetailer,
  markOrderDelivered,
  markOrderAsPaid 
} from '../controllers/order.controller.js';
import { generateInvoice } from '../controllers/invoice.controller.js';
import auth from '../middlewares/auth.js';

const router = express.Router();

// All routes are protected
router.use(auth);

// ==================== CUSTOMER ROUTES ====================
router.post('/', createOrder);
router.get('/', getCustomerOrders);
router.get('/:id', getOrderById);
router.get('/:id/invoice', generateInvoice);
router.put('/:id/cancel', cancelOrder);

// ==================== RETAILER ROUTES ====================
// Offline orders
router.post('/offline', createOfflineOrder);

// ✅ FIXED: Add the missing mark-paid route
router.put('/:id/mark-paid', markOrderAsPaid);

// Retailer order management
router.get('/retailer/my-orders', getRetailerOrders);
router.get('/retailer/active-orders', getRetailerActiveOrders);
router.get('/retailer/order-history', getRetailerOrderHistory);
router.get('/retailer/stats', getRetailerOrderStats);

// Retailer-specific status updates
router.put('/retailer/:id/status', (req, res, next) => {
  if (req.user.role !== 'retailer') {
    return res.status(403).json({
      success: false,
      message: 'Access denied. Retailer role required.'
    });
  }
  next();
}, updateOrderStatusByRetailer);

// Quick delivery endpoint
router.put('/:id/deliver', (req, res, next) => {
  if (req.user.role !== 'admin' && req.user.role !== 'retailer') {
    return res.status(403).json({
      success: false,
      message: 'Access denied. Admin or Retailer role required.'
    });
  }
  next();
}, markOrderDelivered);

// ==================== ADMIN/RETAILER SHARED ROUTES ====================
// General status update (for both admin and retailer)
router.put('/:id/status', (req, res, next) => {
  if (req.user.role !== 'admin' && req.user.role !== 'retailer') {
    return res.status(403).json({
      success: false,
      message: 'Access denied. Admin or Retailer role required.'
    });
  }
  next();
}, updateOrderStatus);

// ==================== BACKWARD COMPATIBILITY ROUTES ====================
// Duplicate routes for backward compatibility (from first version)
router.get('/retailer/active-orders', getRetailerActiveOrders);
router.get('/retailer/order-history', getRetailerOrderHistory);


export default router;