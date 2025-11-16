// middleware/superadmin.auth.js
import jwt from 'jsonwebtoken';
import User from '../models/user.model.js';

export async function authenticateSuperAdmin(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, message: 'No token provided' });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'fallback-secret-key');

    const user = await User.findById(decoded.id);
    if (!user || user.role !== 'superadmin') {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    req.user = user;
    next();
  } catch (error) {
    console.error('❌ SuperAdmin Auth Error:', error);
    return res.status(401).json({ success: false, message: 'Invalid or expired token' });
  }
}
