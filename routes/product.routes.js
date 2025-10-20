// C:\Users\Krishna\OneDrive\Desktop\backend-dairy9\Dairy9-Backend\routes\product.routes.js

import express from 'express';
import {
  createProduct,
  getAllProducts,
  getProductById,
  updateProduct,
  deleteProduct,
  getFeaturedProducts,
  searchProducts
} from '../controllers/product.controller.js';
import auth from '../middlewares/auth.js';

const router = express.Router();

// Public routes
router.get('/products', getAllProducts);
router.get('/products/featured', getFeaturedProducts);
router.get('/products/search', searchProducts);
router.get('/products/:id', getProductById);

// Protected routes (Admin)
router.post('/products', auth, createProduct);
router.put('/products/:id', auth, updateProduct);
router.delete('/products/:id', auth, deleteProduct);

export default router;