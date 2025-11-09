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
import { generateProductQR,scanProductQR  } from '../controllers/product.controller.js';
import { testCloudinaryConnection } from '../utils/cloudinaryUpload.js'; // adjust path if needed


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

// Generate QR for a product
router.post("/products/generate/:id", generateProductQR);

// Scan and get product info
router.post("/products/scan", scanProductQR);

// Add this to your routes for testing
router.get('/test-cloudinary', async (req, res) => {
  try {
    const cloudinaryConnected = await testCloudinaryConnection();
    if (cloudinaryConnected) {
      res.json({ 
        success: true, 
        message: 'Cloudinary is properly configured' 
      });
    } else {
      res.status(503).json({ 
        success: false, 
        message: 'Cloudinary configuration issue' 
      });
    }
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      message: 'Cloudinary test failed',
      error: error.message 
    });
  }
});


export default router;