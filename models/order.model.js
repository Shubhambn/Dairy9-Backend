import mongoose from 'mongoose';

// Pricing slab schema for discount details
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

// Discount details schema for each order item
const discountDetailsSchema = new mongoose.Schema({
  basePrice: {
    type: Number,
    required: true,
    min: 0
  },
  currentPrice: {
    type: Number,
    required: true,
    min: 0
  },
  hasDiscount: {
    type: Boolean,
    default: false
  },
  discountPercentage: {
    type: Number,
    default: 0,
    min: 0,
    max: 100
  },
  savings: {
    type: Number,
    default: 0,
    min: 0
  },
  itemTotal: {
    type: Number,
    required: true,
    min: 0
  },
  baseTotal: {
    type: Number,
    required: true,
    min: 0
  },
  isExtendedRange: {
    type: Boolean,
    default: false
  },
  appliedSlab: pricingSlabSchema
}, { _id: false });

const orderItemSchema = new mongoose.Schema({
  product: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product',
    required: true
  },
  quantity: {
    type: Number,
    required: true,
    min: 1
  },
  price: {
    type: Number,
    required: true,
    min: 0
  },
  // 🔥 ENHANCED PRICE OVERRIDE TRACKING
  originalPrice: {
    type: Number,
    default: 0
  },
  isPriceOverridden: {
    type: Boolean,
    default: false
  },
  priceSource: {
    type: String,
    enum: ['catalog', 'retailer_inventory'],
    default: 'catalog'
  },
  unit: String,
  reservedQuantity: {
    type: Number,
    default: 0
  },
  isReserved: {
    type: Boolean,
    default: false
  },
  // 🔥 COMPLETE DISCOUNT TRACKING
  discountDetails: discountDetailsSchema,
  // 🔥 ADDED FOR OFFLINE ORDERS
  productName: {
    type: String,
    default: ''
  },
  barcodeId: String,
  scannedBarcodeId: String
});

// Discount summary schema for the entire order
const discountSummarySchema = new mongoose.Schema({
  totalDiscount: {
    type: Number,
    default: 0,
    min: 0
  },
  totalBaseAmount: {
    type: Number,
    default: 0,
    min: 0
  },
  finalAmount: {
    type: Number,
    default: 0,
    min: 0
  },
  savingsPercentage: {
    type: Number,
    default: 0,
    min: 0,
    max: 100
  },
  itemsWithDiscount: {
    type: Number,
    default: 0,
    min: 0
  },
  totalItems: {
    type: Number,
    default: 0,
    min: 0
  },
  extendedRangeItems: {
    type: Number,
    default: 0,
    min: 0
  }
}, { _id: false });

const orderSchema = new mongoose.Schema({
  orderId: {
    type: String,
    unique: true,
    required: true
  },
  customer: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Customer',
    required: function() {
      return this.orderType === 'online';
    }
  },
  items: [orderItemSchema],
  totalAmount: {
    type: Number,
    required: true,
    min: 0
  },
  // 🔥 ENHANCED PRICE OVERRIDE TRACKING
  originalPrice: {
    type: Number,
    default: 0
  },
  isPriceOverridden: {
    type: Boolean,
    default: false
  },
  priceSource: {
    type: String,
    enum: ['catalog', 'retailer_inventory'],
    default: 'catalog'
  },
  discount: {
    type: Number,
    default: 0
  },
  finalAmount: {
    type: Number,
    required: true,
    min: 0
  },
  // 🔥 COMPLETE DISCOUNT SUMMARY
  discountSummary: discountSummarySchema,
  deliveryAddress: {
    addressLine1: String,
    addressLine2: String,
    city: String,
    state: String,
    pincode: String,
    landmark: String,
    coordinates: {
      latitude: Number,
      longitude: Number
    },
    formattedAddress: String
  },
  assignedRetailer: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Admin',
    index: true
  },
  assignmentDetails: {
    assignedAt: {
      type: Date,
      default: Date.now
    },
    distance: Number,
    retailerName: String,
    retailerShop: String,
    serviceRadius: Number
  },
  deliveryTime: String,
  paymentStatus: {
    type: String,
    enum: ['pending', 'paid', 'failed', 'refunded'],
    default: 'pending'
  },
  paymentMethod: {
    type: String,
    enum: ['cash', 'card', 'upi', 'wallet'],
    default: 'cash'
  },
  reservationStatus: {
    type: String,
    enum: ['not_reserved', 'reserved', 'delivered', 'cancelled', 'released'],
    default: 'not_reserved'
  },
  reservationDate: Date,
  releaseDate: Date,
  cancellationReason: String,
  orderStatus: {
    type: String,
    enum: ['pending', 'confirmed', 'preparing', 'out_for_delivery', 'delivered', 'cancelled', 'completed'],
    default: 'pending'
  },
  deliveryDate: Date,
  specialInstructions: String,
  razorpayOrderId: String,
  razorpayPaymentId: String,
  razorpaySignature: String,
  // 🔥 ADDED FOR OFFLINE ORDER SUPPORT
  orderType: {
    type: String,
    enum: ['online', 'offline'],
    default: 'online'
  },
  processedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Admin',
    index: true
  },
  // 🔥 ADDED FOR OFFLINE ORDER CUSTOMER INFO
  customerName: String,
  customerPhone: String,
  deliveredAt: Date
}, { 
  timestamps: true 
});

