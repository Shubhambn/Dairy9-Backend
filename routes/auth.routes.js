// C:\Users\Krishna\OneDrive\Desktop\backend-dairy9\Dairy9-Backend\routes\auth.routes.js

import { Router } from 'express';
import { sendOTP, verifyOTP, signup } from '../controllers/auth.controller.js';
import auth from '../middlewares/auth.js';
import { authRateLimit } from '../middlewares/ratelimiter.js';

const router = Router();

router.post('/send-otp', authRateLimit, sendOTP);
router.post('/verify-otp', authRateLimit, verifyOTP);
router.post('/signup', authRateLimit, signup);

// Protected route example
router.get('/dashboard', auth, (req, res) => {
  res.json({
    message: 'Welcome to dashboard',
    user: req.user,
    timestamp: new Date().toISOString()
  });
});

export default router;