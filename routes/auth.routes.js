import { Router } from 'express';
import { 
  sendOTP, 
  verifyOTP, 
  signup, 
  resendOTP, 
  getCurrentUser 
} from '../controllers/auth.controller.js';
import auth from '../middlewares/auth.js';
import { authRateLimit } from '../middlewares/ratelimiter.js';

const router = Router();

// Public routes with rate limiting
router.post('/send-otp', authRateLimit, sendOTP);
router.post('/verify-otp', authRateLimit, verifyOTP);
router.post('/signup', authRateLimit, signup);
router.post('/resend-otp', authRateLimit, resendOTP);

// Protected routes (require authentication)
router.get('/me', auth, getCurrentUser);
router.get('/dashboard', auth, (req, res) => {
  res.json({
    success: true,
    message: 'Welcome to dashboard',
    user: {
      id: req.user.id,
      phone: req.user.phone,
      role: req.user.role
    },
    timestamp: new Date().toISOString()
  });
});

// Health check endpoint
router.get('/health', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'Auth service is running',
    timestamp: new Date().toISOString(),
    version: '1.0.0'
  });
});

export default router;