// Virtual for calculating total savings
orderSchema.virtual('totalSavings').get(function() {
  return this.totalAmount - this.finalAmount;
});

// Virtual for calculating discount percentage
orderSchema.virtual('overallDiscountPercentage').get(function() {
  if (this.totalAmount > 0) {
    return ((this.totalAmount - this.finalAmount) / this.totalAmount) * 100;
  }
  return 0;
});

// Method to check if order has discounts
orderSchema.methods.hasDiscounts = function() {
  return this.discount > 0 || 
         this.items.some(item => item.discountDetails?.hasDiscount) ||
         (this.discountSummary && this.discountSummary.totalDiscount > 0);
};

// Method to get items with discounts
orderSchema.methods.getDiscountedItems = function() {
  return this.items.filter(item => item.discountDetails?.hasDiscount);
};

// Method to calculate discount summary (can be used for migration)
orderSchema.methods.calculateDiscountSummary = function() {
  let totalDiscount = 0;
  let totalBaseAmount = 0;
  let itemsWithDiscount = 0;
  let extendedRangeItems = 0;

  this.items.forEach(item => {
    totalBaseAmount += (item.originalPrice || item.price) * item.quantity;
    
    if (item.discountDetails) {
      totalDiscount += item.discountDetails.savings || 0;
      if (item.discountDetails.hasDiscount) {
        itemsWithDiscount++;
      }
      if (item.discountDetails.isExtendedRange) {
        extendedRangeItems++;
      }
    }
  });

  return {
    totalDiscount,
    totalBaseAmount,
    finalAmount: this.finalAmount,
    savingsPercentage: totalBaseAmount > 0 ? (totalDiscount / totalBaseAmount) * 100 : 0,
    itemsWithDiscount,
    totalItems: this.items.length,
    extendedRangeItems
  };
};

// Pre-save middleware to auto-calculate discount summary if not set
orderSchema.pre('save', function(next) {
  // Auto-calculate discount summary if not already set
  if (!this.discountSummary && this.items.length > 0) {
    this.discountSummary = this.calculateDiscountSummary();
  }
  
  // Ensure discount field matches discount summary
  if (this.discountSummary) {
    this.discount = this.discountSummary.totalDiscount;
  }
  
  next();
});

// Indexes for better performance
orderSchema.index({ assignedRetailer: 1, orderStatus: 1 });
orderSchema.index({ customer: 1, createdAt: -1 });
orderSchema.index({ orderStatus: 1 });
orderSchema.index({ orderType: 1 });
orderSchema.index({ processedBy: 1 });
orderSchema.index({ 'discountSummary.totalDiscount': -1 }); // For discount analytics
orderSchema.index({ createdAt: -1, 'discountSummary.itemsWithDiscount': -1 }); // For discount reporting

// Static method to find orders with discounts
orderSchema.statics.findWithDiscounts = function(query = {}) {
  return this.find({
    ...query,
    $or: [
      { discount: { $gt: 0 } },
      { 'items.discountDetails.hasDiscount': true },
      { 'discountSummary.totalDiscount': { $gt: 0 } }
    ]
  });
};

// Static method to get discount statistics
orderSchema.statics.getDiscountStats = async function(retailerId = null, startDate = null, endDate = null) {
  const matchStage = {
    orderStatus: { $in: ['delivered', 'completed'] },
    'discountSummary.totalDiscount': { $gt: 0 }
  };

  if (retailerId) {
    matchStage.assignedRetailer = retailerId;
  }

  if (startDate && endDate) {
    matchStage.createdAt = {
      $gte: new Date(startDate),
      $lte: new Date(endDate)
    };
  }

  const stats = await this.aggregate([
    { $match: matchStage },
    {
      $group: {
        _id: null,
        totalOrders: { $sum: 1 },
        totalDiscountAmount: { $sum: '$discountSummary.totalDiscount' },
        totalSales: { $sum: '$finalAmount' },
        totalBaseSales: { $sum: '$discountSummary.totalBaseAmount' },
        avgDiscountPercentage: { $avg: '$discountSummary.savingsPercentage' },
        discountedOrdersCount: { $sum: 1 }
      }
    }
  ]);

  return stats[0] || {
    totalOrders: 0,
    totalDiscountAmount: 0,
    totalSales: 0,
    totalBaseSales: 0,
    avgDiscountPercentage: 0,
    discountedOrdersCount: 0
  };
};

const Order = mongoose.model('Order', orderSchema);

export default Order;