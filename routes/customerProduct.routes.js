// C:\Users\Krishna\OneDrive\Desktop\backend-dairy9\Dairy9-Backend\routes\customerProduct.routes.js

import express from 'express';
import auth from '../middlewares/auth.js';
import Customer from '../models/customer.model.js';
import InventoryService from '../services/inventory.service.js';

const router = express.Router();

router.use(auth);

/**
 * GET /api/customer/products/my-products
 * Returns inventory for the retailer assigned to the logged-in customer
 */
router.get('/my-products', async (req, res) => {
  try {
    const customer = await Customer.findOne({ user: req.user._id });

    if (!customer) {
      return res.status(404).json({ success: false, message: 'Customer profile not found' });
    }

    const retailerId = customer.assignedRetailer;
    if (!retailerId) {
      return res.status(404).json({ success: false, message: 'No retailer assigned to this customer' });
    }

    const inventoryData = await InventoryService.getRetailerInventory(retailerId);

    return res.status(200).json({
      success: true,
      retailerId,
      inventory: inventoryData.inventory,
      summary: inventoryData.summary
    });
  } catch (err) {
    console.error('Error fetching my-products:', err);
    return res.status(500).json({ success: false, message: 'Server error', error: err.message });
  }
});

export default router;
