// models/inventoryLog.model.js
import mongoose from 'mongoose';

const inventoryLogSchema = new mongoose.Schema({
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
  inventoryItem: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'RetailerInventory',
    index: true
  },
  
  // Transaction Details
  transactionType: {
    type: String,
    enum: ['STOCK_IN', 'STOCK_OUT', 'STOCK_ADJUSTMENT', 'COMMITMENT', 'RELEASE_COMMITMENT'],
    required: true,
    index: true
  },
  
  // Quantity Information
  quantity: {
    type: Number,
    required: true
  },
  previousStock: {
    type: Number,
    required: true
  },
  newStock: {
    type: Number,
    required: true
  },
  unitCost: {
    type: Number,
    min: 0
  },
  totalValue: {
    type: Number,
    min: 0
  },
  
  // Reference Tracking
  referenceType: {
    type: String,
    enum: ['ORDER', 'PURCHASE_ORDER', 'ADJUSTMENT', 'RETURN']
  },
  referenceId: {
    type: mongoose.Schema.Types.ObjectId,
    index: true
  },
  
  // Batch Information
  batchNumber: String,
  expiryDate: Date,
  
  // Reason & Notes
  reason: {
    type: String,
    enum: ['SALE', 'PURCHASE', 'DAMAGED', 'EXPIRED', 'ADJUSTMENT', 'RETURN', 'INITIAL'],
    required: true
  },
  notes: String,
  
  // Audit Trail
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  ipAddress: String,
  userAgent: String
}, {
  timestamps: true
});

// Indexes for reporting
inventoryLogSchema.index({ retailer: 1, createdAt: -1 });
inventoryLogSchema.index({ product: 1, createdAt: -1 });
inventoryLogSchema.index({ transactionType: 1, createdAt: -1 });

export default mongoose.model('InventoryLog', inventoryLogSchema);