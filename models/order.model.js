import mongoose from 'mongoose';

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
  unit: String,
    reservedQuantity: {
    type: Number,
    default: 0
  },
  isReserved: {
    type: Boolean,
    default: false
  }
});

const orderSchema = new mongoose.Schema({
  orderId: {
    type: String,
    unique: true,
    required: true
  },
  customer: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Customer',
    required: true
  },
  items: [orderItemSchema],
  totalAmount: {
    type: Number,
    required: true,
    min: 0
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
    enum: ['pending', 'confirmed', 'preparing', 'out_for_delivery', 'delivered', 'cancelled'],
    default: 'pending'
  },
  deliveryDate: Date,
  specialInstructions: String,
  razorpayOrderId: String,
  razorpayPaymentId: String,
  razorpaySignature: String
}, { 
  timestamps: true 
});

// Indexes for better performance
orderSchema.index({ assignedRetailer: 1, orderStatus: 1 });
orderSchema.index({ customer: 1, createdAt: -1 });
orderSchema.index({ orderStatus: 1 });

const Order = mongoose.model('Order', orderSchema);
export default Order;