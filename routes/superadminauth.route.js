// /home/shubh/Dairy9-New/new-bac/Dairy9-Backend/routes/superadminauth.route.js
import express from 'express';
import { verifySuperAdminPassword } from '../controllers/superadmin.controller';

const router = express.Router();

// Step 1 - Verify OTP
// router.post('/verify-otp', verifyOTP);

// Step 2 - Verify secret key
router.post('/verify-password', verifySuperAdminPassword);

export default router;
