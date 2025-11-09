// models/retailerInventory.model.js
import mongoose from 'mongoose';

const retailerInventorySchema = new mongoose.Schema({
  retailer: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Admin',
    required: true,
    index: true
  },
  product: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product',
    required: true,
    index: true
  },
  
  // Stock Information
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
  
  // Pricing
  costPrice: {
    type: Number,
    min: 0
  },
  sellingPrice: {
    type: Number,
    required: true,
    min: 0
  },
  margin: {
    type: Number,
    min: 0
  },
  
  // Stock Management
  minStockLevel: {
    type: Number,
    default: 10
  },
  maxStockLevel: {
    type: Number,
    default: 200
  },
  reorderQuantity: {
    type: Number,
    default: 50
  },
  
  // Status Flags
  isActive: {
    type: Boolean,
    default: true,
    index: true
  },
  lowStockAlert: {
    type: Boolean,
    default: false,
    index: true
  },
  outOfStock: {
    type: Boolean,
    default: false,
    index: true
  },
  
  // Performance Metrics
  totalSold: {
    type: Number,
    default: 0
  },
  totalRevenue: {
    type: Number,
    default: 0
  },
  lastRestocked: Date,
  
  // Batch Tracking
  batches: [{
    batchNumber: String,
    quantity: Number,
    expiryDate: Date,
    manufacturingDate: Date,
    costPrice: Number,
    _id: false
  }]
}, {
  timestamps: true
});

// Virtual for available stock
retailerInventorySchema.virtual('availableStock').get(function() {
  return this.currentStock - this.committedStock;
});

// Update flags before saving
retailerInventorySchema.pre('save', function(next) {
  this.lowStockAlert = this.currentStock <= this.minStockLevel;
  this.outOfStock = this.currentStock === 0;
  
  // Calculate margin if cost price exists
  if (this.costPrice && this.sellingPrice) {
    this.margin = ((this.sellingPrice - this.costPrice) / this.costPrice) * 100;
  }
  
  next();
});

// Compound indexes for performance
retailerInventorySchema.index({ retailer: 1, product: 1 }, { unique: true });
retailerInventorySchema.index({ retailer: 1, lowStockAlert: 1 });
retailerInventorySchema.index({ retailer: 1, outOfStock: 1 });
retailerInventorySchema.index({ retailer: 1, isActive: 1 });
retailerInventorySchema.index({ updatedAt: -1 });

export default mongoose.model('RetailerInventory', retailerInventorySchema);