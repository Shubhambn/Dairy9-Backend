import express from 'express';
import {
  getRetailerOrders,
  updateOrderStatusByRetailer,
  getRetailerOrderStats
} from '../controllers/order.controller.js';
import auth from '../middlewares/auth.js';

const router = express.Router();

// All routes are protected
router.use(auth);

// Retailer specific routes - only retailers can access these
router.get('/my-orders', (req, res, next) => {
  if (req.user.role !== 'retailer' && req.user.role !== 'admin') {
    return res.status(403).json({
      success: false,
      message: 'Access denied. Retailer role required.'
    });
  }
  next();
}, getRetailerOrders);

router.get('/stats', (req, res, next) => {
  if (req.user.role !== 'retailer' && req.user.role !== 'admin') {
    return res.status(403).json({
      success: false,
      message: 'Access denied. Retailer role required.'
    });
  }
  next();
}, getRetailerOrderStats);

router.put('/:id/status', (req, res, next) => {
  if (req.user.role !== 'retailer' && req.user.role !== 'admin') {
    return res.status(403).json({
      success: false,
      message: 'Access denied. Retailer role required.'
    });
  }
  next();
}, updateOrderStatusByRetailer);

export default router;