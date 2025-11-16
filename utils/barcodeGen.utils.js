import bwipjs from 'bwip-js';

/**
 * 🚀 Enhanced Barcode Generator
 * - Larger, highlighted product name with size (bold text)
 * - Zero Sharp dependencies (no dimension errors)
 */
export const generateBarcode = async (barcodeText, productName = '', unitSize = null, unit = null) => {
  return new Promise((resolve, reject) => {
    try {
      // 🧩 Format product name with size (prioritize unit visibility)
      let displayName = productName && productName.length > 0 ? productName : `ID: ${barcodeText}`;

      // Add size if provided, prioritizing unit visibility
      if (unitSize && unit) {
        const unitText = `${unitSize} ${unit}`;
        const maxTotalLength = 30;
        const unitLength = unitText.length;
        const spaceForProduct = maxTotalLength - unitLength - 1; // 1 for space between

        if (displayName.length > spaceForProduct) {
          // Truncate product name and add ".." to indicate overflow
          displayName = displayName.substring(0, spaceForProduct - 2) + '..';
        }

        displayName = `${displayName} ${unitText}`;
      }

      // Final truncation if still too long (fallback, though unlikely)
      if (displayName.length > 30) {
        displayName = displayName.substring(0, 27) + '...';
      }

      // 🧠 Generate barcode directly using bwip-js
      bwipjs.toBuffer(
        {
          bcid: 'code128',                // Barcode type
          text: barcodeText,              // Data to encode
          scale: 3,                       // Size multiplier
          height: 20,                     // Bar height
          includetext: true,              // Show text below barcode
          textfont: 'Helvetica-Bold',     // ✅ Bold font for highlight
          textsize: 24,                   // ✅ Increased size for better highlighting
          textxalign: 'center',           // Center align text
          textyoffset: 10,                // Proper distance from bars
          paddingwidth: 25,               // Horizontal padding
          paddingheight: 25,              // Vertical padding (increased for larger text)
          alttext: displayName,           // ✅ Product name with size or ID text
          backgroundcolor: 'FFFFFF',      // White background
          textcolor: '000000',            // Black text for strong contrast
        },
        (err, png) => {
          if (err) {
            console.error('❌ Barcode generation error:', err);
            reject(err);
          } else {
            console.log('✅ Barcode generated successfully (highlighted text with size)');
            resolve(png);
          }
        }
      );
    } catch (error) {
      console.error('❌ Barcode generation failed:', error);
      reject(error);
    }
  });
};

/**
 * 🔁 Compatibility alias — no Sharp compositing (always safe)
 */
export const addTextToBarcode = async (barcodeBuffer, barcodeId, productName) => {
  return barcodeBuffer;
};
