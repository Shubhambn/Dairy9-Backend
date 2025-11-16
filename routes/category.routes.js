import express from 'express';
import {
  getAllProducts,
  getCategories,
  getProductsByCategory,
  searchProducts,
} from '../controllers/category.controller.js';

const router = express.Router();

// Public routes
router.get('/categories', getCategories);
router.get('/products', getAllProducts);
router.get('/categories/:categoryId/products', getProductsByCategory);
router.get('/products/search', searchProducts);



export default router;
