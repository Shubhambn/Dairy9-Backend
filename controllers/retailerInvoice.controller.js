// controllers/retailerInvoice.controller.js
import PDFDocument from 'pdfkit';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import StockOrder from '../models/stockOrder.model.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// @desc    Generate retailer stock order invoice PDF
// @route   GET /api/admin/stock-orders/:id/invoice
// @access  Private (admin or retailer)
export const generateRetailerStockOrderInvoice = async (req, res) => {
  try {
    const userId = req.user?._id;
    const orderId = req.params.id;

    // Build query and restrict for retailer users
    let orderQuery = { _id: orderId };
    if (req.user?.role === 'retailer') {
      orderQuery.retailer = userId;
    }

    const order = await StockOrder.findOne(orderQuery)
      .populate('items.product', 'name sku unitPrice')
      .populate('retailer', 'fullName shopName contactNumber address location');

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Stock order not found'
      });
    }

    // Create PDFDocument
    const doc = new PDFDocument({
      size: 'A4',
      margin: 50,
      info: {
        Title: `Stock Order Invoice - ${order.orderNumber || order._id}`,
        Author: 'Dairy Nine Foods',
        Subject: 'Stock Order Invoice',
        Creator: 'Dairy Nine Foods System',
        CreationDate: new Date()
      }
    });

    // Response headers
    const filename = `invoice-${order.orderNumber || String(order._id)}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename=${filename}`);
    res.setHeader('Cache-Control', 'no-cache');

    // Pipe PDF to response
    doc.pipe(res);

    // Theme colors
    const primaryColor = '#1e88e5';
    const darkColor = '#1565c0';
    const textColor = '#333333';
    const borderColor = '#e0e0e0';

    const pageWidth = doc.page.width - 100;
    const centerX = doc.page.width / 2;

    // Background watermark
    doc.save();
    doc.fillColor('#f8fdff').rect(0, 0, doc.page.width, doc.page.height).fill();
    doc.fillColor('rgba(30, 136, 229, 0.03)')
       .fontSize(72)
       .font('Helvetica-Bold')
       .text('DAIRY NINE FOODS', -100, doc.page.height / 2 - 100, {
         width: doc.page.width + 200,
         align: 'center',
         rotation: -45
       });

    doc.fillColor('rgba(30, 136, 229, 0.02)')
       .fontSize(68)
       .font('Helvetica-Bold')
       .text('FRESH DAIRY', -150, doc.page.height / 2 + 50, {
         width: doc.page.width + 300,
         align: 'center',
         rotation: -45
       });
    doc.restore();

    // Decorative header background
    doc.fillColor(primaryColor).rect(0, 0, doc.page.width, 120).fill();

    // App logo (try to load asset, fallback to text)
    try {
      const logoPath = path.join(__dirname, '../assets/images/applogo.png');
      if (fs.existsSync(logoPath)) {
        doc.image(logoPath, centerX - 60, 25, { width: 120, height: 60 });
      } else {
        doc.fillColor('#ffffff')
           .fontSize(24)
           .font('Helvetica-Bold')
           .text('DAIRY NINE FOODS', centerX - 120, 45);
      }
    } catch (logoErr) {
      console.warn('Logo not found, using text fallback', logoErr);
      doc.fillColor('#ffffff')
         .fontSize(24)
         .font('Helvetica-Bold')
         .text('DAIRY NINE FOODS', centerX - 120, 45);
    }

    // Small subtitle
    doc.fillColor('#ffffff')
       .fontSize(12)
       .font('Helvetica')
       .text('Fresh Dairy Delivered Daily', centerX - 80, 85, { align: 'center' });

    // Invoice title box
    const invoiceBoxY = 140;
    doc.fillColor('#ffffff').strokeColor(darkColor).lineWidth(2).rect(50, invoiceBoxY, pageWidth, 60).fill().stroke();

    doc.fillColor(darkColor).fontSize(20).font('Helvetica-Bold').text('STOCK ORDER INVOICE', 70, invoiceBoxY + 20);

    doc.fillColor(textColor).fontSize(14).font('Helvetica-Bold').text(`#${order.orderNumber || order._id}`, 200, invoiceBoxY + 15);

    doc.fillColor(textColor).fontSize(12).font('Helvetica')
       .text('Date:', 200, invoiceBoxY + 35)
       .text(new Date(order.createdAt).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' }), 230, invoiceBoxY + 35);

    // Status (if present)
    const statusText = (order.status || order.orderStatus || 'Pending').toString();
    doc.fillColor(textColor).fontSize(12).font('Helvetica').text('Status:', 350, invoiceBoxY + 35).text(statusText, 395, invoiceBoxY + 35);

    // Company and Retailer info
    const infoSectionY = invoiceBoxY + 80;

    // Company box
    doc.fillColor('#ffffff').strokeColor(borderColor).lineWidth(1).rect(50, infoSectionY, pageWidth / 2 - 20, 120).fill().stroke();
    doc.fillColor(darkColor).fontSize(14).font('Helvetica-Bold').text('FROM:', 70, infoSectionY + 20);
    doc.fillColor(textColor).fontSize(11).font('Helvetica-Bold').text("Dairy Nine Food's", 70, infoSectionY + 45);
    doc.fontSize(10).font('Helvetica')
       .text('Urulikanchan, Pune - 412202', 70, infoSectionY + 65)
       .text('Contact: 9552524301 / 9552524306', 70, infoSectionY + 85)
       .text('Email: info@dairyninefoods.com', 70, infoSectionY + 105);

    // Retailer box
    doc.fillColor('#ffffff').strokeColor(borderColor).lineWidth(1).rect(pageWidth / 2 + 70, infoSectionY, pageWidth / 2 - 20, 120).fill().stroke();
    doc.fillColor(darkColor).fontSize(14).font('Helvetica-Bold').text('BILL TO:', pageWidth / 2 + 90, infoSectionY + 20);

    const retailerName = order.retailer?.shopName || order.retailer?.fullName || 'Retailer';
    const contactNumber = order.retailer?.contactNumber || 'N/A';
    const address = order.retailer?.address || 'N/A';

    let fullAddress = address;
    if (order.retailer?.location) {
      const loc = order.retailer.location;
      if (loc.formattedAddress) fullAddress = loc.formattedAddress;
      else {
        const parts = [];
        if (loc.city) parts.push(loc.city);
        if (loc.state) parts.push(loc.state);
        if (loc.pincode) parts.push(loc.pincode);
        if (parts.length) fullAddress += `, ${parts.join(', ')}`;
      }
    }

    doc.fillColor(textColor).fontSize(11).font('Helvetica-Bold').text(retailerName, pageWidth / 2 + 90, infoSectionY + 45);
    doc.fontSize(10).font('Helvetica')
       .text(`Phone: ${contactNumber}`, pageWidth / 2 + 90, infoSectionY + 65)
       .text(`Shop: ${retailerName}`, pageWidth / 2 + 90, infoSectionY + 85)
       .text(`Address: ${fullAddress}`, pageWidth / 2 + 90, infoSectionY + 105, { width: 200 });

    // Table header
    const tableTop = infoSectionY + 150;
    doc.fillColor(primaryColor).rect(50, tableTop, pageWidth, 30).fill();
    doc.fillColor('#ffffff').fontSize(12).font('Helvetica-Bold');

    // columns - tailored for stock orders: product, sku, unit price, req qty, ful qty, amount
    const col1 = 60;
    const col2 = 250;
    const col3 = 350;
    const col4 = 430;
    const col5 = 510;
    const col6 = 580;

    doc.text('PRODUCT', col1, tableTop + 10);
    doc.text('SKU', col2, tableTop + 10);
    doc.text('UNIT PRICE', col3, tableTop + 10);
    doc.text('REQ QTY', col4, tableTop + 10);
    doc.text('FUL QTY', col5, tableTop + 10);
    doc.text('AMOUNT', col6, tableTop + 10);

    // Table rows
    let currentY = tableTop + 35;
    let totalRequested = 0;
    let totalFulfilled = 0;
    let totalAmount = 0;

    // Support multiple field name variants from schema
    const items = Array.isArray(order.items) ? order.items : [];

    items.forEach((item, index) => {
      if (index % 2 === 0) {
        doc.fillColor('#f8fdff').rect(50, currentY - 5, pageWidth, 25).fill();
      }

      const productName = item.product?.name || item.name || 'Product';
      const sku = item.product?.sku || item.sku || 'N/A';
      // unitPrice may be stored in item.unitPrice, item.price, or product.unitPrice
      const unitPrice = Number(item.unitPrice ?? item.price ?? item.product?.unitPrice ?? 0);
      // quantity/requestedQty may use different keys
      const requestedQty = Number(item.requestedQty ?? item.quantity ?? item.qty ?? 0);
      const fulfilledQty = Number(item.fulfilledQty ?? item.fulfilled ?? 0);
      const amount = unitPrice * requestedQty;

      totalRequested += requestedQty;
      totalFulfilled += fulfilledQty;
      totalAmount += amount;

      doc.fillColor(textColor).fontSize(10).font('Helvetica')
         .text(productName, col1, currentY, { width: 180 })
         .text(sku, col2, currentY, { width: 90 })
         .text(`₹${unitPrice.toFixed(2)}`, col3, currentY)
         .text(String(requestedQty), col4, currentY)
         .text(String(fulfilledQty), col5, currentY)
         .text(`₹${amount.toFixed(2)}`, col6, currentY);

      currentY += 25;
      // If page overflow, add a page and continue table header
      if (currentY > doc.page.height - 160) {
        doc.addPage();
        currentY = 80; // simple reset; header not repeated for brevity
      }
    });

    // Totals section
    const totalSectionY = currentY + 20;
    doc.strokeColor(borderColor).lineWidth(1).moveTo(400, totalSectionY - 10).lineTo(545, totalSectionY - 10).stroke();

    doc.fillColor(textColor).fontSize(11).font('Helvetica-Bold')
       .text('Total Requested:', 400, totalSectionY)
       .text(totalRequested.toString(), 500, totalSectionY);

    doc.text('Total Fulfilled:', 400, totalSectionY + 20)
       .text(totalFulfilled.toString(), 500, totalSectionY + 20);

    doc.text('Subtotal:', 400, totalSectionY + 40)
       .text(`₹ ${totalAmount.toFixed(2)}`, 500, totalSectionY + 40);

    // Grand total
    doc.fillColor(darkColor).fontSize(14).font('Helvetica-Bold')
       .text('GRAND TOTAL:', 400, totalSectionY + 65)
       .text(`₹ ${totalAmount.toFixed(2)}`, 500, totalSectionY + 65);

    // Amount in words
    const wordsSectionY = totalSectionY + 100;
    doc.fillColor(primaryColor).rect(50, wordsSectionY, pageWidth, 60).fill();
    const amountInWords = convertToWords(totalAmount);
    doc.fillColor('#ffffff').fontSize(10).font('Helvetica').text(`Indian Rupees ${amountInWords} Only`, 60, wordsSectionY + 25, { width: 480 });

    // Order notes if present
    if (order.notes && Array.isArray(order.notes) && order.notes.length) {
      const notesY = wordsSectionY + 80;
      doc.fillColor(textColor).fontSize(11).font('Helvetica-Bold').text('Order Notes:', 60, notesY);
      order.notes.forEach((note, i) => {
        const y = notesY + 20 + i * 15;
        doc.fontSize(9).font('Helvetica').text(`${new Date(note.at || note.createdAt || Date.now()).toLocaleDateString()} - ${note.text || note}`, 60, y, { width: 480 });
      });
    }

    // Footer
    const footerY = doc.page.height - 120;
    doc.fillColor(textColor).fontSize(12).font('Helvetica-Bold').text('Thank you for your business!', centerX - 100, footerY, { align: 'center' });
    doc.fontSize(10).font('Helvetica').text('We appreciate your partnership with Dairy Nine Foods', centerX - 150, footerY + 20, { align: 'center' });

    // Signature line
    doc.strokeColor(borderColor).lineWidth(1).moveTo(400, footerY + 50).lineTo(545, footerY + 50).stroke();
    doc.fillColor(textColor).fontSize(10).text('Authorized Signatory', 450, footerY + 60, { align: 'center' });

    // Contact footer
    doc.fillColor(borderColor).fontSize(9).text('For any queries, contact: 9552524301 | Email: support@dairyninefoods.com', centerX - 180, doc.page.height - 40, { align: 'center' });

    // Final decorative border
    doc.strokeColor(primaryColor).lineWidth(2).rect(45, 45, 505, doc.page.height - 90).stroke();

    // Finalize
    doc.end();
  } catch (error) {
    console.error('Generate Retailer Invoice Error:', error);
    res.status(500).json({
      success: false,
      message: 'Error generating retailer invoice',
      error: error?.message || String(error)
    });
  }
};

