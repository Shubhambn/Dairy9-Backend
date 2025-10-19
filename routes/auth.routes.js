// routes/auth.routes.js
import { Router } from 'express';
import { sendOTP, verifyOTP } from '../controllers/auth.controller.js';
import auth from '../middlewares/auth.js';

const router = Router();

router.post('/send-otp', sendOTP);
router.post('/verify-otp', verifyOTP);

// Protected route example
router.get('/dashboard', auth, (req, res) => {
  res.json({
    message: 'Welcome to dashboard',
    user: req.user,
    timestamp: new Date().toISOString()
  });
});

export default router;
