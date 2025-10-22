// C:\Users\Krishna\OneDrive\Desktop\backend-dairy9\Dairy9-Backend\routes\product.routes.js

import express from 'express';
import {
  createProduct,
  getAllProducts,
  getProductById,
  updateProduct,
  deleteProduct,
  getFeaturedProducts,
  searchProducts,
  uploadProductImages,
  deleteProductImage
} from '../controllers/product.controller.js';
import auth from '../middlewares/auth.js';
import upload from '../middlewares/upload.js';

const router = express.Router();

// Public routes
router.get('/products', getAllProducts);
router.get('/products/featured', getFeaturedProducts);
router.get('/products/search', searchProducts);
router.get('/products/:id', getProductById);

// Protected routes (Admin) with file upload
router.post('/products', auth, upload.single('image'), createProduct);
router.put('/products/:id', auth, upload.single('image'), updateProduct);
router.delete('/products/:id', auth, deleteProduct);

// Image management routes
router.post('/products/:id/images', auth, upload.array('images', 5), uploadProductImages);
router.delete('/products/:id/images/:imageId', auth, deleteProductImage);

export default router;