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
import adminAuth from '../middlewares/adminAuth.js';
import auth from '../middlewares/auth.js';
import upload from '../middlewares/upload.js';

const router = express.Router();

// Public routes
router.get('/', getCategories);
router.get('/products', getAllProducts);
router.get('/:categoryId/products', getProductsByCategory);
router.get('/products/search', searchProducts);

// Protected routes (Admin only)
router.post('/', auth, adminAuth, upload.single('image'), createCategory);
router.put('/:id', auth, adminAuth, upload.single('image'), updateCategory);
router.delete('/:id', auth, adminAuth, deleteCategory);

export default router;
