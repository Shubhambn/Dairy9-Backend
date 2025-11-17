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

// =============================================
// PROTECTED ROUTES (Admin only)
// =============================================

// Create category (both patterns supported)
router.post('/categories', auth, adminAuth, upload.single('image'), createCategory);
router.post('/', auth, adminAuth, upload.single('image'), createCategory); // Alternative pattern

// Update category (both patterns supported)
router.put('/categories/:id', auth, adminAuth, upload.single('image'), updateCategory);
router.put('/:id', auth, adminAuth, upload.single('image'), updateCategory); // Alternative pattern

// Delete category (both patterns supported)
router.delete('/categories/:id', auth, adminAuth, deleteCategory);
router.delete('/:id', auth, adminAuth, deleteCategory); // Alternative pattern

export default router;