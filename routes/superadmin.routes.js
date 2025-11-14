// routes/superadmin.routes.js
import express from 'express';
import { authenticateSuperAdmin } from '../middlewares/superadmin.auth.js'; // Your existing middleware

// Import ALL controllers
import { getDashboardOverview, getRealTimeStats } from '../controllers/superadmin.analytics.controller.js';
import { getAllRetailers, getRetailerDetails, updateRetailerStatus, getRetailerPerformance } from '../controllers/superadmin.retailers.controller.js';
import { getAllCustomers, getCustomerDetails, getCustomerOrders } from '../controllers/superadmin.customers.controller.js';
import { generateSalesReport, generateRetailerPerformanceReport, generateCustomerAnalyticsReport, generateProductPerformanceReport, generateSystemOverviewReport } from '../controllers/superadmin.reports.controller.js';
import { getActionLogs, clearOldLogs, exportLogs } from '../controllers/superadmin.logs.controller.js';
import { getStockOrders,getStockOrderById,lockStockOrder ,releaseStockOrderLock,superAdminActOnOrder,getStockOrderTransactions,addNoteToStockOrder} from '../controllers/stockOrders.controller.js';
const router = express.Router();

// Test endpoint
router.get('/test', (req, res) => {
  console.log('✅ [ROUTES] /test endpoint called');
  res.json({
    success: true,
    message: 'SuperAdmin API is working!',
    timestamp: new Date().toISOString()
  });
});

// ===================== 🔐 PROTECTED ROUTES =====================
// Use your existing authenticateSuperAdmin middleware
router.use(authenticateSuperAdmin);

// All routes below this line require SuperAdmin authentication
console.log('✅ [ROUTES] SuperAdmin protected routes setup');

// Dashboard
router.get('/dashboard/overview', getDashboardOverview);
router.get('/dashboard/real-time-stats', getRealTimeStats);

// Retailers
router.get('/retailers', getAllRetailers);
router.get('/retailers/:id', getRetailerDetails); 
router.get('/retailers/:id/performance', getRetailerPerformance);
router.patch('/retailers/:id/status', updateRetailerStatus);
router.get('/stock-orders', getStockOrders); // list & filter
router.get('/stock-orders/:id', getStockOrderById);
router.post('/stock-orders/:id/lock', lockStockOrder);
router.post('/stock-orders/:id/release-lock', releaseStockOrderLock);
router.post('/stock-orders/:id/action', superAdminActOnOrder); // approve/fulfill/reject/partial
router.get('/stock-orders/:id/transactions', getStockOrderTransactions);
router.post('/stock-orders/:id/notes', addNoteToStockOrder); // both sides can add notes


// Customers
router.get('/customers', getAllCustomers);
router.get('/customers/:id', getCustomerDetails);
router.get('/customers/:id/orders', getCustomerOrders);

// Reports
router.get('/reports/sales', generateSalesReport);
router.get('/reports/retailer-performance', generateRetailerPerformanceReport);
router.get('/reports/customer-analytics', generateCustomerAnalyticsReport);
router.get('/reports/product-performance', generateProductPerformanceReport);
router.get('/reports/system-overview', generateSystemOverviewReport);

// Logs
router.get('/logs/actions', getActionLogs);
router.delete('/logs/clear', clearOldLogs);
router.get('/logs/export', exportLogs);

console.log('✅ [ROUTES] All SuperAdmin routes setup complete');
export default router;