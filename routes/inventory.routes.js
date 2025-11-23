// J:\dairy9 backend\Dairy9-Backend\routes\inventory.routes.js

import express from 'express';
import auth from '../middlewares/auth.js';
import {
  getRetailerInventory,
  addProductToInventory,
  updateInventoryStock,
  getLowStockAlerts,
  getInventoryLogs,
  updateInventoryItem,
  getInventoryAnalytics,
  getInventoryForCustomer,
  deleteInventoryItem,
  forceDeleteInventoryItem,
  updatePricingSlabs,
  calculatePriceForQuantity,
  bulkCalculatePrices,
  calculateOrderPricing,
  // 🔥 NEW: Price validation endpoints
  validateInventoryPrices,
  getValidatedProductPrice,
  getBulkValidatedPrices,
  // Dashboard endpoints
  getInventoryDashboard,
  getRevenueAnalytics
} from '../controllers/inventory.controller.js';

const router = express.Router();

/* ----------------------------------------------
   PUBLIC (NO AUTH) — CUSTOMER CAN VIEW RETAILER INVENTORY
------------------------------------------------*/
router.get("/retailer/:retailerId", getInventoryForCustomer);

/* ----------------------------------------------
   PROTECTED ROUTES (RETAILER ONLY)
------------------------------------------------*/
router.use(auth);

// ⚠️ FIX — Define middleware BEFORE using it
const requireRetailer = (req, res, next) => {
  if (req.user.role !== 'retailer' && req.user.role !== 'admin') {
    return res.status(403).json({
      success: false,
      message: 'Access denied. Retailer role required.'
    });
  }
  next();
};

router.use(requireRetailer);

/* ----------------------------------------------
   RETAILER INVENTORY MANAGEMENT ROUTES
------------------------------------------------*/
router.get('/', getRetailerInventory);
router.post('/products', addProductToInventory);
router.put('/stock', updateInventoryStock);
router.put('/products/:inventoryId', updateInventoryItem);
router.delete('/products/:inventoryId', deleteInventoryItem);
router.delete('/products/:inventoryId/force', forceDeleteInventoryItem);

/* ----------------------------------------------
   🔥 NEW: PRICE VALIDATION & CORRECTION ENDPOINTS
------------------------------------------------*/
router.post('/validate-prices', validateInventoryPrices);
router.get('/product-price/:productId', getValidatedProductPrice);
router.post('/bulk-validated-prices', getBulkValidatedPrices);

/* ----------------------------------------------
   PRICING SLABS & CALCULATION ENDPOINTS
------------------------------------------------*/
router.put('/products/:inventoryId/pricing-slabs', updatePricingSlabs);
router.post('/calculate-price', calculatePriceForQuantity);
router.post('/bulk-calculate-prices', bulkCalculatePrices);
router.post('/calculate-order-pricing', calculateOrderPricing);

/* ----------------------------------------------
   REPORTING & ANALYTICS
------------------------------------------------*/
router.get('/alerts/low-stock', getLowStockAlerts);
router.get('/logs', getInventoryLogs);
router.get('/analytics', getInventoryAnalytics);
router.get('/dashboard', getInventoryDashboard);
router.get('/revenue-analytics', getRevenueAnalytics);

export default router;   //TEJAS