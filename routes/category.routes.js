// C:\Users\Krishna\OneDrive\Desktop\backend-dairy9\Dairy9-Backend\routes\category.routes.js

import express from 'express';
import {
  getCategories,
  getProductsByCategory,
  searchProducts,
  getAllProducts,
  createCategory
} from '../controllers/category.controller.js';
import auth from '../middlewares/auth.js';

const router = express.Router();

// Public routes
router.get('/categories', getCategories);
router.get('/products', getAllProducts);
router.get('/categories/:categoryId/products', getProductsByCategory);
router.get('/products/search', searchProducts);

// Protected routes (for admin in future)
router.post('/categories', auth, createCategory);

export default router;