// models/stockOrder.model.js
import mongoose from 'mongoose';

const StockOrderItemSchema = new mongoose.Schema({
  product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
  requestedQty: { type: Number, required: true, min: 1 },
  unitPrice: { type: Number, min: 0 },
  fulfilledQty: { type: Number, default: 0, min: 0 },
  reservedQty: { type: Number, default: 0, min: 0 },
  note: String
}, { _id: false });

const StockOrderSchema = new mongoose.Schema({
  orderNumber: { type: String, unique: true, required: true },
  // ✅ FIX: retailer references the Admin model (your retailers are stored as Admin docs)
  retailer: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin', required: true, index: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  items: { type: [StockOrderItemSchema], required: true },
  status: {
    type: String,
    enum: ['pending','reserved','locked','approved','partially_fulfilled','fulfilled','rejected','cancelled'],
    default: 'pending',
    index: true
  },
  isLocked: { type: Boolean, default: false },
  lockedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin' },
  lockExpiresAt: Date,
  notes: [{
    by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    role: String,
    text: String,
    at: { type: Date, default: Date.now }
  }],
  logs: [{ by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, action: String, note: String, at: { type: Date, default: Date.now } }],
  totalRequestedQty: { type: Number, default: 0 },
  totalFulfilledQty: { type: Number, default: 0 },
  priority: { type: String, enum: ['low','normal','high'], default: 'normal' },
  metadata: { type: mongoose.Schema.Types.Mixed }
}, { timestamps: true });

StockOrderSchema.pre('save', function(next){
  this.totalRequestedQty = (this.items || []).reduce((s,i)=> s + (i.requestedQty||0), 0);
  this.totalFulfilledQty = (this.items || []).reduce((s,i)=> s + (i.fulfilledQty||0), 0);
  next();
});

export default mongoose.model('StockOrder', StockOrderSchema);
