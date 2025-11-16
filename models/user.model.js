// C:\Users\Krishna\OneDrive\Desktop\backend-dairy9\Dairy9-Backend\models\user.model.js

import mongoose from 'mongoose';

const userSchema = new mongoose.Schema({
  phone: { type: String, required: true, unique: true },
  otp: { code: String, expiresAt: Date },
  isVerified: { type: Boolean, default: false },
  customerProfile: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer' },
  adminProfile: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin' },
  role: { 
    type: String, 
    enum: ['customer', 'admin'], 
    default: 'customer' 
  }
}, { timestamps: true });

const User = mongoose.model('User', userSchema);
export default User;