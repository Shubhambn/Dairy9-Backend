const router = require('express').Router();
const authController = require('../controllers/auth.controller'); // ✅ Correct file name
const auth = require('../middlewares/auth');

router.post('/send-otp', authController.sendOTP);
router.post('/verify-otp', authController.verifyOTP);

// Protected route example
router.get('/dashboard', auth, (req, res) => {
  res.json({ 
    message: 'Welcome to dashboard', 
    user: req.user,
    timestamp: new Date().toISOString()
  });
});

module.exports = router;