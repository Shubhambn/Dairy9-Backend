// C:\Users\Krishna\OneDrive\Desktop\backend-dairy9\Dairy9-Backend\models\product.model.js

import mongoose from 'mongoose';

const productSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Product name is required'],
    trim: true,
    maxlength: [100, 'Product name cannot exceed 100 characters']
  },
  description: {
    type: String,
    required: true,
    trim: true,
    maxlength: [500, 'Description cannot exceed 500 characters']
  },
  price: {
    type: Number,
    required: [true, 'Product price is required'],
    min: [0, 'Price cannot be negative']
  },
  category: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Category',
    required: [true, 'Product category is required']
  },
  image: {
    type: String,
    default: '/images/default-product.jpg'
  },
  imagePublicId: {
    type: String,
    default: null
  },
  images: [{
    url: {
      type: String,
      required: true
    },
    publicId: {
      type: String,
      required: true
    },
    uploadedAt: {
      type: Date,
      default: Date.now
    }
  }],
  unit: {
    type: String,
    enum: ['ml', 'liter', 'gm', 'kg', 'pack', 'piece'],
    required: true
  },
  unitSize: {
    type: Number,
    required: true,
    min: [0, 'Unit size cannot be negative']
  },
  isAvailable: {
    type: Boolean,
    default: true
  },
  milkType: {
    type: String,
    enum: ['Cow', 'Buffalo', 'Mixed', 'None'],
    default: 'Cow'
  },
  nutritionalInfo: {
    fat: {
      type: String,
      default: '0'
    },
    protein: {
      type: String,
      default: '0'
    },
    calories: {
      type: String,
      default: '0'
    },
    carbohydrates: {
      type: String,
      default: '0'
    }
  },
  tags: [{
    type: String,
    trim: true
  }],
  discount: {
    type: Number,
    default: 0,
    min: 0,
    max: 100
  },
  isFeatured: {
    type: Boolean,
    default: false
  },
  rating: {
    average: { 
      type: Number, 
      default: 0,
      min: 0,
      max: 5
    },
    count: { 
      type: Number, 
      default: 0,
      min: 0
    }
  },
  
  // =============================================
  // QR CODE FIELDS (FROM FIRST VERSION)
  // =============================================
  qrCodeUrl: { 
    type: String 
  },    // URL or path to the generated QR image
  qrCodeId: { 
    type: String 
  },    // Cloudinary public ID for QR code
  
  // =============================================
  // ENHANCED BARCODE FIELDS (FROM SECOND VERSION)
  // =============================================
  barcodeUrl: {
    type: String,
    sparse: true
  },    // URL to the generated barcode image (system-generated)
  barcodeId: {
    type: String,
    sparse: true,
    trim: true
  },    // Unique barcode string for generated barcodes (usually product ID)
  
  scannedBarcodeId: {
    type: String,
    sparse: true,
    trim: true,
    index: true
  },    // Physical barcode scanned by user (takes priority)
  
  barcodeData: {
    type: String,
    sparse: true
  },    // Additional barcode data if needed
  
  // =============================================
  // RETAILER FIELD (FROM FIRST VERSION)
  // =============================================
  retailerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Retailer",
  }

}, { 
  timestamps: true 
});

// =============================================
// VIRTUAL FIELDS FOR ENHANCED FUNCTIONALITY
// =============================================

// Calculate discounted price
productSchema.virtual('discountedPrice').get(function() {
  if (this.discount > 0) {
    return this.price * (1 - this.discount / 100);
  }
  return this.price;
});

// Calculate discount amount
productSchema.virtual('discountAmount').get(function() {
  return this.price * (this.discount / 100);
});

// Check if product is on sale
productSchema.virtual('isOnSale').get(function() {
  return this.discount > 0;
});

// =============================================
// ENHANCED BARCODE VIRTUAL FIELDS
// =============================================

// Check if product has any barcode
productSchema.virtual('hasBarcode').get(function() {
  return !!(this.scannedBarcodeId || this.barcodeId);
});

// Get active barcode (scanned takes priority over generated)
productSchema.virtual('activeBarcodeId').get(function() {
  return this.scannedBarcodeId || this.barcodeId;
});

// Check if product has scanned barcode
productSchema.virtual('hasScannedBarcode').get(function() {
  return !!this.scannedBarcodeId;
});

