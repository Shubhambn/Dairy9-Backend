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
      .populate('customer', 'personalInfo.fullName personalInfo.phone personalInfo.email address');

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

    // Colors for the theme
    const primaryColor = '#1e88e5'; // Light blue
    const darkColor = '#1565c0'; // Darker blue
    const textColor = '#333333'; // Dark gray for text
    const borderColor = '#e0e0e0'; // Light gray for borders

    // Page dimensions
    const pageWidth = doc.page.width - 100;
    const centerX = doc.page.width / 2;

    // Add watermark background FIRST - behind all content
    doc.fillColor('#f8fdff') // Very light blue
       .rect(0, 0, doc.page.width, doc.page.height)
       .fill();

    // Add diagonal watermark - very faint and transparent
    doc.fillColor('rgba(30, 136, 229, 0.03)') // Almost transparent light blue
       .fontSize(72)
       .font('Helvetica-Bold')
       .text('DAIRY NINE FOODS', -100, doc.page.height / 2 - 100, {
         width: doc.page.width + 200,
         align: 'center',
         rotation: -45 // Diagonal from bottom-left to top-right
       });

    // Add second layer of watermark for better coverage
    doc.fillColor('rgba(30, 136, 229, 0.02)')
       .fontSize(68)
       .font('Helvetica-Bold')
       .text('FRESH DAIRY', -150, doc.page.height / 2 + 50, {
         width: doc.page.width + 300,
         align: 'center',
         rotation: -45
       });

    // Add decorative header background
    doc.fillColor(primaryColor)
       .rect(0, 0, doc.page.width, 120)
       .fill();

    // Add app logo (centered in header)
    try {
      const logoPath = path.join(__dirname, '../assets/images/applogo.png');
      if (fs.existsSync(logoPath)) {
        doc.image(logoPath, centerX - 60, 25, { width: 120, height: 60 });
      } else {
        // Fallback text logo
        doc.fillColor('#ffffff')
           .fontSize(24)
           .font('Helvetica-Bold')
           .text('DAIRY NINE FOODS', centerX - 120, 45);
      }
    } catch (error) {
      console.warn('Logo not found, using text fallback');
      doc.fillColor('#ffffff')
         .fontSize(24)
         .font('Helvetica-Bold')
         .text('DAIRY NINE FOODS', centerX - 120, 45);
    }

    // Invoice header section
    doc.fillColor('#ffffff')
       .fontSize(12)
       .font('Helvetica')
       .text('Fresh Dairy Delivered Daily', centerX - 80, 85, { align: 'center' });

    // Invoice title box
    const invoiceBoxY = 140;
    doc.fillColor('#ffffff')
       .strokeColor(darkColor)
       .lineWidth(2)
       .rect(50, invoiceBoxY, pageWidth, 60)
       .fill()
       .stroke();

    doc.fillColor(darkColor)
       .fontSize(20)
       .font('Helvetica-Bold')
       .text('INVOICE', 70, invoiceBoxY + 20);

    doc.fillColor(textColor)
       .fontSize(14)
       .font('Helvetica-Bold')
       .text(`#${order.orderId}`, 200, invoiceBoxY + 15);

    doc.fillColor(textColor)
       .fontSize(12)
       .font('Helvetica')
       .text('Date:', 200, invoiceBoxY + 35)
       .text(new Date(order.createdAt).toLocaleDateString('en-GB', {
         day: '2-digit',
         month: '2-digit',
         year: 'numeric'
       }), 230, invoiceBoxY + 35);

    // Company and Customer Information Section
    const infoSectionY = invoiceBoxY + 80;

    // Company Information Box
    doc.fillColor('#ffffff')
       .strokeColor(borderColor)
       .lineWidth(1)
       .rect(50, infoSectionY, pageWidth/2 - 20, 120)
       .fill()
       .stroke();

    doc.fillColor(darkColor)
       .fontSize(14)
       .font('Helvetica-Bold')
       .text('FROM:', 70, infoSectionY + 20);

    doc.fillColor(textColor)
       .fontSize(11)
       .font('Helvetica-Bold')
       .text("Dairy Nine Food's", 70, infoSectionY + 45);

    doc.fontSize(10)
       .font('Helvetica')
       .text('Urulikanchan, Pune - 412202', 70, infoSectionY + 65)
       .text('Contact: 9552524301 / 9552524306', 70, infoSectionY + 85)
       .text('Email: info@dairyninefoods.com', 70, infoSectionY + 105);

    // Customer Information Box
    doc.fillColor('#ffffff')
       .strokeColor(borderColor)
       .lineWidth(1)
       .rect(pageWidth/2 + 70, infoSectionY, pageWidth/2 - 20, 120)
       .fill()
       .stroke();

    doc.fillColor(darkColor)
       .fontSize(14)
       .font('Helvetica-Bold')
       .text('BILL TO:', pageWidth/2 + 90, infoSectionY + 20);

    const customerName = order.customer?.personalInfo?.fullName || 'Customer';
    doc.fillColor(textColor)
       .fontSize(11)
       .font('Helvetica-Bold')
       .text(customerName, pageWidth/2 + 90, infoSectionY + 45);

    doc.fontSize(10)
       .font('Helvetica')
       .text(`Phone: ${order.customer?.personalInfo?.phone || 'N/A'}`, pageWidth/2 + 90, infoSectionY + 65)
       .text(`Email: ${order.customer?.personalInfo?.email || 'N/A'}`, pageWidth/2 + 90, infoSectionY + 85);

    // Table Section
    const tableTop = infoSectionY + 150;

    // Table Header with blue background
    doc.fillColor(primaryColor)
       .rect(50, tableTop, pageWidth, 30)
       .fill();

    doc.fillColor('#ffffff')
       .fontSize(12)
       .font('Helvetica-Bold');

    const col1 = 60;   // Items
    const col2 = 350;  // Rate
    const col3 = 430;  // Quantity
    const col4 = 500;  // Amount

    doc.text('ITEMS', col1, tableTop + 10);
    doc.text('RATE (₹)', col2, tableTop + 10);
    doc.text('QTY', col3, tableTop + 10);
    doc.text('AMOUNT (₹)', col4, tableTop + 10);

    // Table rows
    let currentY = tableTop + 35;
    let totalQuantity = 0;
    let totalAmount = 0;

    order.items.forEach((item, index) => {
      // Alternate row colors for better readability
      if (index % 2 === 0) {
        doc.fillColor('#f8fdff')
           .rect(50, currentY - 5, pageWidth, 25)
           .fill();
      }

      const productName = item.product?.name || 'Product';
      const rate = item.price;
      const quantity = item.quantity;
      const amount = rate * quantity;

      totalQuantity += quantity;
      totalAmount += amount;

      doc.fillColor(textColor)
         .fontSize(11)
         .font('Helvetica')
         .text(productName, col1, currentY, { width: 270 })
         .text(rate.toFixed(2), col2, currentY)
         .text(quantity.toFixed(2), col3, currentY)
         .text(amount.toFixed(2), col4, currentY);

      currentY += 25;
    });

    // Total section
    const totalSectionY = currentY + 20;

    // Draw separator line
    doc.strokeColor(borderColor)
       .lineWidth(1)
       .moveTo(400, totalSectionY - 10)
       .lineTo(545, totalSectionY - 10)
       .stroke();

    doc.fillColor(textColor)
       .fontSize(11)
       .font('Helvetica-Bold')
       .text('Total Quantity:', 400, totalSectionY)
       .text(totalQuantity.toFixed(2), 500, totalSectionY);

    doc.text('Subtotal:', 400, totalSectionY + 20)
       .text(`₹ ${totalAmount.toFixed(2)}`, 500, totalSectionY + 20);

    // Main total with emphasis
    doc.fillColor(darkColor)
       .fontSize(14)
       .font('Helvetica-Bold')
       .text('GRAND TOTAL:', 400, totalSectionY + 45)
       .text(`₹ ${totalAmount.toFixed(2)}`, 500, totalSectionY + 45);

    // Amount in words section
    const wordsSectionY = totalSectionY + 80;
    
    doc.fillColor(primaryColor)
       .rect(50, wordsSectionY, pageWidth, 60)
       .fill();

    // doc.fillColor('#ffffff')
    //    .fontSize(11)
    //    .font('Helvetica-Bold')
    //    .text('AMOUNT IN WORDS:', 60, wordsSectionY + 15);

    const amountInWords = convertToWords(totalAmount);
    doc.fontSize(10)
       .font('Helvetica')
       .text(`Indian Rupees ${amountInWords} Only`, 60, wordsSectionY + 35, { width: 480 });

    // Footer section - Removed current balance section
    const footerY = wordsSectionY + 80;

    // Thank you message
    doc.fillColor(textColor)
       .fontSize(12)
       .font('Helvetica-Bold')
       .text('Thank you for your business!', centerX - 100, footerY, { align: 'center' });

    doc.fontSize(10)
       .font('Helvetica')
       .text('We appreciate your trust in Dairy Nine Foods', centerX - 120, footerY + 20, { align: 'center' });

    // Signature area
    doc.strokeColor(borderColor)
       .lineWidth(1)
       .moveTo(400, footerY + 50)
       .lineTo(545, footerY + 50)
       .stroke();

    doc.fillColor(textColor)
       .fontSize(10)
       .text('Authorized Signatory', 450, footerY + 60, { align: 'center' });

    // Contact information in footer
    doc.fillColor(borderColor)
       .fontSize(9)
       .text('For any queries, contact: 9552524301 | Email: support@dairyninefoods.com', centerX - 180, doc.page.height - 40, { align: 'center' });

    // Final border
    doc.strokeColor(primaryColor)
       .lineWidth(2)
       .rect(45, 45, 505, doc.page.height - 90)
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

