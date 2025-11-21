// models/retailerInventory.model.js - Updated schema
import mongoose from 'mongoose';

// Define pricing slab schema
const pricingSlabSchema = new mongoose.Schema({
  minQuantity: {
    type: Number,
    required: true,
    min: 0
  },
  maxQuantity: {
    type: Number,
    required: true,
    min: 1
  },
  discountType: {
    type: String,
    enum: ['FLAT', 'PERCENTAGE'],
    required: true
  },
  discountValue: {
    type: Number,
    required: true,
    min: 0
  },
  isActive: {
    type: Boolean,
    default: true
  }
}, { _id: false });

const retailerInventorySchema = new mongoose.Schema({
  retailer: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Admin',
    required: true
  },
  product: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product',
    required: true
  },
  productName: {
    type: String,
    required: true
  },
  currentStock: {
    type: Number,
    default: 0,
    min: 0
  },
  committedStock: {
    type: Number,
    default: 0,
    min: 0
  },
  // Base price from superadmin (read-only reference)
  basePrice: {
    type: Number,
    min: 0
  },
  // Retailer's selling price (overrides base price)
  sellingPrice: {
    type: Number,
    min: 0,
    required: true
  },
  costPrice: {
    type: Number,
    min: 0
  },
  // Quantity-based pricing slabs (applied on sellingPrice)
  pricingSlabs: [pricingSlabSchema],
  enableQuantityPricing: {
    type: Boolean,
    default: false
  },
  minStockLevel: {
    type: Number,
    default: 10
  },
  maxStockLevel: {
    type: Number,
    default: 100
  },
  // ... rest of the fields
   reorderQuantity: {
    type: Number,
    default: 50
  },
  totalSold: {
    type: Number,
    default: 0
  },
  lastSoldDate: {
    type: Date
  },
  lastRestocked: {
    type: Date
  },
  lastUpdated: {
    type: Date,
    default: Date.now
  },
  updatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: false // Keep required but we'll handle it properly
  },
  stockUpdateReason: {
    type: String,
    default: 'Initial stock'
  },
  isActive: {
    type: Boolean,
    default: true
  },
  lowStockAlert: {
    type: Boolean,
    default: false
  }
}, {
  timestamps: true
});

retailerInventorySchema.methods.calculateFinalPrice = function(quantity) {
  const basePrice = this.sellingPrice || 0;
  
  if (!this.enableQuantityPricing || !this.pricingSlabs || this.pricingSlabs.length === 0) {
    return {
      finalPrice: basePrice * quantity,
      finalUnitPrice: basePrice,
      appliedDiscount: 0,
      discountType: null,
      baseTotal: basePrice * quantity
    };
  }

  // Get active slabs sorted
  const activeSlabs = this.pricingSlabs
    .filter(slab => slab.isActive)
    .sort((a, b) => a.minQuantity - b.minQuantity);

  if (activeSlabs.length === 0) {
    return {
      finalPrice: basePrice * quantity,
      finalUnitPrice: basePrice,
      appliedDiscount: 0,
      discountType: null,
      baseTotal: basePrice * quantity
    };
  }

  // ✅ NEW LOGIC: Find applicable slab or use last slab
  let applicableSlab = activeSlabs.find(slab => 
    quantity >= slab.minQuantity && quantity <= slab.maxQuantity
  );

  if (!applicableSlab) {
    applicableSlab = activeSlabs[activeSlabs.length - 1];
    
    // Only apply if quantity meets the last slab's minimum
    if (quantity < applicableSlab.minQuantity) {
      return {
        finalPrice: basePrice * quantity,
        finalUnitPrice: basePrice,
        appliedDiscount: 0,
        discountType: null,
        baseTotal: basePrice * quantity
      };
    }
  }

  // Calculate per-piece discount
  let discountedPricePerPiece = basePrice;
  let discountAmountPerPiece = 0;

  if (applicableSlab.discountType === 'FLAT') {
    discountAmountPerPiece = applicableSlab.discountValue;
    discountedPricePerPiece = Math.max(0, basePrice - discountAmountPerPiece);
  } else if (applicableSlab.discountType === 'PERCENTAGE') {
    discountAmountPerPiece = (basePrice * applicableSlab.discountValue) / 100;
    discountedPricePerPiece = Math.max(0, basePrice - discountAmountPerPiece);
  }

  const finalPrice = discountedPricePerPiece * quantity;
  const totalDiscount = discountAmountPerPiece * quantity;
  const baseTotal = basePrice * quantity;

  return {
    finalPrice: Math.round(finalPrice * 100) / 100,
    finalUnitPrice: Math.round(discountedPricePerPiece * 100) / 100,
    appliedDiscount: Math.round(totalDiscount * 100) / 100,
    discountType: applicableSlab.discountType,
    baseTotal: Math.round(baseTotal * 100) / 100,
    discountDetails: {
      slab: applicableSlab,
      discountedPricePerPiece: Math.round(discountedPricePerPiece * 100) / 100,
      discountAmountPerPiece: Math.round(discountAmountPerPiece * 100) / 100,
      isExtendedRange: !activeSlabs.find(slab => 
        quantity >= slab.minQuantity && quantity <= slab.maxQuantity
      ) // ✅ NEW: Flag for extended range
    }
  };
};

