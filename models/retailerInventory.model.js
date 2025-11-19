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
    required: true // Keep required but we'll handle it properly
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

// Update the calculateFinalPrice method
retailerInventorySchema.methods.calculateFinalPrice = function(quantity) {
  // Always use sellingPrice as the base for calculations
  const basePrice = this.sellingPrice || 0;
  
  if (!this.enableQuantityPricing || !this.pricingSlabs || this.pricingSlabs.length === 0) {
    return basePrice * quantity;
  }

  // Find the applicable pricing slab
  const applicableSlab = this.pricingSlabs
    .filter(slab => slab.isActive)
    .sort((a, b) => a.minQuantity - b.minQuantity)
    .find(slab => quantity >= slab.minQuantity && quantity <= slab.maxQuantity);

  if (!applicableSlab) {
    return basePrice * quantity;
  }

  const totalPrice = basePrice * quantity;
  let discountAmount = 0;

  if (applicableSlab.discountType === 'FLAT') {
    discountAmount = applicableSlab.discountValue;
  } else if (applicableSlab.discountType === 'PERCENTAGE') {
    discountAmount = (totalPrice * applicableSlab.discountValue) / 100;
  }

  return Math.max(0, totalPrice - discountAmount);
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