// Enhanced number to words converter
const convertToWords = (amount) => {
  const units = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine'];
  const teens = ['Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  const thousands = ['', 'Thousand', 'Lakh', 'Crore'];

  if (amount === 0) return 'Zero Only';

  let num = Math.floor(amount);
  let paise = Math.round((amount - num) * 100);
  let words = '';

  if (num >= 10000000) {
    words += convertToWords(Math.floor(num / 10000000)) + ' Crore ';
    num %= 10000000;
  }

  if (num >= 100000) {
    words += convertToWords(Math.floor(num / 100000)) + ' Lakh ';
    num %= 100000;
  }

  if (num >= 1000) {
    words += convertToWords(Math.floor(num / 1000)) + ' Thousand ';
    num %= 1000;
  }

  if (num >= 100) {
    words += units[Math.floor(num / 100)] + ' Hundred ';
    num %= 100;
  }

  if (num > 0) {
    if (num < 10) {
      words += units[num];
    } else if (num < 20) {
      words += teens[num - 10];
    } else {
      words += tens[Math.floor(num / 10)];
      if (num % 10 > 0) {
        words += ' ' + units[num % 10];
      }
    }
  }

  if (paise > 0) {
    words += ' and ';
    if (paise < 10) {
      words += units[paise] + ' Paise';
    } else if (paise < 20) {
      words += teens[paise - 10] + ' Paise';
    } else {
      words += tens[Math.floor(paise / 10)];
      if (paise % 10 > 0) {
        words += ' ' + units[paise % 10] + ' Paise';
      } else {
        words += ' Paise';
      }
    }
  }

  return words.trim() + ' Only';
};