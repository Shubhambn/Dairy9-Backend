import express from 'express';
import { createUpdateProfile, getProfile, addOrder, getOrderHistory } from '../controllers/customer.controller.js';
import auth from '../middlewares/auth.js';

const router = express.Router();

// All routes are protected
router.use(auth);

router.post('/profile', createUpdateProfile);
router.get('/profile', getProfile);
router.post('/orders', addOrder);
router.get('/orders', getOrderHistory);

export default router;