// Improved convertToWords (Indian numbering)
const convertToWords = (amount) => {
  const units = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine'];
  const teens = ['Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

  if (!amount || Number(amount) === 0) return 'Zero';

  let num = Math.floor(amount);
  const paise = Math.round((Number(amount) - num) * 100);
  let words = '';

  const getTwoDigits = (n) => {
    let str = '';
    if (n < 10) str = units[n];
    else if (n < 20) str = teens[n - 10];
    else {
      str = tens[Math.floor(n / 10)];
      if (n % 10) str += ' ' + units[n % 10];
    }
    return str;
  };

  const parts = [];

  const crore = Math.floor(num / 10000000);
  if (crore) { parts.push(`${convertToWords(crore)} Crore`); num %= 10000000; }

  const lakh = Math.floor(num / 100000);
  if (lakh) { parts.push(`${convertToWords(lakh)} Lakh`); num %= 100000; }

  const thousand = Math.floor(num / 1000);
  if (thousand) { parts.push(`${convertToWords(thousand)} Thousand`); num %= 1000; }

  const hundred = Math.floor(num / 100);
  if (hundred) { parts.push(`${units[hundred]} Hundred`); num %= 100; }

  if (num > 0) {
    if (parts.length) parts.push('and');
    parts.push(getTwoDigits(num));
  }

  words = parts.join(' ').replace(/\s+/g, ' ').trim();

  if (paise > 0) {
    const paiseWords = getTwoDigits(paise);
    words += ` and ${paiseWords} Paise`;
  }

  return words + ' Only';
};
