import PDFDocument from 'pdfkit';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Order from '../models/order.model.js';
import Customer from '../models/customer.model.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// @desc    Generate invoice PDF
// @route   GET /api/orders/:id/invoice
// @access  Private
export const generateInvoice = async (req, res) => {
  try {
    const userId = req.user._id;

    let orderQuery = { orderId: req.params.id };

    // If user is not admin, restrict to their own orders
    if (req.user.role !== 'admin') {
      const customer = await Customer.findOne({ user: userId });
      if (!customer) {
        return res.status(404).json({
          success: false,
          message: 'Customer profile not found'
        });
      }
      orderQuery.customer = customer._id;
    }

    const order = await Order.findOne(orderQuery)
      .populate('items.product', 'name unit')
      .populate('customer', 'personalInfo.fullName personalInfo.phone personalInfo.email');

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    // Create a new PDF document
    const doc = new PDFDocument({
      size: 'A4',
      margin: 50,
      info: {
        Title: `Invoice - ${order.orderId}`,
        Author: 'Dairy Nine Foods',
        Subject: 'Order Invoice',
        Keywords: 'invoice, order, dairy, receipt',
        Creator: 'Dairy Nine Foods System',
        CreationDate: new Date()
      }
    });

    // Set response headers for PDF download
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename=invoice-${order.orderId}.pdf`);
    res.setHeader('Cache-Control', 'no-cache');

    // Pipe the PDF to the response
    doc.pipe(res);

    // Simple layout matching the image exactly
    const pageWidth = doc.page.width - 100; // 50px margins on both sides

    // Header Section - Top Left
    doc.fontSize(20)
       .font('Helvetica-Bold')
       .fillColor('black')
       .text('INVOICE', 50, 50, { continued: true })
       .text(`    ${order.orderId}`, { continued: true })
       .text(`    ${new Date(order.createdAt).toLocaleDateString('en-GB')}`, { width: pageWidth });

    // Company Information - Simple format
    doc.fontSize(12)
       .font('Helvetica')
       .text("Dairy Nine Food's..", 50, 90)
       .fontSize(10)
       .text('Urulikanchan', 50, 110)
       .text('Pune', 50, 125)
       .text('412202', 50, 140)
       .text('Contact:', 50, 155)
       .text('9552524301 /', 50, 170)
       .text('9552524306', 50, 185);

    // Customer Information
    doc.fontSize(10)
       .text('TO,', 300, 110)
       .font('Helvetica-Bold')
       .text(order.customer?.personalInfo?.fullName || 'Customer', 300, 125)
       .font('Helvetica')
       .text(`Contact: ${order.customer?.personalInfo?.phone || 'N/A'}`, 300, 140);

    // Table Header
    const tableTop = 220;
    const col1 = 50;   // Items
    const col2 = 350;  // Rate
    const col3 = 420;  // Quantity
    const col4 = 480;  // Amount

    // Draw table lines
    doc.moveTo(50, tableTop)
       .lineTo(545, tableTop)
       .stroke();

    // Table headers
    doc.fontSize(10)
       .font('Helvetica-Bold')
       .text('Items', col1, tableTop + 10)
       .text('Rate', col2, tableTop + 10)
       .text('Quantity', col3, tableTop + 10)
       .text('Amount', col4, tableTop + 10);

    doc.moveTo(50, tableTop + 30)
       .lineTo(545, tableTop + 30)
       .stroke();

    // Table rows
    let currentY = tableTop + 40;
    let totalQuantity = 0;
    let totalAmount = 0;

    order.items.forEach((item) => {
      const productName = item.product?.name || 'Product';
      const rate = item.price;
      const quantity = item.quantity;
      const amount = rate * quantity;

      totalQuantity += quantity;
      totalAmount += amount;

      doc.fontSize(10)
         .font('Helvetica')
         .text(productName, col1, currentY, { width: 280 })
         .text(`₹ ${rate.toFixed(2)}`, col2, currentY)
         .text(quantity.toFixed(2), col3, currentY)
         .text(`₹ ${amount.toFixed(2)}`, col4, currentY);

      currentY += 20;
    });

    // Total row
    doc.moveTo(50, currentY + 10)
       .lineTo(545, currentY + 10)
       .stroke();

    doc.fontSize(10)
       .font('Helvetica')
       .text('', col1, currentY + 20)
       .text('', col2, currentY + 20)
       .text(totalQuantity.toFixed(2), col3, currentY + 20)
       .text(`₹ ${totalAmount.toFixed(2)}`, col4, currentY + 20);

    // TOTAL section
    const totalSectionY = currentY + 50;
    
    doc.fontSize(10)
       .font('Helvetica-Bold')
       .text('TOTAL', col1, totalSectionY)
       .text(`₹ ${totalAmount.toFixed(2)}`, col4, totalSectionY);

    // Amount in words
    const amountInWords = convertToWords(totalAmount);
    doc.fontSize(10)
       .font('Helvetica')
       .text('Amount in words', col1, totalSectionY + 25)
       .text(`₹ ${amountInWords}`, col1, totalSectionY + 40, { width: 400 });

    // Current Balance (if available in order model)
    const currentBalance = order.currentBalance || 33283.00; // Default fallback
    doc.text(`Current Balance`, col1, totalSectionY + 65)
       .text(`${currentBalance.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`, col4, totalSectionY + 65);

    // Footer - Company name and signature
    const footerY = totalSectionY + 100;
    
    doc.fontSize(12)
       .text("Dairy Nine Food's..", 50, footerY);

    doc.fontSize(10)
       .text('Authorized Signatory', 50, footerY + 40);

    // Simple border around entire content
    doc.rect(45, 45, 505, footerY + 80)
       .stroke();

    // Finalize the PDF
    doc.end();

  } catch (error) {
    console.error('Generate Invoice Error:', error);
    res.status(500).json({
      success: false,
      message: 'Error generating invoice',
      error: error.message
    });
  }
};

// Helper function to convert numbers to words (Indian numbering system)
function convertToWords(num) {
  const ones = ['', 'ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE', 'TEN',
    'ELEVEN', 'TWELVE', 'THIRTEEN', 'FOURTEEN', 'FIFTEEN', 'SIXTEEN', 'SEVENTEEN', 'EIGHTEEN', 'NINETEEN'];
  
  const tens = ['', '', 'TWENTY', 'THIRTY', 'FORTY', 'FIFTY', 'SIXTY', 'SEVENTY', 'EIGHTY', 'NINETY'];
  
  function convertLessThanThousand(n) {
    if (n === 0) return '';
    
    if (n < 20) {
      return ones[n];
    }
    
    if (n < 100) {
      return tens[Math.floor(n / 10)] + (n % 10 !== 0 ? ' ' + ones[n % 10] : '');
    }
    
    return ones[Math.floor(n / 100)] + ' HUNDRED' + (n % 100 !== 0 ? ' AND ' + convertLessThanThousand(n % 100) : '');
  }
  
  if (num === 0) return 'ZERO';
  
  let result = '';
  const integerPart = Math.floor(num);
  
  if (integerPart >= 10000000) {
    result += convertLessThanThousand(Math.floor(integerPart / 10000000)) + ' CRORE ';
    num %= 10000000;
  }
  
  if (integerPart >= 100000) {
    result += convertLessThanThousand(Math.floor(integerPart / 100000)) + ' LAKH ';
    num %= 100000;
  }
  
  if (integerPart >= 1000) {
    result += convertLessThanThousand(Math.floor(integerPart / 1000)) + ' THOUSAND ';
    num %= 1000;
  }
  
  if (integerPart > 0) {
    result += convertLessThanThousand(integerPart);
  }
  
  // Handle decimal part (paise)
  const decimalPart = Math.round((num - integerPart) * 100);
  if (decimalPart > 0) {
    result += ' AND ' + decimalPart + '/100';
  }
  
  return result + ' ONLY';
}