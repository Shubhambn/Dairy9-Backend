import express from 'express';
import {
  getAllProducts,
  getCategories,
  getProductsByCategory,
  searchProducts,
} from '../controllers/category.controller.js';

const router = express.Router();

// =============================================
// PUBLIC ROUTES
// =============================================

// Get all categories (both patterns supported)
router.get('/categories', getCategories);
router.get('/', getCategories); // Alternative pattern

// Get all products (both patterns supported)
router.get('/products', getAllProducts);
router.get('/categories/products', getAllProducts); // Alternative pattern

// Get products by category (both patterns supported)
router.get('/categories/:categoryId/products', getProductsByCategory);
router.get('/:categoryId/products', getProductsByCategory); // Alternative pattern

// Search products (both patterns supported)
router.get('/products/search', searchProducts);
router.get('/categories/products/search', searchProducts); // Alternative pattern



export default router;