// Check if product has generated barcode
productSchema.virtual('hasGeneratedBarcode').get(function() {
  return !!(this.barcodeId && this.barcodeUrl);
});

// Check if product has QR code
productSchema.virtual('hasQRCode').get(function() {
  return !!(this.qrCodeUrl && this.qrCodeId);
});

// Get barcode type
productSchema.virtual('barcodeType').get(function() {
  if (this.scannedBarcodeId) return 'scanned';
  if (this.barcodeId) return 'generated';
  return 'none';
});

// Get barcode display info
productSchema.virtual('barcodeInfo').get(function() {
  return {
    hasBarcode: this.hasBarcode,
    hasScannedBarcode: this.hasScannedBarcode,
    hasGeneratedBarcode: this.hasGeneratedBarcode,
    hasQRCode: this.hasQRCode,
    activeBarcodeId: this.activeBarcodeId,
    barcodeType: this.barcodeType,
    generated: this.barcodeId ? {
      id: this.barcodeId,
      url: this.barcodeUrl,
      exists: true
    } : { exists: false },
    scanned: this.scannedBarcodeId ? {
      id: this.scannedBarcodeId,
      exists: true
    } : { exists: false },
    qrCode: this.qrCodeUrl ? {
      url: this.qrCodeUrl,
      exists: true
    } : { exists: false }
  };
});

// Check if product is out of stock
productSchema.virtual('isOutOfStock').get(function() {
  return this.stock <= 0;
});

// Get stock status
productSchema.virtual('stockStatus').get(function() {
  if (this.stock <= 0) return 'out-of-stock';
  if (this.stock < 10) return 'low-stock';
  return 'in-stock';
});

// =============================================
// INDEXES FOR OPTIMIZED QUERIES
// =============================================

// Single field indexes
productSchema.index({ category: 1 });
productSchema.index({ isAvailable: 1 });
productSchema.index({ isFeatured: 1 });
productSchema.index({ milkType: 1 });
productSchema.index({ price: 1 });
productSchema.index({ stock: 1 });
productSchema.index({ createdAt: -1 });

// Barcode indexes
productSchema.index({ barcodeId: 1 }, { sparse: true });
productSchema.index({ scannedBarcodeId: 1 }, { sparse: true });

// QR Code indexes
productSchema.index({ qrCodeId: 1 }, { sparse: true });

// Compound indexes for common queries
productSchema.index({ isAvailable: 1, category: 1 });
productSchema.index({ isAvailable: 1, isFeatured: 1 });
productSchema.index({ isAvailable: 1, milkType: 1 });
productSchema.index({ isAvailable: 1, price: 1 });
productSchema.index({ category: 1, isAvailable: 1, price: 1 });

// Text search index
productSchema.index({ 
  name: 'text', 
  description: 'text', 
  tags: 'text' 
});

// Unique compound index for barcode search
productSchema.index({ 
  scannedBarcodeId: 1, 
  barcodeId: 1 
}, { 
  sparse: true 
});

// =============================================
// PRE-SAVE MIDDLEWARE
// =============================================

// Validate barcode uniqueness before saving
productSchema.pre('save', async function(next) {
  if (this.isModified('scannedBarcodeId') && this.scannedBarcodeId) {
    // Check if scanned barcode is already assigned to another product
    const existingWithScannedBarcode = await mongoose.model('Product').findOne({
      scannedBarcodeId: this.scannedBarcodeId,
      _id: { $ne: this._id }
    });
    
    if (existingWithScannedBarcode) {
      return next(new Error(`Scanned barcode "${this.scannedBarcodeId}" is already assigned to product: ${existingWithScannedBarcode.name}`));
    }
    
    // Check if scanned barcode conflicts with any generated barcode
    const existingWithGeneratedBarcode = await mongoose.model('Product').findOne({
      barcodeId: this.scannedBarcodeId,
      _id: { $ne: this._id }
    });
    
    if (existingWithGeneratedBarcode) {
      return next(new Error(`Scanned barcode "${this.scannedBarcodeId}" conflicts with generated barcode of product: ${existingWithGeneratedBarcode.name}`));
    }
  }
  
  if (this.isModified('barcodeId') && this.barcodeId) {
    // Check if generated barcode is already assigned to another product
    const existingWithGeneratedBarcode = await mongoose.model('Product').findOne({
      barcodeId: this.barcodeId,
      _id: { $ne: this._id }
    });
    
    if (existingWithGeneratedBarcode) {
      return next(new Error(`Generated barcode "${this.barcodeId}" is already assigned to product: ${existingWithGeneratedBarcode.name}`));
    }
    
    // Check if generated barcode conflicts with any scanned barcode
    const existingWithScannedBarcode = await mongoose.model('Product').findOne({
      scannedBarcodeId: this.barcodeId,
      _id: { $ne: this._id }
    });
    
    if (existingWithScannedBarcode) {
      return next(new Error(`Generated barcode "${this.barcodeId}" conflicts with scanned barcode of product: ${existingWithScannedBarcode.name}`));
    }
  }
  
  next();
});

