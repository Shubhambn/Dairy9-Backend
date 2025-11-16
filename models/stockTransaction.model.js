// models/stockTransaction.model.js
import mongoose from 'mongoose';

const StockTransactionSchema = new mongoose.Schema({
  product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
  from: { type: String },
  fromRef: mongoose.Schema.Types.ObjectId,
  to: { type: String },
  toRef: mongoose.Schema.Types.ObjectId,
  qty: { type: Number, required: true },
  type: { type: String, enum: ['transfer','reserve','release','sale','return','adjustment'], required: true },
  orderRef: { type: mongoose.Schema.Types.ObjectId, refPath: 'orderRefModel' },
  orderRefModel: { type: String },
  traceId: { type: String, index: true }, // idempotency trace
  note: String,
  status: { type: String, enum: ['completed','failed','rolled_back'], default: 'completed' },
  createdAt: { type: Date, default: Date.now }
});

// unique index on traceId + orderRef to prevent duplicate processing of same request
StockTransactionSchema.index({ orderRef: 1, traceId: 1 }, { unique: true, sparse: true });

export default mongoose.model('StockTransaction', StockTransactionSchema);
