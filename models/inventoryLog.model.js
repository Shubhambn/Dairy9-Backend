// models/inventoryLog.model.js
import mongoose from 'mongoose';

const inventoryLogSchema = new mongoose.Schema({
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

  inventoryItem: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'RetailerInventory',
    required: true
  },

  transactionType: {
    type: String,
    required: true,
    enum: [
      'STOCK_IN',
      'STOCK_OUT',
      'STOCK_ADJUSTMENT',
      'STOCK_TRANSFER',
      'STOCK_TAKE',
      'COMMITMENT',
      'RELEASE_COMMITMENT',
      'DAMAGE',
      'EXPIRY',
      'RETURN'
    ]
  },

  quantity: {
    type: Number,
    required: true,
    min: 0
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
    default: 0
  },

  totalValue: {
    type: Number,
    default: 0
  },

  referenceType: {
    type: String,
    enum: [
      'ORDER',
      'PURCHASE_ORDER',
      'STOCK_ADJUSTMENT',
      'STOCK_TRANSFER',
      'MANUAL',
      'SYSTEM'
    ]
  },

  referenceId: {
    type: String
  },

  batchNumber: {
    type: String
  },

  expiryDate: {
    type: Date
  },

  reason: {
    type: String,
    required: true,
    enum: [
      // Stock In Reasons
      'PURCHASE',
      'RETURN',
      'TRANSFER_IN',
      'PRODUCTION',
      'ADJUSTMENT_IN',

      // Stock Out Reasons
      'SALE',
      'DAMAGE',
      'EXPIRY',
      'TRANSFER_OUT',
      'SAMPLE',
      'ADJUSTMENT_OUT',

      // Commitment Reasons
      'ORDER_RESERVATION',
      'ORDER_CANCELLED',
      'ORDER_DELIVERED',

      // General Reasons
      'INITIAL_SETUP',
      'CORRECTION',
      'PHYSICAL_COUNT',
      'SYSTEM_ADJUSTMENT',

      // Deletion
      'DELETION',

      // ✅ Added for base price & pricing slab updates
      'PRICE_UPDATE',
      'PRICING_UPDATE',
      'SETTINGS_UPDATE'
    ]
  },

  notes: {
    type: String
  },

  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },

  ipAddress: {
    type: String
  },

  userAgent: {
    type: String
  }

}, {
  timestamps: true
});

// Indexes
inventoryLogSchema.index({ retailer: 1, createdAt: -1 });
inventoryLogSchema.index({ product: 1, createdAt: -1 });
inventoryLogSchema.index({ referenceId: 1, referenceType: 1 });
inventoryLogSchema.index({ transactionType: 1 });
inventoryLogSchema.index({ reason: 1 });

// Virtual for transaction value
inventoryLogSchema.virtual('transactionValue').get(function () {
  return this.unitCost * this.quantity;
});

const InventoryLog = mongoose.model('InventoryLog', inventoryLogSchema);
export default InventoryLog;   //TEJAS