// Format nutritional info before saving
productSchema.pre('save', function(next) {
  if (this.nutritionalInfo) {
    const nutrition = this.nutritionalInfo;
    ['fat', 'protein', 'calories', 'carbohydrates'].forEach(key => {
      if (nutrition[key] && typeof nutrition[key] === 'string') {
        // Remove any non-numeric characters except decimal point
        nutrition[key] = nutrition[key].replace(/[^\d.]/g, '');
      }
    });
  }
  next();
});

// =============================================
// STATIC METHODS
// =============================================

// Find product by any barcode (scanned takes priority)
productSchema.statics.findByBarcode = function(barcodeId) {
  return this.findOne({
    $and: [
      { isAvailable: true },
      {
        $or: [
          { scannedBarcodeId: barcodeId },
          { barcodeId: barcodeId }
        ]
      }
    ]
  }).populate('category', 'name');
};

// Find products with barcode status
productSchema.statics.findByBarcodeStatus = function(status) {
  let filter = { isAvailable: true };
  
  switch (status) {
    case 'with-barcode':
      filter.$or = [
        { scannedBarcodeId: { $exists: true, $ne: null } },
        { barcodeId: { $exists: true, $ne: null } }
      ];
      break;
    case 'scanned-only':
      filter.scannedBarcodeId = { $exists: true, $ne: null };
      break;
    case 'generated-only':
      filter.barcodeId = { $exists: true, $ne: null };
      break;
    case 'without-barcode':
      filter.scannedBarcodeId = null;
      filter.barcodeId = null;
      break;
    default:
      break;
  }
  
  return this.find(filter).populate('category', 'name');
};

// Find products with QR codes
productSchema.statics.findWithQRCode = function() {
  return this.find({
    isAvailable: true,
    qrCodeUrl: { $exists: true, $ne: null },
    qrCodeId: { $exists: true, $ne: null }
  }).populate('category', 'name');
};

// Get barcode statistics
productSchema.statics.getBarcodeStats = function() {
  return Promise.all([
    this.countDocuments({ isAvailable: true }),
    this.countDocuments({ 
      isAvailable: true, 
      scannedBarcodeId: { $exists: true, $ne: null } 
    }),
    this.countDocuments({ 
      isAvailable: true, 
      barcodeId: { $exists: true, $ne: null } 
    }),
    this.countDocuments({
      isAvailable: true,
      $or: [
        { scannedBarcodeId: { $exists: true, $ne: null } },
        { barcodeId: { $exists: true, $ne: null } }
      ]
    }),
    this.countDocuments({
      isAvailable: true,
      qrCodeUrl: { $exists: true, $ne: null },
      qrCodeId: { $exists: true, $ne: null }
    })
  ]).then(([total, scanned, generated, withBarcode, withQR]) => ({
    totalProducts: total,
    withScannedBarcode: scanned,
    withGeneratedBarcode: generated,
    withAnyBarcode: withBarcode,
    withQRCode: withQR,
    withoutBarcode: total - withBarcode
  }));
};

// =============================================
// INSTANCE METHODS
// =============================================

// Check if barcode can be assigned
productSchema.methods.canAssignScannedBarcode = async function(barcodeId) {
  if (!barcodeId) return false;
  
  const conflicts = await mongoose.model('Product').findOne({
    $or: [
      { scannedBarcodeId: barcodeId, _id: { $ne: this._id } },
      { barcodeId: barcodeId, _id: { $ne: this._id } }
    ]
  });
  
  return !conflicts;
};

