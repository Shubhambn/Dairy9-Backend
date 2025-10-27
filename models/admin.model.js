// C:\Users\Krishna\OneDrive\Desktop\backend-dairy9\Dairy9-Backend\models\admin.model.js

import mongoose from 'mongoose';

const adminSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  fullName: {
    type: String,
    required: true
  },
  shopName: {
    type: String,
    required: true
  },
  address: {
    type: String,
    required: true
  },
  location: {
    coordinates: {
      latitude: { type: Number, required: true },
      longitude: { type: Number, required: true }
    },
    formattedAddress: String,
    city: String,
    state: String,
    pincode: String
  },
  serviceRadius: {
    type: Number,
    default: 50, // Default 50km radius
    min: 1,
    max: 100
  },
  contactNumber: {
    type: String,
    required: true
  },
  isActive: {
    type: Boolean,
    default: true
  }
}, { 
  timestamps: true 
});

const Admin = mongoose.model('Admin', adminSchema);
export default Admin;