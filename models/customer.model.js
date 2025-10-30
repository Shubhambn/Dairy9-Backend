// C:\Users\Krishna\OneDrive\Desktop\backend-dairy9\Dairy9-Backend\models\customer.model.js

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

const Customer = mongoose.model('Customer', customerSchema);
export default Customer;
