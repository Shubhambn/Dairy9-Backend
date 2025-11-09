// C:\Users\Krishna\OneDrive\Desktop\backend-dairy9\Dairy9-Backend\models\product.model.js

import mongoose from 'mongoose';

const productSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  description: {
    type: String,
    required: true
  },
  price: {
    type: Number,
    required: true,
    min: 0
  },
  category: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Category',
    required: true
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
    url: String,
    publicId: String
  }],
  unit: {
    type: String,
    enum: ['ml', 'liter', 'gm', 'kg', 'pack', 'piece'],
    required: true
  },
  unitSize: {
    type: Number,
    required: true
  },
  stock: {
    type: Number,
    default: 0,
    min: 0
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
    fat: String,
    protein: String,
    calories: String,
    carbohydrates: String
  },
  tags: [String],
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
    average: { type: Number, default: 0 },
    count: { type: Number, default: 0 }
  }
  ,
  qrCodeUrl: { 
    type: String 
  },    // URL or path to the generated QR image
  qrCodeId: { 
    type: String 
  },
  retailerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Retailer",
  },    // optional unique ID if you manage QRs separately

}, { 
  timestamps: true 
});

// Calculate discounted price
productSchema.virtual('discountedPrice').get(function() {
  return this.price - (this.price * this.discount / 100);
});

// Convert to JSON with virtuals
productSchema.set('toJSON', {
  virtuals: true
});

const Product = mongoose.model('Product', productSchema);
export default Product;