import mongoose from "mongoose";

const customerSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  personalInfo: {
    fullName: String,
    email: String,
    alternatePhone: String,
    dateOfBirth: Date
  },
  deliveryAddress: {
    addressLine1: { type: String, required: false },
    addressLine2: String,
    city: { type: String, required: false },
    state: { type: String, required: false },
    pincode: { type: String, required: false },
    landmark: String,
    coordinates: {
      latitude: { type: Number, required: false },
      longitude: { type: Number, required: false }
    },
    formattedAddress: String
  },
  preferences: {
    deliveryTime: String,
    notifications: {
      email: { type: Boolean, default: true },
      sms: { type: Boolean, default: true },
      push: { type: Boolean, default: true }
    }
  },
  orderHistory: [{
    orderId: String,
    products: [{
      name: String,
      quantity: Number,
      price: Number
    }],
    totalAmount: Number,
    orderDate: { type: Date, default: Date.now },
    status: { type: String, enum: ['pending', 'delivered', 'cancelled'], default: 'pending' }
  }],
  walletBalance: {
    type: Number,
    default: 0
  }
}, { timestamps: true });

// Add index for better query performance
customerSchema.index({ user: 1 });
customerSchema.index({ 'deliveryAddress.pincode': 1 });

const Customer = mongoose.model('Customer', customerSchema);
export default Customer;