retailerInventorySchema.methods.calculatePricePerPiece = function(quantity) {
  const basePrice = this.sellingPrice || 0;
  
  if (!this.enableQuantityPricing || !this.pricingSlabs || this.pricingSlabs.length === 0) {
    return {
      quantity,
      basePrice,
      finalUnitPrice: basePrice,
      finalPrice: basePrice * quantity,
      discountPerPiece: 0,
      totalDiscount: 0,
      hasDiscount: false
    };
  }

  // Get all active slabs sorted by minQuantity
  const activeSlabs = this.pricingSlabs
    .filter(slab => slab.isActive)
    .sort((a, b) => a.minQuantity - b.minQuantity);

  if (activeSlabs.length === 0) {
    return {
      quantity,
      basePrice,
      finalUnitPrice: basePrice,
      finalPrice: basePrice * quantity,
      discountPerPiece: 0,
      totalDiscount: 0,
      hasDiscount: false
    };
  }

  // Find applicable slab - NEW LOGIC: Use last slab if quantity exceeds all ranges
  let applicableSlab = activeSlabs.find(slab => 
    quantity >= slab.minQuantity && quantity <= slab.maxQuantity
  );

  // ✅ NEW: If no slab found, use the last slab (highest quantity range)
  if (!applicableSlab) {
    applicableSlab = activeSlabs[activeSlabs.length - 1];
    
    // ✅ Additional check: Only apply if quantity is greater than the last slab's min quantity
    if (quantity < applicableSlab.minQuantity) {
      return {
        quantity,
        basePrice,
        finalUnitPrice: basePrice,
        finalPrice: basePrice * quantity,
        discountPerPiece: 0,
        totalDiscount: 0,
        hasDiscount: false
      };
    }
  }

  // Calculate per-piece discount
  let discountPerPiece = 0;
  let finalUnitPrice = basePrice;

  if (applicableSlab.discountType === 'FLAT') {
    discountPerPiece = applicableSlab.discountValue;
    finalUnitPrice = Math.max(0, basePrice - discountPerPiece);
  } else if (applicableSlab.discountType === 'PERCENTAGE') {
    discountPerPiece = (basePrice * applicableSlab.discountValue) / 100;
    finalUnitPrice = Math.max(0, basePrice - discountPerPiece);
  }

  const finalPrice = finalUnitPrice * quantity;
  const totalDiscount = discountPerPiece * quantity;

  return {
    quantity,
    basePrice,
    finalUnitPrice: Math.round(finalUnitPrice * 100) / 100,
    finalPrice: Math.round(finalPrice * 100) / 100,
    discountPerPiece: Math.round(discountPerPiece * 100) / 100,
    totalDiscount: Math.round(totalDiscount * 100) / 100,
    hasDiscount: true,
    applicableSlab: {
      minQuantity: applicableSlab.minQuantity,
      maxQuantity: applicableSlab.maxQuantity,
      discountType: applicableSlab.discountType,
      discountValue: applicableSlab.discountValue,
      isExtendedRange: !activeSlabs.find(slab => 
        quantity >= slab.minQuantity && quantity <= slab.maxQuantity
      ) // ✅ NEW: Flag to indicate extended range usage
    },
    savings: Math.round((basePrice * quantity - finalPrice) * 100) / 100,
    savingsPercentage: basePrice > 0 ? Math.round(((basePrice - finalUnitPrice) / basePrice) * 100 * 100) / 100 : 0
  };
};


// Compound index
retailerInventorySchema.index({ retailer: 1, product: 1 }, { unique: true });

// Indexes for performance
retailerInventorySchema.index({ retailer: 1, currentStock: 1 });
retailerInventorySchema.index({ retailer: 1, committedStock: 1 });
retailerInventorySchema.index({ lowStockAlert: 1 });

// Virtual for available stock
retailerInventorySchema.virtual('availableStock').get(function() {
  return Math.max(0, this.currentStock - this.committedStock);
});

// Check if stock is low
retailerInventorySchema.methods.checkLowStock = function() {
  this.lowStockAlert = this.currentStock <= this.minStockLevel;
  return this.lowStockAlert;
};

// Pre-save middleware to update low stock alert
retailerInventorySchema.pre('save', function(next) {
  this.checkLowStock();
  
  // Auto-populate productName from product reference if not set
  if (!this.productName && this.product && this.product.name) {
    this.productName = this.product.name;
  }
  
  next();
});

const RetailerInventory = mongoose.model('RetailerInventory', retailerInventorySchema);

export default RetailerInventory;    //TEJAS