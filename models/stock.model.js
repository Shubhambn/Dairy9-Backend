// models/stock.model.js
import mongoose from 'mongoose';

const StockSchema = new mongoose.Schema({
  product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true, index: true },
  locationType: { type: String, enum: ['superadmin','retailer'], required: true },
  locationRef: { type: mongoose.Schema.Types.ObjectId, required: true }, // retailer id for retailer stock
  quantity: { type: Number, default: 0 },
  reserved: { type: Number, default: 0 },
  updatedAt: { type: Date, default: Date.now }
});

// unique stock per product + location
StockSchema.index({ product: 1, locationType: 1, locationRef: 1 }, { unique: true });

export default mongoose.model('Stock', StockSchema);
