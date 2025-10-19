// controllers/auth.controller.js
import User from '../models/user.model.js';
import jwt from 'jsonwebtoken';
import { generateOTP } from '../utils/generateOTP.js';

export async function sendOTP(req, res) {
  try {
    const { phone } = req.body;
    if (!phone) return res.status(400).json({ message: 'Phone required' });

    let user = await User.findOne({ phone });
    if (!user) user = await User.create({ phone });

    const otpCode = generateOTP();
    user.otp = { code: otpCode, expiresAt: new Date(Date.now() + 5*60*1000) };
    await user.save();

    console.log(`📲 OTP for ${phone}: ${otpCode}`); // Replace with SMS provider

    res.status(200).json({ message: 'OTP sent successfully' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
}

export async function verifyOTP(req, res) {
  try {
    const { phone, otp } = req.body;
    const user = await User.findOne({ phone });
    if (!user) return res.status(404).json({ message: 'User not found' });

    if (!user.otp || user.otp.code !== otp)
      return res.status(400).json({ message: 'Invalid OTP' });
    if (user.otp.expiresAt < Date.now())
      return res.status(400).json({ message: 'OTP expired' });

    user.isVerified = true;
    user.otp = undefined;
    await user.save();

    const token = jwt.sign(
      { id: user._id, phone: user.phone },
      process.env.JWT_SECRET,
      { expiresIn: '30d' }
    );

    res.status(200).json({
      message: 'OTP verified',
      token,
      user: { id: user._id, phone: user.phone }
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
}