// Get barcode assignment info
productSchema.methods.getBarcodeAssignmentInfo = async function(barcodeId) {
  const conflicts = await mongoose.model('Product').findOne({
    $or: [
      { scannedBarcodeId: barcodeId, _id: { $ne: this._id } },
      { barcodeId: barcodeId, _id: { $ne: this._id } }
    ]
  });
  
  return {
    canAssign: !conflicts,
    conflict: conflicts ? {
      productId: conflicts._id,
      productName: conflicts.name,
      barcodeType: conflicts.scannedBarcodeId === barcodeId ? 'scanned' : 'generated'
    } : null
  };
};

// Clear all barcode data
productSchema.methods.clearBarcodes = function() {
  this.scannedBarcodeId = null;
  this.barcodeId = null;
  this.barcodeUrl = null;
  this.barcodeData = null;
  return this.save();
};

// Clear QR code data
productSchema.methods.clearQRCode = function() {
  this.qrCodeUrl = null;
  this.qrCodeId = null;
  return this.save();
};

// Clear all identification data (barcodes + QR)
productSchema.methods.clearAllIdentifiers = function() {
  this.scannedBarcodeId = null;
  this.barcodeId = null;
  this.barcodeUrl = null;
  this.barcodeData = null;
  this.qrCodeUrl = null;
  this.qrCodeId = null;
  return this.save();
};

// Set scanned barcode with validation
productSchema.methods.setScannedBarcode = async function(barcodeId) {
  const assignmentInfo = await this.getBarcodeAssignmentInfo(barcodeId);
  
  if (!assignmentInfo.canAssign) {
    throw new Error(`Cannot assign barcode "${barcodeId}". ${assignmentInfo.conflict ? `Already assigned to ${assignmentInfo.conflict.productName}` : 'Invalid barcode'}`);
  }
  
  this.scannedBarcodeId = barcodeId;
  return this.save();
};

// Check if product has any identification (barcode or QR)
productSchema.methods.hasIdentification = function() {
  return this.hasBarcode || this.hasQRCode;
};

// Get identification summary
productSchema.methods.getIdentificationSummary = function() {
  return {
    hasBarcode: this.hasBarcode,
    hasQRCode: this.hasQRCode,
    hasAnyIdentification: this.hasIdentification(),
    barcodeType: this.barcodeType,
    activeBarcodeId: this.activeBarcodeId,
    qrCodeUrl: this.qrCodeUrl
  };
};

// =============================================
// QUERY HELPERS
// =============================================

// Query helper for available products
productSchema.query.available = function() {
  return this.where({ isAvailable: true });
};

// Query helper for featured products
productSchema.query.featured = function() {
  return this.where({ isFeatured: true, isAvailable: true });
};

// Query helper for products in stock
productSchema.query.inStock = function() {
  return this.where({ stock: { $gt: 0 }, isAvailable: true });
};

// Query helper for products on sale
productSchema.query.onSale = function() {
  return this.where({ discount: { $gt: 0 }, isAvailable: true });
};

// Query helper for products by category
productSchema.query.byCategory = function(categoryId) {
  return this.where({ category: categoryId, isAvailable: true });
};

// Query helper for products by milk type
productSchema.query.byMilkType = function(milkType) {
  return this.where({ milkType: milkType, isAvailable: true });
};

// Query helper for products with QR codes
productSchema.query.withQRCode = function() {
  return this.where({ 
    qrCodeUrl: { $exists: true, $ne: null },
    qrCodeId: { $exists: true, $ne: null },
    isAvailable: true 
  });
};

// Query helper for products with barcodes
productSchema.query.withBarcode = function() {
  return this.where({
    $or: [
      { scannedBarcodeId: { $exists: true, $ne: null } },
      { barcodeId: { $exists: true, $ne: null } }
    ],
    isAvailable: true
  });
};

// =============================================
// SCHEMA OPTIONS
// =============================================

// Convert to JSON with virtuals
productSchema.set('toJSON', {
  virtuals: true,
  transform: function(doc, ret) {
    // Remove internal fields from JSON output
    delete ret.imagePublicId;
    delete ret.__v;
    return ret;
  }
});

// Convert to Object with virtuals
productSchema.set('toObject', {
  virtuals: true
});

const Product = mongoose.model('Product', productSchema);

export default Product;