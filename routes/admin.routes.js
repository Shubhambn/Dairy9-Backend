// C:\Users\Krishna\OneDrive\Desktop\backend-dairy9\Dairy9-Backend\routes\admin.routes.js

import express from 'express';
import {
  getDashboardStats,
  getAdminOrders,
  updateOrderStatus,
  getInvoiceSummary,
  generateOverallInvoice
} from '../controllers/adminDashboard.controller.js';
import {
  updateServiceRadius,
  updateLocation,
  getRetailerOrders,
  getRetailerProfile,
  assignOrderToRetailer  // Add this import
} from '../controllers/retailer.controller.js';
 import { createStockOrder,getRetailerStockOrders,getRetailerStockOrderById,cancelStockOrder ,addNoteToStockOrder} from '../controllers/stockOrders.controller.js';
import auth from '../middlewares/auth.js';
import adminAuth from '../middlewares/adminAuth.js';
import { generateRetailerStockOrderInvoice } from '../controllers/retailerInvoice.controller.js';
const router = express.Router();

// All admin routes require authentication and admin role
router.use(auth);
router.use(adminAuth);

// Dashboard routes
router.get('/dashboard/stats', getDashboardStats);
router.get('/orders', getAdminOrders);
router.put('/orders/:orderId/status', updateOrderStatus);
router.get('/invoices', getInvoiceSummary);
router.get('/invoices/pdf', generateOverallInvoice);

// Retailer-specific routes
router.get('/retailer/profile', getRetailerProfile);
router.put('/retailer/radius', updateServiceRadius);
router.put('/retailer/location', updateLocation);
router.get('/retailer/orders', getRetailerOrders);
router.put('/retailer/orders/:orderId/assign', assignOrderToRetailer); // Add this route

// POST create stock order
router.post('/stock-orders', createStockOrder);
router.get('/stock-orders', getRetailerStockOrders); // list for retailer
router.get('/stock-orders/:id', getRetailerStockOrderById);
router.put('/stock-orders/:id/cancel', cancelStockOrder);
router.post('/stock-orders/:id/notes', addNoteToStockOrder);
router.get('/stock-orders/:id/invoice', generateRetailerStockOrderInvoice);
router.get('/stock-orders/:id/invoice', async (req, res) => {
  try {
    const { id } = req.params;
    
    // Fetch stock order data from your database
    const stockOrder = await StockOrder.findById(id)
      .populate('items.product')
      .populate('retailer', 'name email phone address')
      .populate('createdBy', 'name email');

    if (!stockOrder) {
      return res.status(404).json({ 
        success: false, 
        message: 'Stock order not found' 
      });
    }

    // Create PDF document
    const doc = new PDFDocument({ margin: 50 });
    
    // Set response headers
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=invoice-${stockOrder.orderNumber || id}.pdf`);
    
    // Pipe PDF to response
    doc.pipe(res);

    // Add content to PDF
    // Header
    doc.fontSize(20).font('Helvetica-Bold').text('INVOICE', 50, 50);
    doc.fontSize(10).font('Helvetica').text(`Order Number: ${stockOrder.orderNumber || id}`, 50, 80);
    doc.text(`Date: ${new Date(stockOrder.createdAt).toLocaleDateString()}`, 50, 95);
    
    // Retailer info
    if (stockOrder.retailer) {
      doc.text(`Retailer: ${stockOrder.retailer.name}`, 50, 120);
      if (stockOrder.retailer.email) doc.text(`Email: ${stockOrder.retailer.email}`, 50, 135);
      if (stockOrder.retailer.phone) doc.text(`Phone: ${stockOrder.retailer.phone}`, 50, 150);
      if (stockOrder.retailer.address) doc.text(`Address: ${stockOrder.retailer.address}`, 50, 165);
    }

    // Table header
    let yPosition = 200;
    doc.font('Helvetica-Bold');
    doc.text('Item', 50, yPosition);
    doc.text('Qty', 250, yPosition);
    doc.text('Price', 300, yPosition);
    doc.text('Total', 350, yPosition);
    
    yPosition += 20;
    doc.font('Helvetica');
    
    // Table rows
    let totalAmount = 0;
    stockOrder.items.forEach((item, index) => {
      const productName = item.product?.name || `Product ${item.product}`;
      const quantity = item.requestedQty || item.quantity || 0;
      const unitPrice = item.unitPrice || item.price || 0;
      const itemTotal = quantity * unitPrice;
      totalAmount += itemTotal;
      
      doc.text(productName, 50, yPosition);
      doc.text(quantity.toString(), 250, yPosition);
      doc.text(`₹${unitPrice.toFixed(2)}`, 300, yPosition);
      doc.text(`₹${itemTotal.toFixed(2)}`, 350, yPosition);
      
      yPosition += 20;
      
      // Add note if exists
      if (item.note) {
        doc.fontSize(8).text(`Note: ${item.note}`, 50, yPosition);
        yPosition += 15;
        doc.fontSize(10);
      }
      
      // Page break if needed
      if (yPosition > 700) {
        doc.addPage();
        yPosition = 50;
      }
    });

    // Total
    yPosition += 10;
    doc.moveTo(50, yPosition).lineTo(400, yPosition).stroke();
    yPosition += 20;
    
    doc.font('Helvetica-Bold');
    doc.text('Total Amount:', 250, yPosition);
    doc.text(`₹${totalAmount.toFixed(2)}`, 350, yPosition);

    // Status
    yPosition += 40;
    doc.font('Helvetica');
    doc.text(`Status: ${stockOrder.status || stockOrder.orderStatus || 'Pending'}`, 50, yPosition);

    // Finalize PDF
    doc.end();

  } catch (error) {
    console.error('Invoice generation error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to generate invoice',
      error: error.message 
    });
  }
});



export default router;