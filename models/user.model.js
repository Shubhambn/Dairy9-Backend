import mongoose from 'mongoose';

const userSchema = new mongoose.Schema({
  phone: { type: String, required: true, unique: true },
  otp: { code: String, expiresAt: Date },
  isVerified: { type: Boolean, default: false },
  customerProfile: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer' }
}, { timestamps: true });

const User = mongoose.model('User', userSchema);
export default User;
