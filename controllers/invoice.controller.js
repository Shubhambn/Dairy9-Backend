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
        Author: 'Dairy 9',
        Subject: 'Order Invoice',
        Keywords: 'invoice, order, dairy, receipt',
        Creator: 'Dairy 9 System',
        CreationDate: new Date()
      }
    });

    // Set response headers for PDF download
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename=invoice-${order.orderId}.pdf`);
    res.setHeader('Cache-Control', 'no-cache');

    // Pipe the PDF to the response
    doc.pipe(res);

    // Add professional diagonal watermark
    const addWatermark = () => {
      doc.save();
      
      // Set watermark properties
      const watermarkText = 'DAIRY 9';
      const watermarkOpacity = 0.05; // Increased opacity for better visibility on larger page
      const rotationAngle = -30; // Diagonal angle
      const fontSize = 150; // Larger font size for A4 page
      
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

    // Call watermark on every page
    doc.on('pageAdded', () => {
      addWatermark();
    });

    // Add watermark to first page
    addWatermark();

    // Professional Header with proper logo handling
    const headerTop = 50;

    // Company logo with proper aspect ratio
    const logoPath = path.join(__dirname, '../assets/images/logo.jpeg');
    if (fs.existsSync(logoPath)) {
      // Maintain original aspect ratio - larger size for better visibility
      const logoWidth = 150;
      const logoHeight = 150;

      doc.image(logoPath, 50, headerTop, {
        width: logoWidth,
        height: logoHeight,
        fit: [logoWidth, logoHeight],
        align: 'left',
        valign: 'top'
      });

      // Company info positioned below the logo with proper spacing
      doc.fillColor('#87CEEB')
         .fontSize(32)
         .font('Courier-Bold')
         .text('DAIRY 9', 220, headerTop + 25);

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
    const invoiceTop = headerTop + 140;
    doc.fillColor('#333333')
       .fontSize(28)
       .font('Helvetica-Bold')
       .text('INVOICE', 0, invoiceTop, { align: 'center' });
    
    doc.fillColor('#2E8B57')
       .fontSize(12)
       .font('Helvetica-Oblique')
       .text('Order Confirmation & Invoice', 0, invoiceTop + 35, { align: 'center' });

    // Separator line
    doc.moveTo(50, invoiceTop + 60)
       .lineTo(545, invoiceTop + 60)
       .lineWidth(1)
       .strokeColor('#2E8B57')
       .stroke();

    // Invoice details section - Two column layout with better spacing
    const detailsTop = invoiceTop + 90;

    // Left column - Invoice Details
    doc.fillColor('#333333')
       .fontSize(11)
       .font('Helvetica-Bold')
       .text('INVOICE DETAILS', 50, detailsTop);

    doc.fillColor('#666666')
       .fontSize(10)
       .font('Helvetica')
       .text(`Invoice Number: ${order.orderId}`, 50, detailsTop + 20, { width: 240 })
       .text(`Invoice Date: ${new Date(order.createdAt).toLocaleDateString('en-IN', {
         year: 'numeric',
         month: 'long',
         day: 'numeric'
       })}`, 50, detailsTop + 35, { width: 240 })
       .text(`Delivery Date: ${new Date(order.deliveryDate).toLocaleDateString('en-IN', {
         year: 'numeric',
         month: 'long',
         day: 'numeric'
       })}`, 50, detailsTop + 50, { width: 240 });

    // Right column - Order Status
    doc.fillColor('#333333')
       .fontSize(11)
       .font('Helvetica-Bold')
       .text('ORDER STATUS', 320, detailsTop);

    const statusColor = order.orderStatus === 'delivered' ? '#4CAF50' :
                       order.orderStatus === 'cancelled' ? '#F44336' : '#FF9800';

    doc.fillColor(statusColor)
       .fontSize(10)
       .font('Helvetica-Bold')
       .text(order.orderStatus.toUpperCase(), 320, detailsTop + 20, { width: 200 });

    doc.fillColor('#666666')
       .fontSize(10)
       .font('Helvetica')
       .text(`Payment: ${order.paymentStatus.charAt(0).toUpperCase() + order.paymentStatus.slice(1)}`, 320, detailsTop + 35, { width: 200 })
       .text(`Method: ${order.paymentMethod.charAt(0).toUpperCase() + order.paymentMethod.slice(1)}`, 320, detailsTop + 50, { width: 200 });

    // Customer information section
    const customerTop = detailsTop + 90;

    doc.fillColor('#333333')
       .fontSize(11)
       .font('Helvetica-Bold')
       .text('BILL TO', 50, customerTop);

    // Customer info box - wider for better spacing
    doc.rect(50, customerTop + 15, 245, 70)
       .fillColor('#F8F9FA')
       .fill()
       .strokeColor('#E0E0E0')
       .stroke();

    doc.fillColor('#333333')
       .fontSize(10)
       .font('Helvetica-Bold')
       .text(order.customer?.personalInfo?.fullName || 'Customer', 60, customerTop + 25, { width: 225 });

    doc.fillColor('#666666')
       .fontSize(9)
       .font('Helvetica')
       .text(`Phone: ${order.customer?.personalInfo?.phone || 'N/A'}`, 60, customerTop + 40, { width: 225 });

    if (order.customer?.personalInfo?.email) {
      doc.text(`Email: ${order.customer.personalInfo.email}`, 60, customerTop + 52, { width: 225 });
    }

    // Delivery address section
    doc.fillColor('#333333')
       .fontSize(11)
       .font('Helvetica-Bold')
       .text('DELIVERY ADDRESS', 305, customerTop);
    
    // Address box
    doc.rect(305, customerTop + 15, 240, 70)
       .fillColor('#F8F9FA')
       .fill()
       .strokeColor('#E0E0E0')
       .stroke();
    
    if (order.deliveryAddress) {
      const addr = order.deliveryAddress;
      doc.fillColor('#666666')
         .fontSize(9)
         .font('Helvetica')
         .text(addr.addressLine1 || '', 315, customerTop + 25, { width: 220 })
         .text(addr.addressLine2 || '', 315, customerTop + 37, { width: 220 })
         .text(`${addr.city || ''}, ${addr.state || ''} - ${addr.pincode || ''}`, 315, customerTop + 49);
      
      if (addr.landmark) {
        doc.text(`Landmark: ${addr.landmark}`, 315, customerTop + 61);
      }
    } else {
      doc.fillColor('#999999')
         .fontSize(9)
         .font('Helvetica-Oblique')
         .text('Address not provided', 315, customerTop + 35);
    }

    // Order items table
    const tableTop = customerTop + 120;
    
    // Table header
    doc.rect(50, tableTop, 495, 20)
       .fillColor('#2E8B57')
       .fill();
    
    doc.fillColor('white')
       .fontSize(10)
       .font('Helvetica-Bold')
       .text('PRODUCT', 60, tableTop + 6)
       .text('QUANTITY', 300, tableTop + 6, { width: 60, align: 'center' })
       .text('UNIT PRICE', 370, tableTop + 6, { width: 70, align: 'right' })
       .text('TOTAL', 450, tableTop + 6, { width: 80, align: 'right' });

    // Table rows
    let currentY = tableTop + 25;
    order.items.forEach((item, index) => {
      // Alternate row colors
      if (index % 2 === 0) {
        doc.rect(50, currentY - 5, 495, 20)
           .fillColor('#F8F9FA')
           .fill();
      }

      const productName = item.product?.name || 'Product';
      const quantity = `${item.quantity} ${item.unit || 'unit'}`;
      const unitPrice = `₹${item.price.toFixed(2)}`;
      const total = `₹${(item.quantity * item.price).toFixed(2)}`;

      doc.fillColor('#333333')
         .fontSize(9)
         .font('Helvetica')
         .text(productName, 60, currentY, { width: 220 })
         .text(quantity, 300, currentY, { width: 60, align: 'center' })
         .text(unitPrice, 370, currentY, { width: 70, align: 'right' })
         .text(total, 450, currentY, { width: 80, align: 'right' });

      currentY += 20;
    });

    // Table bottom border
    doc.rect(50, currentY - 5, 495, 1)
       .fillColor('#E0E0E0')
       .fill();

    // Totals section
    const totalsTop = currentY + 20;
    const subtotal = order.totalAmount;
    const discount = order.discount || 0;
    const finalTotal = order.finalAmount;

    // Totals box
    doc.rect(345, totalsTop, 200, discount > 0 ? 60 : 45)
       .fillColor('#F8F9FA')
       .fill()
       .strokeColor('#E0E0E0')
       .stroke();

    doc.fillColor('#666666')
       .fontSize(10)
       .font('Helvetica')
       .text('Subtotal:', 355, totalsTop + 12)
       .text(`₹${subtotal.toFixed(2)}`, 495, totalsTop + 12, { align: 'right', width: 90 });

    if (discount > 0) {
      doc.text('Discount:', 355, totalsTop + 27)
         .text(`-₹${discount.toFixed(2)}`, 495, totalsTop + 27, { align: 'right', width: 90 });

      // Separator line
      doc.moveTo(355, totalsTop + 40)
         .lineTo(525, totalsTop + 40)
         .strokeColor('#CCCCCC')
         .stroke();

      doc.fillColor('#333333')
         .fontSize(12)
         .font('Helvetica-Bold')
         .text('Total Amount:', 355, totalsTop + 47)
         .text(`₹${finalTotal.toFixed(2)}`, 495, totalsTop + 47, { align: 'right', width: 90 });
    } else {
      // Separator line
      doc.moveTo(355, totalsTop + 25)
         .lineTo(525, totalsTop + 25)
         .strokeColor('#CCCCCC')
         .stroke();

      doc.fillColor('#333333')
         .fontSize(12)
         .font('Helvetica-Bold')
         .text('Total Amount:', 355, totalsTop + 32)
         .text(`₹${finalTotal.toFixed(2)}`, 495, totalsTop + 32, { align: 'right', width: 90 });
    }

    // Additional information section
    const notesTop = totalsTop + (discount > 0 ? 80 : 65);
    
    if (order.specialInstructions) {
      doc.fillColor('#333333')
         .fontSize(11)
         .font('Helvetica-Bold')
         .text('SPECIAL INSTRUCTIONS', 50, notesTop);
      
      doc.rect(50, notesTop + 15, 495, 40)
         .fillColor('#FFFBF0')
         .fill()
         .strokeColor('#FFEBB2')
         .stroke();
      
      doc.fillColor('#666666')
         .fontSize(9)
         .font('Helvetica')
         .text(order.specialInstructions, 60, notesTop + 25, { width: 475 });
    }

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
       .text('For any queries regarding this invoice, please contact our support team.', 0, footerTop + 30, { align: 'center' })
       .text('Email: support@dairy9.com | Phone: +1 (555) 123-4567', 0, footerTop + 43, { align: 'center' })
       .text(`Invoice generated on ${new Date().toLocaleDateString('en-IN')} at ${new Date().toLocaleTimeString('en-IN', {
         hour: '2-digit',
         minute: '2-digit'
       })}`, 0, footerTop + 56, { align: 'center' })
       .text('Fresh Dairy Products Delivered Daily', 0, footerTop + 69, { align: 'center' });

    // Terms and conditions (if space permits)
    if (doc.y < footerTop - 50) {
      doc.moveDown(2);
      doc.fillColor('#333333')
         .fontSize(9)
         .font('Helvetica-Bold')
         .text('Terms & Conditions:', 50, doc.y);
      
      doc.fillColor('#666666')
         .fontSize(8)
         .font('Helvetica')
         .text('• Prices are inclusive of all applicable taxes', 50, doc.y + 12, { width: 495 })
         .text('• Goods once sold will not be taken back or exchanged', 50, doc.y + 24, { width: 495 })
         .text('• Payment due upon receipt of invoice', 50, doc.y + 36, { width: 495 });
    }

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