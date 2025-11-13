// C:\Users\Krishna\OneDrive\Desktop\backend-dairy9\Dairy9-Backend\routes\customer.routes.js

import express from 'express';
import { 
  createUpdateProfile, 
  getProfile, 
  addOrder, 
  getOrderHistory,
  updateDeliveryAddress,
  addAddressCoordinates 
} from '../controllers/customer.controller.js';
import { updateCurrentLocation } from "../controllers/location.controller.js";
import auth from '../middlewares/auth.js';

const router = express.Router();

// All routes are protected
router.use(auth);

// Profile routes
router.post('/profile', createUpdateProfile);
router.get('/profile', getProfile);
router.put("/location/current", auth, updateCurrentLocation);

// Order history routes
router.post('/orders', addOrder);
router.get('/orders', getOrderHistory);

// Address management routes
router.put('/address', updateDeliveryAddress);
router.put('/address/coordinates', addAddressCoordinates);

export default router;