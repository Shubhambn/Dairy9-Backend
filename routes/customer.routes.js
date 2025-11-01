import express from 'express';
import { 
  createUpdateProfile, 
  getProfile, 
  addOrder, 
  getOrderHistory,
  updateDeliveryAddress,
  addAddressCoordinates 
} from '../controllers/customer.controller.js';
import auth from '../middlewares/auth.js';

const router = express.Router();

// All routes are protected
router.use(auth);

// Profile routes
router.post('/profile', createUpdateProfile);
router.get('/profile', getProfile);

// Order history routes
router.post('/orders', addOrder);
router.get('/orders', getOrderHistory);

// Address management routes
router.put('/address', updateDeliveryAddress);
router.put('/address/coordinates', addAddressCoordinates);

export default router;