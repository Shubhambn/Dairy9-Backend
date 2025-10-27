import express from 'express';
import {
  createCategory,
  deleteCategory,
  getAllProducts,
  getCategories,
  getProductsByCategory,
  searchProducts,
  updateCategory
} from '../controllers/category.controller.js';
import auth from '../middlewares/auth.js';
import adminAuth from '../middlewares/adminAuth.js';
import upload from '../middlewares/upload.js';

const router = express.Router();

// Public routes
router.get('/categories', getCategories);
router.get('/products', getAllProducts);
router.get('/categories/:categoryId/products', getProductsByCategory);
router.get('/products/search', searchProducts);

// Protected routes (Admin only)
router.post('/categories', auth, adminAuth, upload.single('image'), createCategory);
router.put('/categories/:id', auth, adminAuth, upload.single('image'), updateCategory);
router.delete('/categories/:id', auth, adminAuth, deleteCategory);

export default router;
