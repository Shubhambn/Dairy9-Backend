// J:\dairy9 backend\Dairy9-Backend\models\retailerInventory.model.js
import mongoose from 'mongoose';

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
//   reservedStock: {
//     type: Number,
//     default: 0,
//     min: 0
//   },
  sellingPrice: {
    type: Number,
    min: 0
  },
  costPrice: {
    type: Number,
    min: 0
  },
  minStockLevel: {
    type: Number,
    default: 10
  },
  maxStockLevel: {
    type: Number,
    default: 100
  },
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

export default RetailerInventory;