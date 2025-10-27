// C:\Users\Krishna\OneDrive\Desktop\backend-dairy9\Dairy9-Backend\controllers\adminDashboard.controller.js

import Customer from '../models/customer.model.js';
import Order from '../models/order.model.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// @desc    Get admin dashboard stats
// @route   GET /api/admin/dashboard/stats
// @access  Private (Admin)
export const getDashboardStats = async (req, res) => {
  try {
    // Get today's date range
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    // Calculate stats
    const todayRevenueResult = await Order.aggregate([
      {
        $match: {
          paymentStatus: 'paid',
          createdAt: { $gte: today, $lt: tomorrow }
        }
      },
      {
        $group: {
          _id: null,
          total: { $sum: '$finalAmount' }
        }
      }
    ]);

    const ordersToday = await Order.countDocuments({
      createdAt: { $gte: today, $lt: tomorrow }
    });

    const totalCustomers = await Customer.countDocuments();
    const totalOrders = await Order.countDocuments();

    res.status(200).json({
      success: true,
      stats: {
        todayRevenue: todayRevenueResult[0]?.total || 0,
        ordersToday: ordersToday,
        totalCustomers: totalCustomers,
        totalOrders: totalOrders
      }
    });
  } catch (error) {
    console.error('Get Dashboard Stats Error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

// @desc    Get admin orders with filters
// @route   GET /api/admin/orders
// @access  Private (Admin)
export const getAdminOrders = async (req, res) => {
  try {
    const { page = 1, limit = 10, status } = req.query;
    
    const filter = {};
    if (status && status !== 'all') {
      filter.orderStatus = status;
    }

    const orders = await Order.find(filter)
      .populate('customer')
      .populate('items.product')
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await Order.countDocuments(filter);

    // Calculate order stats by status
    const orderStats = {
      total: await Order.countDocuments(),
      pending: await Order.countDocuments({ orderStatus: 'pending' }),
      confirmed: await Order.countDocuments({ orderStatus: 'confirmed' }),
      preparing: await Order.countDocuments({ orderStatus: 'preparing' }),
      delivered: await Order.countDocuments({ orderStatus: 'delivered' }),
      outForDelivery: await Order.countDocuments({ orderStatus: 'out_for_delivery' }),
      cancelled: await Order.countDocuments({ orderStatus: 'cancelled' })
    };

    res.status(200).json({
      success: true,
      orders,
      orderStats,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(total / limit),
        totalOrders: total
      }
    });
  } catch (error) {
    console.error('Get Admin Orders Error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

// @desc    Update order status
// @route   PUT /api/admin/orders/:orderId/status
// @access  Private (Admin)
export const updateOrderStatus = async (req, res) => {
  try {
    const { status } = req.body;
    
    const validStatuses = ['pending', 'confirmed', 'preparing', 'out_for_delivery', 'delivered', 'cancelled'];
    
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid order status'
      });
    }

    const order = await Order.findOne({ orderId: req.params.orderId });
    
    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    order.orderStatus = status;
    await order.save();

    res.status(200).json({
      success: true,
      message: 'Order status updated successfully',
      order
    });
  } catch (error) {
    console.error('Update Order Status Error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

// @desc    Get invoice summary
// @route   GET /api/admin/invoices
// @access  Private (Admin)
export const getInvoiceSummary = async (req, res) => {
  try {
    const { page = 1, limit = 10, status } = req.query;

    const filter = {};
    if (status && status !== 'all') {
      filter.paymentStatus = status;
    }

    const invoices = await Order.find(filter)
      .populate('customer')
      .select('orderId finalAmount paymentStatus orderStatus createdAt customer')
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await Order.countDocuments(filter);

    // Calculate invoice stats
    const totalRevenueResult = await Order.aggregate([
      { $match: { paymentStatus: 'paid' } },
      { $group: { _id: null, total: { $sum: '$finalAmount' } } }
    ]);

    const pendingPaymentsResult = await Order.aggregate([
      { $match: { paymentStatus: 'pending' } },
      { $group: { _id: null, total: { $sum: '$finalAmount' } } }
    ]);

    const paidInvoices = await Order.countDocuments({ paymentStatus: 'paid' });

    res.status(200).json({
      success: true,
      invoices: invoices.map(invoice => ({
        id: invoice.orderId,
        customer: invoice.customer?.personalInfo?.fullName || 'N/A',
        amount: invoice.finalAmount,
        status: invoice.paymentStatus,
        orderStatus: invoice.orderStatus,
        date: invoice.createdAt
      })),
      invoiceStats: {
        totalInvoices: total,
        totalRevenue: totalRevenueResult[0]?.total || 0,
        pendingPayments: pendingPaymentsResult[0]?.total || 0,
        paidInvoices: paidInvoices
      },
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(total / limit),
        totalInvoices: total
      }
    });
  } catch (error) {
    console.error('Get Invoice Summary Error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

// @desc    Generate overall invoice PDF for all orders
// @route   GET /api/admin/invoices/pdf
// @access  Private (Admin)
export const generateOverallInvoice = async (req, res) => {
  try {
    const { status, startDate, endDate } = req.query;

    const filter = {};
    if (status && status !== 'all') {
      filter.paymentStatus = status;
    }
    if (startDate && endDate) {
      filter.createdAt = {
        $gte: new Date(startDate),
        $lte: new Date(endDate)
      };
    }

    const orders = await Order.find(filter)
      .populate('customer', 'personalInfo.fullName')
      .populate('items.product', 'name')
      .sort({ createdAt: -1 });

    if (orders.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'No orders found for the selected criteria'
      });
    }

    // Create a new PDF document
    const PDFDocument = (await import('pdfkit')).default;
    const doc = new PDFDocument({
      size: 'A4',
      margin: 50,
      info: {
        Title: 'Overall Invoice Summary',
        Author: 'Dairy 9',
        Subject: 'Invoice Summary Report',
        Keywords: 'invoice, summary, dairy, report',
        Creator: 'Dairy 9 System',
        CreationDate: new Date()
      }
    });

    // Set response headers for PDF download
    const filename = `overall-invoice-${new Date().toISOString().split('T')[0]}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=${filename}`);

    // Pipe the PDF to the response
    doc.pipe(res);

    // Add professional diagonal watermark
    const addWatermark = () => {
      doc.save();

      // Set watermark properties
      const watermarkText = 'DAIRY 9';
      const watermarkOpacity = 0.03; // Very subtle professional opacity
      const rotationAngle = -30; // Diagonal angle
      const fontSize = 120;

      // Calculate center position
      const centerX = doc.page.width / 2;
      const centerY = doc.page.height / 2;

      doc.fillColor('black')
         .font('Helvetica-Bold')
         .fontSize(fontSize)
         .opacity(watermarkOpacity)
         .rotate(rotationAngle, { origin: [centerX, centerY] })
         .text(watermarkText, centerX - 200, centerY - 30, {
           align: 'center',
           width: 400
         })
         .rotate(-rotationAngle, { origin: [centerX, centerY] });

      doc.restore();
    };

    // Add watermark to the page
    addWatermark();

    // Professional Header with proper logo handling
    const headerTop = 50;

    // Company logo with proper aspect ratio
    const logoPath = path.join(__dirname, '../assets/images/logo.jpeg');
    if (fs.existsSync(logoPath)) {
      // Maintain original aspect ratio - smaller size to prevent overlap
      const logoWidth = 120;
      const logoHeight = 120;

      doc.image(logoPath, 50, headerTop, {
        width: logoWidth,
        height: logoHeight,
        fit: [logoWidth, logoHeight],
        align: 'left',
        valign: 'top'
      });

      // Company info positioned below the logo with proper spacing
      doc.fillColor('#87CEEB')
         .fontSize(28)
         .font('Courier-Bold')
         .text('DAIRY 9', 200, headerTop + 20);

      doc.fillColor('#666666')
         .fontSize(10)
         .font('Helvetica')
         .text('Fresh Dairy Products Delivered Daily', 200, headerTop + 55)
         .text('123 Dairy Lane, Milk City, MC 12345', 200, headerTop + 70)
         .text('Phone: +1 (555) 123-4567 | Email: info@dairy9.com', 200, headerTop + 85);
    } else {
      // Fallback if logo doesn't exist
      doc.fillColor('#87CEEB')
         .fontSize(28)
         .font('Courier-Bold')
         .text('DAIRY 9', 50, headerTop);

      doc.fillColor('#666666')
         .fontSize(10)
         .font('Helvetica')
         .text('Fresh Dairy Products Delivered Daily', 50, headerTop + 35)
         .text('123 Dairy Lane, Milk City, MC 12345', 50, headerTop + 50)
         .text('Phone: +1 (555) 123-4567 | Email: info@dairy9.com', 50, headerTop + 65);
    }

    // Invoice title section - properly spaced below header
    const invoiceTop = headerTop + 120;
    doc.fillColor('#333333')
       .fontSize(28)
       .font('Helvetica-Bold')
       .text('OVERALL INVOICE SUMMARY', 0, invoiceTop, { align: 'center' });

    doc.fillColor('#2E8B57')
       .fontSize(12)
       .font('Helvetica-Oblique')
       .text('Consolidated Invoice Report', 0, invoiceTop + 35, { align: 'center' });

    // Separator line
    doc.moveTo(50, invoiceTop + 60)
       .lineTo(545, invoiceTop + 60)
       .lineWidth(1)
       .strokeColor('#2E8B57')
       .stroke();

    // Report details section
    const detailsTop = invoiceTop + 80;

    doc.fillColor('#333333')
       .fontSize(11)
       .font('Helvetica-Bold')
       .text('REPORT DETAILS', 50, detailsTop);

    doc.fillColor('#666666')
       .fontSize(10)
       .font('Helvetica')
       .text(`Report Generated: ${new Date().toLocaleDateString('en-IN', {
         year: 'numeric',
         month: 'long',
         day: 'numeric'
       })}`, 50, detailsTop + 20, { width: 240 });

    if (startDate && endDate) {
      doc.text(`Period: ${new Date(startDate).toLocaleDateString('en-IN', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      })} to ${new Date(endDate).toLocaleDateString('en-IN', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      })}`, 50, detailsTop + 35, { width: 240 });
    }

    // Summary stats
    const totalOrders = orders.length;
    const totalRevenue = orders.reduce((sum, order) => sum + order.finalAmount, 0);
    const paidOrders = orders.filter(order => order.paymentStatus === 'paid').length;
    const pendingOrders = orders.filter(order => order.paymentStatus === 'pending').length;

    doc.fillColor('#333333')
       .fontSize(11)
       .font('Helvetica-Bold')
       .text('SUMMARY STATISTICS', 320, detailsTop);

    doc.fillColor('#666666')
       .fontSize(10)
       .font('Helvetica')
       .text(`Total Orders: ${totalOrders}`, 320, detailsTop + 20, { width: 200 })
       .text(`Total Revenue: ₹${totalRevenue.toFixed(2)}`, 320, detailsTop + 35, { width: 200 })
       .text(`Paid Orders: ${paidOrders}`, 320, detailsTop + 50, { width: 200 })
       .text(`Pending Payments: ${pendingOrders}`, 320, detailsTop + 65, { width: 200 });

    // Orders table
    const tableTop = detailsTop + 100;

    // Table header
    doc.rect(50, tableTop, 495, 20)
       .fillColor('#2E8B57')
       .fill();

    doc.fillColor('white')
       .fontSize(10)
       .font('Helvetica-Bold')
       .text('ORDER ID', 60, tableTop + 6)
       .text('CUSTOMER', 140, tableTop + 6)
       .text('DATE', 280, tableTop + 6)
       .text('STATUS', 380, tableTop + 6)
       .text('AMOUNT', 470, tableTop + 6, { width: 60, align: 'right' });

    // Table rows
    let currentY = tableTop + 25;
    orders.forEach((order, index) => {
      // Alternate row colors
      if (index % 2 === 0) {
        doc.rect(50, currentY - 5, 495, 20)
           .fillColor('#F8F9FA')
           .fill();
      }

      const orderId = order.orderId;
      const customerName = order.customer?.personalInfo?.fullName || 'N/A';
      const date = new Date(order.createdAt).toLocaleDateString('en-IN');
      const status = order.paymentStatus.charAt(0).toUpperCase() + order.paymentStatus.slice(1);
      const amount = `₹${order.finalAmount.toFixed(2)}`;

      doc.fillColor('#333333')
         .fontSize(9)
         .font('Helvetica')
         .text(orderId, 60, currentY, { width: 70 })
         .text(customerName, 140, currentY, { width: 130 })
         .text(date, 280, currentY, { width: 90 })
         .text(status, 380, currentY, { width: 80 })
         .text(amount, 470, currentY, { width: 60, align: 'right' });

      currentY += 20;
    });

    // Table bottom border
    doc.rect(50, currentY - 5, 495, 1)
       .fillColor('#E0E0E0')
       .fill();

    // Totals section
    const totalsTop = currentY + 15;

    // Totals box
    doc.rect(345, totalsTop, 200, 45)
       .fillColor('#F8F9FA')
       .fill()
       .strokeColor('#E0E0E0')
       .stroke();

    doc.fillColor('#333333')
       .fontSize(12)
       .font('Helvetica-Bold')
       .text('GRAND TOTAL:', 355, totalsTop + 15)
       .text(`₹${totalRevenue.toFixed(2)}`, 515, totalsTop + 15, { align: 'right', width: 70 });

    // Footer section
    const footerTop = doc.page.height - 100;

    // Footer separator
    doc.moveTo(50, footerTop)
       .lineTo(545, footerTop)
       .strokeColor('#2E8B57')
       .stroke();

    // Footer content - center aligned greeting message
    doc.fillColor('#666666')
       .fontSize(10)
       .font('Helvetica-Bold')
       .text('Thank you for choosing Dairy 9!', 0, footerTop + 15, { align: 'center' });

    doc.fillColor('#666666')
       .fontSize(8)
       .font('Helvetica')
       .text('For any queries regarding this report, please contact our support team.', 0, footerTop + 30, { align: 'center' })
       .text('Email: support@dairy9.com | Phone: +1 (555) 123-4567', 0, footerTop + 43, { align: 'center' })
       .text(`Report generated on ${new Date().toLocaleDateString('en-IN')} at ${new Date().toLocaleTimeString('en-IN', {
         hour: '2-digit',
         minute: '2-digit'
       })}`, 0, footerTop + 56, { align: 'center' })
       .text('Fresh Dairy Products Delivered Daily', 0, footerTop + 69, { align: 'center' });

    // Finalize the PDF
    doc.end();

  } catch (error) {
    console.error('Generate Overall Invoice Error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};
