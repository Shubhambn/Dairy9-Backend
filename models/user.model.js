// models/user.model.js
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

const userSchema = new mongoose.Schema({
  phone: { type: String, required: true, unique: true },
  role: { type: String, enum: ['customer', 'admin', 'superadmin'], default: 'customer' },
  otp: { code: String, expiresAt: Date },
  isVerified: { type: Boolean, default: false },
  superadminPassword: { type: String, select: false },

  // 🧩 Add these if needed
  customerProfile: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer' },
  adminProfile: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin' }
}, { timestamps: true });

userSchema.pre('save', async function (next) {
  if (!this.isModified('superadminPassword')) return next();
  const salt = await bcrypt.genSalt(10);
  this.superadminPassword = await bcrypt.hash(this.superadminPassword, salt);
  next();
});

const User = mongoose.model('User', userSchema);
export default User;
