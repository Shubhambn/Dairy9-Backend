// C:\Users\Krishna\OneDrive\Desktop\backend-dairy9\Dairy9-Backend\routes\payment.routes.js

import express from 'express';
import {
  createPayment,
  verifyPayment,
  getPaymentDetails,
  getCustomerPayments
} from '../controllers/payment.controller.js';
import auth from '../middlewares/auth.js';

const router = express.Router();

// All routes are protected
router.use(auth);

router.post('/', createPayment);
router.post('/verify', verifyPayment);
router.get('/', getCustomerPayments);
router.get('/:id', getPaymentDetails);

export default router;