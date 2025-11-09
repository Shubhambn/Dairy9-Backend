// routes/inventory.routes.js
import express from 'express';
import auth from '../middlewares/auth.js';
import {
  getRetailerInventory,
  addProductToInventory,
  updateInventoryStock,
  getLowStockAlerts,
  getInventoryLogs,
  updateInventoryItem,
  getInventoryAnalytics
} from '../controllers/inventory.controller.js';

const router = express.Router();

// All routes require authentication
router.use(auth);

// Middleware to ensure user is a retailer
const requireRetailer = (req, res, next) => {
  if (req.user.role !== 'retailer' && req.user.role !== 'admin') {
    return res.status(403).json({
      success: false,
      message: 'Access denied. Retailer role required.'
    });
  }
  next();
};

// Apply retailer middleware to all routes
router.use(requireRetailer);

// Inventory management routes
router.get('/', getRetailerInventory);
router.post('/products', addProductToInventory);
router.put('/stock', updateInventoryStock);
router.put('/products/:inventoryId', updateInventoryItem);

// Reporting and analytics routes
router.get('/alerts/low-stock', getLowStockAlerts);
router.get('/logs', getInventoryLogs);
router.get('/analytics', getInventoryAnalytics);

export default router;