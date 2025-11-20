// C:\Users\Krishna\OneDrive\Desktop\backend-dairy9\Dairy9-Backend\controllers\product.controller.js

import Product from '../models/product.model.js';
import { v2 as cloudinary } from 'cloudinary';
import Category from '../models/category.model.js';
import { 
  uploadToCloudinary, 
  uploadMultipleToCloudinary, 
  deleteFromCloudinary,
  testCloudinaryConnection
} from '../utils/cloudinaryUpload.js';
import { generateQRCode } from '../utils/QrGen.utils.js';
import { addTextToQR } from '../utils/Qrinfo.utils.js';
import { generateBarcode, addTextToBarcode } from '../utils/barcodeGen.utils.js';
import streamifier from 'streamifier';
import openFoodFactsService from '../services/openFoodFacts.service.js';

// ──────────────────────────────────────────────────────────────
// HELPER FUNCTIONS
// ──────────────────────────────────────────────────────────────

// Helper function to generate and assign barcode
const generateAndAssignBarcode = async (product) => {
  const barcodeText = product._id.toString();
  
  const barcodeBuffer = await generateBarcode(barcodeText, product.name, product.unitSize, product.unit);
  const barcodeWithTextBuffer = await addTextToBarcode(barcodeBuffer, product.name);
  const barcodeUpload = await uploadToCloudinary(barcodeWithTextBuffer, 'dairy9/products/barcode');

  // Save barcode info
  product.barcodeUrl = barcodeUpload.secure_url;
  product.barcodeId = barcodeText;
  await product.save();

  return barcodeUpload.secure_url;
};

// Helper function to check barcode uniqueness
const checkBarcodeUniqueness = async (barcode, excludeProductId = null) => {
  if (!barcode) return { isUnique: true, existingProduct: null };
  
  const filter = {
    $or: [
      { scannedBarcodeId: barcode.trim() },
      { barcodeId: barcode.trim() }
    ],
    isAvailable: true
  };
  
  if (excludeProductId) {
    filter._id = { $ne: excludeProductId };
  }
  
  const existingProduct = await Product.findOne(filter);
  
  return {
    isUnique: !existingProduct,
    existingProduct: existingProduct
  };
};

// ──────────────────────────────────────────────────────────────
// PRODUCT CRUD OPERATIONS
// ──────────────────────────────────────────────────────────────

// @desc    Create new product (with QR + text overlay)
// @route   POST /api/catalog/products
// @access  Private (Admin)
export const createProduct = async (req, res) => {
  // 0️⃣ Test Cloudinary connection
  const cloudinaryConnected = await testCloudinaryConnection();
  if (!cloudinaryConnected) {
    return res.status(503).json({
      success: false,
      message: 'File upload service temporarily unavailable'
    });
  }

  try {
    const { 
      name, description, price, category, unit, unitSize, stock, 
      milkType, nutritionalInfo, tags, discount, isFeatured,
      scannedBarcodeId,
      cloudinaryImages
    } = req.body;

    // 1️⃣ Validate required fields
    if (!name || !price || !category || !unit) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: name, price, category, unit'
      });
    }

    // 2️⃣ Validate category
    const categoryExists = await Category.findById(category);
    if (!categoryExists) {
      return res.status(400).json({ 
        success: false, 
        message: 'Category not found' 
      });
    }

    // 3️⃣ Check duplicate product name
    const existingProduct = await Product.findOne({ 
      name: { $regex: new RegExp(`^${name}$`, 'i') },
      isAvailable: true
    });
    if (existingProduct) {
      return res.status(400).json({
        success: false,
        message: 'Product with this name already exists'
      });
    }

    // 4️⃣ Check duplicate barcode using helper function
    if (scannedBarcodeId) {
      const { isUnique, existingProduct: barcodeProduct } = await checkBarcodeUniqueness(scannedBarcodeId);
      
      if (!isUnique) {
        return res.status(400).json({
          success: false,
          message: 'This barcode is already assigned to another product',
          existingProduct: {
            id: barcodeProduct._id,
            name: barcodeProduct.name
          }
        });
      }
    }

    // 5️⃣ Handle images from multiple sources
    let imageUrl = '/images/default-product.jpg';
    let imagePublicId = null;
    let additionalImages = [];

    // Priority 1: Use Cloudinary images from barcode scan
    if (cloudinaryImages && Array.isArray(cloudinaryImages) && cloudinaryImages.length > 0) {
      console.log('📸 Using pre-uploaded Cloudinary images:', cloudinaryImages.length);
      
      const mainImage = cloudinaryImages[0];
      imageUrl = mainImage.url;
      imagePublicId = mainImage.publicId;
      
      additionalImages = cloudinaryImages.slice(1).map(img => ({
        url: img.url,
        publicId: img.publicId
      }));
    }
    // Priority 2: Upload from FormData if no Cloudinary images
    else if (req.file) {
      try {
        const uploadResult = await uploadToCloudinary(req.file.buffer, 'dairy9/products');
        imageUrl = uploadResult.secure_url;
        imagePublicId = uploadResult.public_id;
      } catch (uploadError) {
        console.error('Image upload failed:', uploadError.message);
      }
    }

    // Handle additional FormData images
    if (req.files && req.files.length > 1) {
      try {
        const additionalFiles = req.files.slice(1);
        const uploadResults = await uploadMultipleToCloudinary(
          additionalFiles, 
          'dairy9/products/additional'
        );
        
        const formDataAdditionalImages = uploadResults.map(img => ({
          url: img.secure_url,
          publicId: img.public_id
        }));
        
        additionalImages = [...additionalImages, ...formDataAdditionalImages];
      } catch (uploadError) {
        console.error('Additional images upload failed:', uploadError.message);
      }
    }

    // 6️⃣ Create product first to get _id
    const product = new Product({
      name,
      description: description || '',
      price: Number(price),
      category,
      unit,
      unitSize: unitSize || '1',
      stock: Number(stock) || 0,
      milkType: milkType || 'Cow',
      image: imageUrl,
      imagePublicId,
      images: additionalImages,
      nutritionalInfo: nutritionalInfo || {},
      tags: tags || [],
      discount: Number(discount) || 0,
      isFeatured: isFeatured || false,
      isAvailable: true,
      scannedBarcodeId: scannedBarcodeId?.trim() || null
    });

    await product.save();
    await product.populate('category', 'name');

    // 7️⃣ Generate QR code
    try {
      const qrPayload = {
        productId: product._id.toString(),
        name: product.name,
        category: categoryExists.name,
        price: product.price
      };

      const qrBuffer = await generateQRCode(qrPayload);
      const qrWithTextBuffer = await addTextToQR(qrBuffer, product.name);
      const qrUpload = await uploadToCloudinary(qrWithTextBuffer, 'dairy9/products/qr');

      product.qrCodeUrl = qrUpload.secure_url;
      product.qrCodeId = qrUpload.public_id;
      await product.save();

    } catch (qrError) {
      console.error('QR code generation/upload failed:', qrError.message);
    }

    // 8️⃣ Fetch final updated product for response
    const finalProduct = await Product.findById(product._id).populate('category', 'name');

    console.log('✅ Product created successfully with', additionalImages.length + 1, 'images');

    // 9️⃣ Return success
    res.status(201).json({
      success: true,
      message: finalProduct.qrCodeUrl 
        ? '✅ Product created successfully with QR' 
        : '✅ Product created successfully (QR generation skipped)',
      product: finalProduct
    });

  } catch (error) {
    console.error('Create Product Error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Server error during product creation', 
      error: error.message 
    });
  }
};

// @desc    Get all products with filters
// @route   GET /api/catalog/products
// @access  Public
export const getAllProducts = async (req, res) => {
  try {
    const { 
      category, 
      milkType, 
      minPrice, 
      maxPrice, 
      sortBy, 
      search,
      featured,
      page = 1, 
      limit = 10 
    } = req.query;

    // Build filter object
    let filter = { isAvailable: true };
    
    if (category) filter.category = category;
    if (milkType && milkType !== 'all') filter.milkType = milkType;
    if (featured === 'true') filter.isFeatured = true;
    
    // Price range filter
    if (minPrice || maxPrice) {
      filter.price = {};
      if (minPrice) filter.price.$gte = Number(minPrice);
      if (maxPrice) filter.price.$lte = Number(maxPrice);
    }
    
    // Search filter
    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } },
        { tags: { $in: [new RegExp(search, 'i')] } }
      ];
    }

    // Sort options
    let sortOptions = {};
    switch(sortBy) {
      case 'price-low': sortOptions = { price: 1 }; break;
      case 'price-high': sortOptions = { price: -1 }; break;
      case 'name': sortOptions = { name: 1 }; break;
      case 'newest': sortOptions = { createdAt: -1 }; break;
      case 'featured': sortOptions = { isFeatured: -1, createdAt: -1 }; break;
      default: sortOptions = { createdAt: -1 };
    }

    // Pagination
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;

    // Get products with pagination
    const products = await Product.find(filter)
      .populate('category', 'name')
      .sort(sortOptions)
      .skip(skip)
      .limit(limitNum)
      .lean();

    // Add enhanced barcode info to each product
    const productsWithBarcodeInfo = products.map(product => ({
      ...product,
      discountedPrice: product.price - (product.price * (product.discount || 0) / 100),
      hasGeneratedBarcode: !!product.barcodeId,
      hasScannedBarcode: !!product.scannedBarcodeId,
      activeBarcodeId: product.scannedBarcodeId || product.barcodeId,
      barcodeType: product.scannedBarcodeId ? 'scanned' : (product.barcodeId ? 'generated' : 'none'),
      barcodeInfo: {
        generated: product.barcodeId ? {
          id: product.barcodeId,
          url: product.barcodeUrl,
          exists: true
        } : { exists: false },
        scanned: product.scannedBarcodeId ? {
          id: product.scannedBarcodeId,
          exists: true
        } : { exists: false }
      }
    }));

    // Get total count for pagination
    const total = await Product.countDocuments(filter);
    const totalPages = Math.ceil(total / limitNum);

    res.status(200).json({
      success: true,
      products: productsWithBarcodeInfo,
      pagination: {
        currentPage: pageNum,
        totalPages,
        totalProducts: total,
        hasNext: pageNum < totalPages,
        hasPrev: pageNum > 1
      }
    });
  } catch (error) {
    console.error('Get Products Error:', error);
    res.status(500).json({ 
      success: false,
      message: 'Server error', 
      error: error.message 
    });
  }
};

// @desc    Get single product by ID
// @route   GET /api/catalog/products/:id
// @access  Public
export const getProductById = async (req, res) => {
  try {
    const product = await Product.findById(req.params.id)
      .populate('category', 'name description');
    
    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Product not found'
      });
    }

    // Add enhanced barcode info
    const productWithBarcodeInfo = {
      ...product.toObject(),
      discountedPrice: product.price - (product.price * (product.discount || 0) / 100),
      hasGeneratedBarcode: !!product.barcodeId,
      hasScannedBarcode: !!product.scannedBarcodeId,
      activeBarcodeId: product.scannedBarcodeId || product.barcodeId,
      barcodeType: product.scannedBarcodeId ? 'scanned' : (product.barcodeId ? 'generated' : 'none'),
      barcodeInfo: {
        generated: product.barcodeId ? {
          id: product.barcodeId,
          url: product.barcodeUrl,
          exists: true
        } : { exists: false },
        scanned: product.scannedBarcodeId ? {
          id: product.scannedBarcodeId,
          exists: true
        } : { exists: false }
      }
    };

    res.status(200).json({
      success: true,
      product: productWithBarcodeInfo
    });
  } catch (error) {
    console.error('Get Product Error:', error);
    res.status(500).json({ 
      success: false,
      message: 'Server error', 
      error: error.message 
    });
  }
};

// @desc    Update product
// @route   PUT /api/catalog/products/:id
// @access  Private (Admin)
export const updateProduct = async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    
    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Product not found'
      });
    }

    // Check if category exists (if provided)
    if (req.body.category) {
      const categoryExists = await Category.findById(req.body.category);
      if (!categoryExists) {
        return res.status(400).json({
          success: false,
          message: 'Category not found'
        });
      }
    }

    // Check barcode uniqueness if scannedBarcodeId is being updated
    if (req.body.scannedBarcodeId && req.body.scannedBarcodeId !== product.scannedBarcodeId) {
      const { isUnique, existingProduct } = await checkBarcodeUniqueness(req.body.scannedBarcodeId, product._id);
      
      if (!isUnique) {
        return res.status(400).json({
          success: false,
          message: 'This barcode is already assigned to another product',
          existingProduct: {
            id: existingProduct._id,
            name: existingProduct.name
          }
        });
      }
    }

    // Handle image upload if new image is provided
    if (req.file) {
      try {
        // Delete old image from Cloudinary if exists
        if (product.imagePublicId) {
          await deleteFromCloudinary(product.imagePublicId);
        }

        // Upload new image
        const uploadResult = await uploadToCloudinary(req.file.buffer, 'dairy9/products');
        req.body.image = uploadResult.secure_url;
        req.body.imagePublicId = uploadResult.public_id;
      } catch (uploadError) {
        return res.status(400).json({
          success: false,
          message: 'Error uploading image',
          error: uploadError.message
        });
      }
    }

    // Handle additional images if provided
    if (req.files && req.files.length > 0) {
      try {
        // Upload additional images
        const uploadResults = await uploadMultipleToCloudinary(
          req.files, 
          'dairy9/products/additional'
        );

        const newImages = uploadResults.map(img => ({
          url: img.secure_url,
          publicId: img.public_id
        }));

        // Add to existing images
        if (!req.body.images) {
          req.body.images = [...product.images, ...newImages];
        }
      } catch (uploadError) {
        console.error('Additional images upload failed:', uploadError);
      }
    }

    // Handle deleted images
    if (req.body.deletedImages) {
      const deletedImageIds = Array.isArray(req.body.deletedImages) 
        ? req.body.deletedImages 
        : JSON.parse(req.body.deletedImages || '[]');
      
      // Delete from Cloudinary and remove from images array
      for (const imageId of deletedImageIds) {
        const imageToDelete = product.images.find(img => img._id.toString() === imageId);
        if (imageToDelete && imageToDelete.publicId) {
          try {
            await deleteFromCloudinary(imageToDelete.publicId);
          } catch (deleteError) {
            console.error('Error deleting image from Cloudinary:', deleteError);
          }
        }
      }

      // Update images array
      if (req.body.images) {
        req.body.images = req.body.images.filter(img => 
          !deletedImageIds.includes(img._id?.toString())
        );
      }
    }

    // Format tags if provided as string
    if (req.body.tags && typeof req.body.tags === 'string') {
      req.body.tags = req.body.tags.split(',').map(tag => tag.trim()).filter(tag => tag);
    }

    // Format nutritional info if provided as string
    if (req.body.nutritionalInfo && typeof req.body.nutritionalInfo === 'string') {
      req.body.nutritionalInfo = JSON.parse(req.body.nutritionalInfo);
    }

    const updatedProduct = await Product.findByIdAndUpdate(
      req.params.id,
      { $set: req.body },
      { new: true, runValidators: true }
    ).populate('category', 'name');

    res.status(200).json({
      success: true,
      message: 'Product updated successfully',
      product: updatedProduct
    });
  } catch (error) {
    console.error('Update Product Error:', error);
    res.status(500).json({ 
      success: false,
      message: 'Server error', 
      error: error.message 
    });
  }
};

// @desc    Delete product
// @route   DELETE /api/catalog/products/:id
// @access  Private (Admin)
export const deleteProduct = async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    
    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Product not found'
      });
    }

    // Delete images from Cloudinary
    try {
      if (product.imagePublicId) {
        await deleteFromCloudinary(product.imagePublicId);
      }

      // Delete additional images
      if (product.images && product.images.length > 0) {
        for (const img of product.images) {
          if (img.publicId) {
            await deleteFromCloudinary(img.publicId);
          }
        }
      }

      // Delete QR code if exists
      if (product.qrCodeId) {
        await deleteFromCloudinary(product.qrCodeId);
      }

      // Delete generated barcode image if exists
      if (product.barcodeUrl) {
        try {
          const publicId = product.barcodeUrl.split('/').pop().split('.')[0];
          const fullPublicId = `dairy9/products/barcode/${publicId}`;
          await deleteFromCloudinary(fullPublicId);
        } catch (barcodeDeleteError) {
          console.error('Error deleting barcode image:', barcodeDeleteError);
        }
      }
    } catch (deleteError) {
      console.error('Error deleting images from Cloudinary:', deleteError);
    }

    // Soft delete - set isAvailable to false
    product.isAvailable = false;
    await product.save();

    res.status(200).json({
      success: true,
      message: 'Product deleted successfully'
    });
  } catch (error) {
    console.error('Delete Product Error:', error);
    res.status(500).json({ 
      success: false,
      message: 'Server error', 
      error: error.message 
    });
  }
};

// @desc    Get featured products
// @route   GET /api/catalog/products/featured
// @access  Public
export const getFeaturedProducts = async (req, res) => {
  try {
    const products = await Product.find({ 
      isFeatured: true, 
      isAvailable: true 
    })
      .populate('category', 'name')
      .limit(8)
      .sort({ createdAt: -1 });

    const productsWithBarcodeInfo = products.map(product => ({
      ...product.toObject(),
      discountedPrice: product.price - (product.price * (product.discount || 0) / 100),
      hasGeneratedBarcode: !!product.barcodeId,
      hasScannedBarcode: !!product.scannedBarcodeId,
      activeBarcodeId: product.scannedBarcodeId || product.barcodeId
    }));

    res.status(200).json({
      success: true,
      products: productsWithBarcodeInfo
    });
  } catch (error) {
    console.error('Get Featured Products Error:', error);
    res.status(500).json({ 
      success: false,
      message: 'Server error', 
      error: error.message 
    });
  }
};

// @desc    Search products
// @route   GET /api/catalog/products/search
// @access  Public
export const searchProducts = async (req, res) => {
  try {
    const { q: query, category } = req.query;

    if (!query) {
      return res.status(400).json({
        success: false,
        message: 'Search query is required'
      });
    }

    let filter = { 
      isAvailable: true,
      $or: [
        { name: { $regex: query, $options: 'i' } },
        { description: { $regex: query, $options: 'i' } },
        { tags: { $in: [new RegExp(query, 'i')] } }
      ]
    };

    if (category) filter.category = category;

    const products = await Product.find(filter)
      .populate('category', 'name')
      .limit(20)
      .sort({ score: { $meta: 'textScore' }, createdAt: -1 });

    const productsWithBarcodeInfo = products.map(product => ({
      ...product.toObject(),
      discountedPrice: product.price - (product.price * (product.discount || 0) / 100),
      hasGeneratedBarcode: !!product.barcodeId,
      hasScannedBarcode: !!product.scannedBarcodeId,
      activeBarcodeId: product.scannedBarcodeId || product.barcodeId
    }));

    res.status(200).json({
      success: true,
      products: productsWithBarcodeInfo,
      searchQuery: query,
      totalResults: products.length
    });
  } catch (error) {
    console.error('Search Products Error:', error);
    res.status(500).json({ 
      success: false,
      message: 'Server error', 
      error: error.message 
    });
  }
};

// @desc    Upload product images
// @route   POST /api/catalog/products/:id/images
// @access  Private (Admin)
export const uploadProductImages = async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    
    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Product not found'
      });
    }

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No images provided'
      });
    }

    const uploadResults = await uploadMultipleToCloudinary(
      req.files, 
      'dairy9/products/additional'
    );

    const newImages = uploadResults.map(img => ({
      url: img.secure_url,
      publicId: img.public_id
    }));

    // Add new images to product
    product.images.push(...newImages);
    await product.save();

    res.status(200).json({
      success: true,
      message: 'Images uploaded successfully',
      images: newImages
    });
  } catch (error) {
    console.error('Upload Images Error:', error);
    res.status(500).json({ 
      success: false,
      message: 'Server error', 
      error: error.message 
    });
  }
};

// @desc    Delete product image
// @route   DELETE /api/catalog/products/:id/images/:imageId
// @access  Private (Admin)
export const deleteProductImage = async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    
    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Product not found'
      });
    }

    const imageIndex = product.images.findIndex(img => 
      img._id.toString() === req.params.imageId
    );

    if (imageIndex === -1) {
      return res.status(404).json({
        success: false,
        message: 'Image not found'
      });
    }

    const imageToDelete = product.images[imageIndex];

    // Delete from Cloudinary
    if (imageToDelete.publicId) {
      await deleteFromCloudinary(imageToDelete.publicId);
    }

    // Remove from product images array
    product.images.splice(imageIndex, 1);
    await product.save();

    res.status(200).json({
      success: true,
      message: 'Image deleted successfully'
    });
  } catch (error) {
    console.error('Delete Image Error:', error);
    res.status(500).json({ 
      success: false,
      message: 'Server error', 
      error: error.message 
    });
  }
};

// ──────────────────────────────────────────────────────────────
// QR CODE MANAGEMENT
// ──────────────────────────────────────────────────────────────

// @desc    Generate a QR for an existing product
// @route   POST /api/catalog/products/:id/generate-qr
// @access  Private (Admin)
export const generateProductQR = async (req, res) => {
  try {
    const { id } = req.params;

    // 1️⃣ Find product
    const product = await Product.findById(id);
    if (!product) {
      return res.status(404).json({ success: false, message: 'Product not found' });
    }

    // 2️⃣ Check if QR already exists
    if (product.qrCodeUrl && product.qrCodeId) {
      return res.status(200).json({
        success: true,
        message: 'QR code already exists',
        qrCodeUrl: product.qrCodeUrl
      });
    }

    // 3️⃣ Generate QR payload
    const qrPayload = {
      productId: product._id.toString(),
      name: product.name,
      price: product.price,
      category: product.category
    };

    // 4️⃣ Generate QR buffer
    const qrBuffer = await generateQRCode(qrPayload);

    // 5️⃣ Add text below QR
    const qrWithTextBuffer = await addTextToQR(qrBuffer, product.name);

    // 6️⃣ Upload QR to Cloudinary
    const qrUpload = await uploadToCloudinary(qrWithTextBuffer, 'dairy9/products/qr');

    // 7️⃣ Save QR info in product
    product.qrCodeUrl = qrUpload.secure_url;
    product.qrCodeId = qrUpload.public_id;
    await product.save();

    res.status(200).json({
      success: true,
      message: 'QR code generated successfully',
      qrCodeUrl: qrUpload.secure_url
    });

  } catch (error) {
    console.error('QR Generation Error:', error);
    res.status(500).json({ success: false, message: 'Failed to generate QR', error: error.message });
  }
};

// @desc    Decode QR — when user scans and sends data
// @route   POST /api/catalog/products/scan-qr
// @access  Public
export const scanProductQR = async (req, res) => {
  try {
    const { productId } = req.body;

    const product = await Product.findById(productId);
    if (!product) {
      return res.status(404).json({ message: "Product not found" });
    }

    res.status(200).json({
      message: "QR scan successful",
      product,
    });
  } catch (error) {
    console.error("Error scanning QR:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};

// ──────────────────────────────────────────────────────────────
// ENHANCED BARCODE MANAGEMENT FUNCTIONS
// ──────────────────────────────────────────────────────────────

// @desc    Scan and assign barcode to product (SCANNED BARCODE)
// @route   POST /api/catalog/products/:id/scan-barcode
// @access  Private (Admin)
export const scanAndAssignBarcode = async (req, res) => {
  try {
    const { id } = req.params;
    const { scannedBarcodeId } = req.body;

    console.log('=== SCANNED BARCODE ASSIGNMENT START ===');
    console.log('📦 Product ID:', id);
    console.log('📦 Scanned Barcode ID:', scannedBarcodeId);

    // 1️⃣ Validate input
    if (!scannedBarcodeId) {
      return res.status(400).json({
        success: false,
        message: 'Scanned barcode ID is required'
      });
    }

    // 2️⃣ Find product
    const product = await Product.findById(id);
    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Product not found'
      });
    }

    // 3️⃣ Use helper function to check barcode uniqueness
    const { isUnique, existingProduct } = await checkBarcodeUniqueness(scannedBarcodeId, id);

    if (!isUnique) {
      return res.status(400).json({
        success: false,
        message: 'This barcode is already assigned to another product',
        existingProduct: {
          id: existingProduct._id,
          name: existingProduct.name
        }
      });
    }

    // 4️⃣ Assign scanned barcode (DO NOT overwrite generated barcode)
    const oldScannedBarcode = product.scannedBarcodeId;
    product.scannedBarcodeId = scannedBarcodeId.trim();
    await product.save();

    console.log('✅ Scanned barcode assigned successfully');

    // 5️⃣ Return updated product with enhanced barcode info
    const updatedProduct = await Product.findById(id)
      .populate('category', 'name');

    const productWithBarcodeInfo = {
      ...updatedProduct.toObject(),
      hasGeneratedBarcode: !!updatedProduct.barcodeId,
      hasScannedBarcode: true,
      activeBarcodeId: scannedBarcodeId.trim(),
      barcodeType: 'scanned',
      barcodeId: updatedProduct.barcodeId,
      scannedBarcodeId: scannedBarcodeId.trim()
    };

    console.log('📦 Generated Barcode (barcodeId):', updatedProduct.barcodeId);
    console.log('📦 Scanned Barcode (scannedBarcodeId):', updatedProduct.scannedBarcodeId);

    res.status(200).json({
      success: true,
      message: 'Scanned barcode assigned successfully',
      barcodeType: 'scanned',
      scannedBarcodeId: scannedBarcodeId.trim(),
      previousScannedBarcode: oldScannedBarcode,
      product: productWithBarcodeInfo
    });

  } catch (error) {
    console.error('❌ Scanned Barcode Assignment Error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during scanned barcode assignment',
      error: error.message
    });
  }
};

// @desc    Generate barcode for product (GENERATED BARCODE)
// @route   POST /api/catalog/products/:id/generate-barcode
// @access  Private (Admin)
export const generateProductBarcode = async (req, res) => {
  try {
    const { id } = req.params;

    const product = await Product.findById(id);
    if (!product) {
      return res.status(404).json({ 
        success: false, 
        message: 'Product not found' 
      });
    }

    // Check if barcode already exists
    if (product.barcodeUrl && product.barcodeId) {
      const productWithBarcodeInfo = {
        ...product.toObject(),
        hasGeneratedBarcode: true,
        hasScannedBarcode: !!product.scannedBarcodeId,
        activeBarcodeId: product.scannedBarcodeId || product.barcodeId,
        barcodeType: product.scannedBarcodeId ? 'scanned' : 'generated'
      };

      return res.status(200).json({
        success: true,
        message: 'Generated barcode already exists',
        barcodeType: 'generated',
        barcodeUrl: product.barcodeUrl,
        barcodeId: product.barcodeId,
        product: productWithBarcodeInfo
      });
    }

    console.log('🔄 Generating barcode for:', product.name);

    // Generate barcode
    const barcodeUrl = await generateAndAssignBarcode(product);

    console.log('✅ Barcode generated successfully');

    const updatedProduct = await Product.findById(id)
      .populate('category', 'name');

    const productWithBarcodeInfo = {
      ...updatedProduct.toObject(),
      hasGeneratedBarcode: true,
      hasScannedBarcode: !!updatedProduct.scannedBarcodeId,
      activeBarcodeId: updatedProduct.scannedBarcodeId || product.barcodeId,
      barcodeType: updatedProduct.scannedBarcodeId ? 'scanned' : 'generated'
    };

    res.status(200).json({
      success: true,
      message: 'Barcode generated successfully',
      barcodeType: 'generated',
      barcodeUrl: barcodeUrl,
      barcodeId: product.barcodeId,
      product: productWithBarcodeInfo
    });

  } catch (error) {
    console.error('❌ Barcode Generation Error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to generate barcode', 
      error: error.message 
    });
  }
};

// @desc    Remove scanned barcode from product
// @route   DELETE /api/catalog/products/:id/scanned-barcode
// @access  Private (Admin)
export const removeScannedBarcode = async (req, res) => {
  try {
    const { id } = req.params;

    const product = await Product.findById(id);
    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Product not found'
      });
    }

    // Check if product has a scanned barcode
    if (!product.scannedBarcodeId) {
      return res.status(400).json({
        success: false,
        message: 'Product does not have a scanned barcode assigned'
      });
    }

    // Remove scanned barcode
    const removedBarcode = product.scannedBarcodeId;
    product.scannedBarcodeId = null;
    await product.save();

    const updatedProduct = await Product.findById(id)
      .populate('category', 'name');

    const productWithBarcodeInfo = {
      ...updatedProduct.toObject(),
      hasScannedBarcode: false,
      hasGeneratedBarcode: !!updatedProduct.barcodeId,
      activeBarcodeId: updatedProduct.barcodeId,
      barcodeType: updatedProduct.barcodeId ? 'generated' : 'none'
    };

    res.status(200).json({
      success: true,
      message: 'Scanned barcode removed successfully',
      removedBarcode: removedBarcode,
      product: productWithBarcodeInfo
    });

  } catch (error) {
    console.error('Scanned Barcode Removal Error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during scanned barcode removal',
      error: error.message
    });
  }
};

// @desc    Delete generated barcode from product
// @route   DELETE /api/catalog/products/:id/generated-barcode
// @access  Private (Admin)
export const deleteGeneratedBarcode = async (req, res) => {
  try {
    const { id } = req.params;

    const product = await Product.findById(id);
    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Product not found'
      });
    }

    // Check if product has a generated barcode
    if (!product.barcodeId || !product.barcodeUrl) {
      return res.status(400).json({
        success: false,
        message: 'Product does not have a generated barcode'
      });
    }

    // Delete barcode image from Cloudinary
    try {
      const publicId = product.barcodeUrl.split('/').pop().split('.')[0];
      const fullPublicId = `dairy9/products/barcode/${publicId}`;
      await deleteFromCloudinary(fullPublicId);
      console.log('✅ Barcode image deleted from Cloudinary');
    } catch (deleteError) {
      console.error('Error deleting barcode image from Cloudinary:', deleteError);
    }

    // Remove barcode info
    const removedBarcodeId = product.barcodeId;
    const removedBarcodeUrl = product.barcodeUrl;
    
    product.barcodeId = null;
    product.barcodeUrl = null;
    await product.save();

    const updatedProduct = await Product.findById(id)
      .populate('category', 'name');

    const productWithBarcodeInfo = {
      ...updatedProduct.toObject(),
      hasGeneratedBarcode: false,
      hasScannedBarcode: !!updatedProduct.scannedBarcodeId,
      activeBarcodeId: updatedProduct.scannedBarcodeId,
      barcodeType: updatedProduct.scannedBarcodeId ? 'scanned' : 'none'
    };

    res.status(200).json({
      success: true,
      message: 'Generated barcode deleted successfully',
      removedBarcode: {
        id: removedBarcodeId,
        url: removedBarcodeUrl
      },
      product: productWithBarcodeInfo
    });

  } catch (error) {
    console.error('Generated Barcode Deletion Error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during generated barcode deletion',
      error: error.message
    });
  }
};

// @desc    Get product by barcode (supports both scanned and generated)
// @route   GET /api/catalog/products/barcode/:barcodeId
// @access  Public
export const getProductByBarcode = async (req, res) => {
  try {
    const { barcodeId } = req.params;

    console.log('🔍 Searching for product with barcode:', barcodeId);

    // Search in both scanned and generated barcodes (scanned takes priority)
    const product = await Product.findOne({
      $and: [
        { isAvailable: true },
        {
          $or: [
            { scannedBarcodeId: barcodeId },
            { barcodeId: barcodeId }
          ]
        }
      ]
    }).populate('category', 'name');

    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'No product found with this barcode'
      });
    }

    // Determine barcode type
    const barcodeType = product.scannedBarcodeId === barcodeId ? 'scanned' : 'generated';

    // Add enhanced barcode info
    const productWithBarcodeInfo = {
      ...product.toObject(),
      discountedPrice: product.price - (product.price * (product.discount || 0) / 100),
      hasGeneratedBarcode: !!product.barcodeId,
      hasScannedBarcode: !!product.scannedBarcodeId,
      activeBarcodeId: barcodeId,
      barcodeType: barcodeType
    };

    console.log('✅ Product found:', product.name, 'Barcode type:', barcodeType);

    res.status(200).json({
      success: true,
      product: productWithBarcodeInfo,
      barcodeType: barcodeType,
      message: `Product found (${barcodeType} barcode)`
    });

  } catch (error) {
    console.error('Get Product by Barcode Error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

// @desc    Scan barcode and get product info (for scanning apps)
// @route   POST /api/catalog/products/scan
// @access  Public
export const scanBarcode = async (req, res) => {
  try {
    const { barcodeId } = req.body;

    if (!barcodeId) {
      return res.status(400).json({
        success: false,
        message: 'Barcode ID is required'
      });
    }

    console.log('📱 Mobile scan for barcode:', barcodeId);

    // Search for product with this barcode
    const product = await Product.findOne({
      $and: [
        { isAvailable: true },
        {
          $or: [
            { scannedBarcodeId: barcodeId },
            { barcodeId: barcodeId }
          ]
        }
      ]
    }).populate('category', 'name');

    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'No product found with this barcode',
        barcodeId: barcodeId
      });
    }

    // Determine barcode type
    const barcodeType = product.scannedBarcodeId === barcodeId ? 'scanned' : 'generated';

    const productWithBarcodeInfo = {
      ...product.toObject(),
      discountedPrice: product.price - (product.price * (product.discount || 0) / 100),
      hasGeneratedBarcode: !!product.barcodeId,
      hasScannedBarcode: !!product.scannedBarcodeId,
      activeBarcodeId: barcodeId,
      barcodeType: barcodeType
    };

    res.status(200).json({
      success: true,
      message: `Barcode scan successful (${barcodeType} barcode)`,
      product: productWithBarcodeInfo,
      barcodeType: barcodeType,
      barcodeId: barcodeId
    });

  } catch (error) {
    console.error('Barcode Scan Error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
};

// @desc    Get product barcode info
// @route   GET /api/catalog/products/:id/barcode-info
// @access  Public
export const getProductBarcodeInfo = async (req, res) => {
  try {
    const { id } = req.params;

    const product = await Product.findById(id)
      .select('barcodeId barcodeUrl scannedBarcodeId name category')
      .populate('category', 'name');

    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Product not found'
      });
    }

    const barcodeInfo = {
      generated: product.barcodeId ? {
        id: product.barcodeId,
        url: product.barcodeUrl,
        exists: true
      } : { exists: false },
      scanned: product.scannedBarcodeId ? {
        id: product.scannedBarcodeId,
        exists: true
      } : { exists: false },
      activeBarcode: product.scannedBarcodeId || product.barcodeId,
      priority: product.scannedBarcodeId ? 'scanned' : (product.barcodeId ? 'generated' : 'none'),
      hasAnyBarcode: !!(product.scannedBarcodeId || product.barcodeId)
    };

    res.status(200).json({
      success: true,
      productName: product.name,
      productId: product._id,
      category: product.category,
      barcodeInfo: barcodeInfo
    });

  } catch (error) {
    console.error('Get Barcode Info Error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

// @desc    Update product barcode (legacy - for backward compatibility)
// @route   PUT /api/catalog/products/:id/barcode
// @access  Private (Admin)
export const updateProductBarcode = async (req, res) => {
  try {
    const { id } = req.params;
    const { barcodeId } = req.body;

    // 1️⃣ Validate barcode ID
    if (!barcodeId) {
      return res.status(400).json({
        success: false,
        message: 'Barcode ID is required'
      });
    }

    // 2️⃣ Find product
    const product = await Product.findById(id);
    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Product not found'
      });
    }

    // 3️⃣ Check if new barcode is already assigned to another product
    const existingProductWithBarcode = await Product.findOne({
      $or: [
        { scannedBarcodeId: barcodeId },
        { barcodeId: barcodeId }
      ],
      _id: { $ne: id }
    });

    if (existingProductWithBarcode) {
      return res.status(400).json({
        success: false,
        message: 'Barcode already assigned to another product',
        existingProduct: {
          id: existingProductWithBarcode._id,
          name: existingProductWithBarcode.name
        }
      });
    }

    // 4️⃣ Update barcode (assign as scanned barcode for legacy support)
    const oldBarcode = product.scannedBarcodeId || product.barcodeId;
    product.scannedBarcodeId = barcodeId;
    await product.save();

    const updatedProduct = await Product.findById(id)
      .populate('category', 'name');

    const productWithBarcodeInfo = {
      ...updatedProduct.toObject(),
      hasGeneratedBarcode: !!updatedProduct.barcodeId,
      hasScannedBarcode: true,
      activeBarcodeId: barcodeId,
      barcodeType: 'scanned'
    };

    res.status(200).json({
      success: true,
      message: 'Barcode updated successfully',
      oldBarcode,
      newBarcode: barcodeId,
      product: productWithBarcodeInfo
    });

  } catch (error) {
    console.error('Barcode Update Error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during barcode update',
      error: error.message
    });
  }
};

// @desc    Remove barcode from product (legacy - for backward compatibility)
// @route   DELETE /api/catalog/products/:id/barcode
// @access  Private (Admin)
export const removeProductBarcode = async (req, res) => {
  try {
    const { id } = req.params;

    // 1️⃣ Find product
    const product = await Product.findById(id);
    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Product not found'
      });
    }

    // 2️⃣ Check if product has any barcode
    if (!product.scannedBarcodeId && !product.barcodeId) {
      return res.status(400).json({
        success: false,
        message: 'Product does not have any barcode assigned'
      });
    }

    // 3️⃣ Remove barcodes (remove both for legacy support)
    const removedScannedBarcode = product.scannedBarcodeId;
    const removedGeneratedBarcode = product.barcodeId;
    
    product.scannedBarcodeId = null;
    product.barcodeId = null;
    
    // Also delete generated barcode image if exists
    if (product.barcodeUrl) {
      try {
        const publicId = product.barcodeUrl.split('/').pop().split('.')[0];
        const fullPublicId = `dairy9/products/barcode/${publicId}`;
        await deleteFromCloudinary(fullPublicId);
      } catch (deleteError) {
        console.error('Error deleting barcode image:', deleteError);
      }
      product.barcodeUrl = null;
    }
    
    await product.save();

    const updatedProduct = await Product.findById(id)
      .populate('category', 'name');

    const productWithBarcodeInfo = {
      ...updatedProduct.toObject(),
      hasGeneratedBarcode: false,
      hasScannedBarcode: false,
      activeBarcodeId: null,
      barcodeType: 'none'
    };

    res.status(200).json({
      success: true,
      message: 'All barcodes removed successfully',
      removedBarcodes: {
        scanned: removedScannedBarcode,
        generated: removedGeneratedBarcode
      },
      product: productWithBarcodeInfo
    });

  } catch (error) {
    console.error('Barcode Removal Error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during barcode removal',
      error: error.message
    });
  }
};

// @desc    Get products with barcode status
// @route   GET /api/catalog/products/barcode/status
// @access  Private (Admin)
export const getProductsBarcodeStatus = async (req, res) => {
  try {
    const { status, page = 1, limit = 20 } = req.query;

    let filter = { isAvailable: true };

    // Filter by barcode status
    switch (status) {
      case 'with-barcode':
        filter.$or = [
          { scannedBarcodeId: { $exists: true, $ne: null } },
          { barcodeId: { $exists: true, $ne: null } }
        ];
        break;
      case 'scanned-only':
        filter.scannedBarcodeId = { $exists: true, $ne: null };
        break;
      case 'generated-only':
        filter.barcodeId = { $exists: true, $ne: null };
        break;
      case 'without-barcode':
        filter.scannedBarcodeId = null;
        filter.barcodeId = null;
        break;
      default:
        // No filter - return all
        break;
    }

    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;

    const products = await Product.find(filter)
      .populate('category', 'name')
      .sort({ name: 1 })
      .skip(skip)
      .limit(limitNum)
      .lean();

    const productsWithBarcodeInfo = products.map(product => ({
      ...product,
      discountedPrice: product.price - (product.price * (product.discount || 0) / 100),
      hasGeneratedBarcode: !!product.barcodeId,
      hasScannedBarcode: !!product.scannedBarcodeId,
      activeBarcodeId: product.scannedBarcodeId || product.barcodeId,
      barcodeType: product.scannedBarcodeId ? 'scanned' : (product.barcodeId ? 'generated' : 'none')
    }));

    const total = await Product.countDocuments(filter);
    const totalPages = Math.ceil(total / limitNum);

    // Get barcode statistics
    const totalProducts = await Product.countDocuments({ isAvailable: true });
    const withScannedBarcode = await Product.countDocuments({
      isAvailable: true,
      scannedBarcodeId: { $exists: true, $ne: null }
    });
    const withGeneratedBarcode = await Product.countDocuments({
      isAvailable: true,
      barcodeId: { $exists: true, $ne: null }
    });
    const withAnyBarcode = await Product.countDocuments({
      isAvailable: true,
      $or: [
        { scannedBarcodeId: { $exists: true, $ne: null } },
        { barcodeId: { $exists: true, $ne: null } }
      ]
    });
    const withoutBarcode = totalProducts - withAnyBarcode;

    res.status(200).json({
      success: true,
      products: productsWithBarcodeInfo,
      statistics: {
        totalProducts,
        withScannedBarcode,
        withGeneratedBarcode,
        withAnyBarcode,
        withoutBarcode
      },
      pagination: {
        currentPage: pageNum,
        totalPages,
        totalProducts: total,
        hasNext: pageNum < totalPages,
        hasPrev: pageNum > 1
      }
    });

  } catch (error) {
    console.error('Get Products Barcode Status Error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

// ──────────────────────────────────────────────────────────────
// BARCODE SCANNING FOR PRODUCT CREATION
// ──────────────────────────────────────────────────────────────

// @desc    Scan barcode for product data (ENHANCED WITH PROPER BARCODE ASSIGNMENT)
// @route   POST /api/catalog/products/scan-barcode
// @access  Private (Admin)
export const scanBarcodeForProductData = async (req, res) => {
  try {
    const { barcode } = req.body;

    console.log('=== ENHANCED BARCODE SCAN FOR PRODUCT DATA ===');
    console.log('📦 Scanning barcode:', barcode);

    // 1️⃣ Validate barcode
    if (!barcode || typeof barcode !== 'string' || barcode.trim() === '') {
      return res.status(400).json({
        success: false,
        message: 'Barcode is required',
        errorType: 'INVALID_BARCODE'
      });
    }

    const cleanBarcode = barcode.trim();

    // 2️⃣ Check if barcode is already assigned to any product
    const { isUnique, existingProduct } = await checkBarcodeUniqueness(cleanBarcode);

    if (!isUnique && existingProduct) {
      console.log('✅ Found existing product with barcode:', existingProduct.name);
      return res.status(200).json({
        success: true,
        message: 'Barcode already assigned to existing product',
        productExists: true,
        existingProduct: {
          _id: existingProduct._id,
          name: existingProduct.name,
          price: existingProduct.price,
          category: existingProduct.category,
          image: existingProduct.image,
          barcodeType: existingProduct.scannedBarcodeId === cleanBarcode ? 'scanned' : 'generated',
          scannedBarcodeId: existingProduct.scannedBarcodeId,
          barcodeId: existingProduct.barcodeId
        },
        action: 'EDIT_EXISTING',
        scannedBarcode: cleanBarcode
      });
    }

    // 3️⃣ Fetch all categories
    const allCategories = await Category.find({ isActive: true }).select('name _id');

    // 4️⃣ Fetch from OpenFoodFacts
    let openFoodFactsData = null;
    let downloadedImages = [];
    
    try {
      console.log('🔍 Fetching from OpenFoodFacts...');
      openFoodFactsData = await openFoodFactsService.getProductByBarcode(cleanBarcode);
      
      // Download images immediately during scan
      if (openFoodFactsData?.found && openFoodFactsData.images.length > 0) {
        console.log('📸 Downloading product images immediately...');
        downloadedImages = await openFoodFactsService.downloadAndUploadImages(
          openFoodFactsData.images.slice(0, 3)
        );
        console.log(`✅ Downloaded ${downloadedImages.length} images to Cloudinary`);
      }

    } catch (apiError) {
      console.warn('⚠️ OpenFoodFacts API error:', apiError.message);
      openFoodFactsData = { found: false };
    }

    // 5️⃣ Prepare suggested data
    let suggestedData = {
      name: '',
      description: '',
      price: 0,
      category: '',
      unit: 'piece',
      unitSize: '1',
      stock: 0,
      milkType: 'Cow',
      nutritionalInfo: {},
      tags: '',
      discount: 0,
      isFeatured: false,
      isAvailable: true,
      scannedBarcodeId: cleanBarcode
    };

    const autoFilledFields = {
      name: false,
      description: false,
      category: false,
      unit: false,
      unitSize: false,
      milkType: false,
      tags: false,
      nutritionalInfo: false,
      images: downloadedImages.length > 0
    };

    // 6️⃣ Fill data from OpenFoodFacts if available
    if (openFoodFactsData?.found) {
      const { unit: extractedUnit, unitSize: extractedUnitSize } = 
        openFoodFactsService.extractUnitAndSize(openFoodFactsData.quantity);
      
      const extractedMilkType = openFoodFactsService.extractMilkType(openFoodFactsData.rawData);
      
      let matchedCategoryId = null;
      if (openFoodFactsData.categories && openFoodFactsData.categories.length > 0) {
        matchedCategoryId = openFoodFactsService.findMatchingCategory(
          openFoodFactsData.categories, 
          allCategories
        );
      }

      const autoTags = [];
      if (openFoodFactsData.brand) autoTags.push(openFoodFactsData.brand);
      if (openFoodFactsData.labels) autoTags.push(...openFoodFactsData.labels.slice(0, 3));
      if (openFoodFactsData.categories) autoTags.push(...openFoodFactsData.categories.slice(0, 2));

      suggestedData = {
        ...suggestedData,
        name: openFoodFactsData.name || `Product ${cleanBarcode}`,
        description: openFoodFactsData.description || '',
        unit: extractedUnit,
        unitSize: extractedUnitSize,
        milkType: extractedMilkType,
        category: matchedCategoryId,
        nutritionalInfo: openFoodFactsData.nutritionalInfo || {},
        tags: autoTags.join(', ')
      };

      autoFilledFields.name = !!openFoodFactsData.name;
      autoFilledFields.description = !!openFoodFactsData.description;
      autoFilledFields.category = !!matchedCategoryId;
      autoFilledFields.unit = true;
      autoFilledFields.unitSize = true;
      autoFilledFields.milkType = true;
      autoFilledFields.tags = autoTags.length > 0;
      autoFilledFields.nutritionalInfo = !!(openFoodFactsData.nutritionalInfo && 
        Object.keys(openFoodFactsData.nutritionalInfo).length > 0);
    } else {
      suggestedData.name = `Product ${cleanBarcode}`;
      autoFilledFields.name = true;
    }

    // 7️⃣ Determine missing fields
    const missingRequiredFields = {
      name: !suggestedData.name.trim(),
      price: suggestedData.price === 0,
      category: !suggestedData.category,
      unit: !suggestedData.unit
    };

    // 8️⃣ Return response with scanned barcode
    const response = {
      success: true,
      message: openFoodFactsData?.found 
        ? 'Product data found! Review and complete the information below.' 
        : 'No product data found online. Please fill in the product details manually.',
      dataSource: openFoodFactsData?.found ? 'openfoodfacts' : 'manual',
      scannedBarcode: cleanBarcode,
      openFoodFactsData: {
        found: openFoodFactsData?.found || false,
        barcode: cleanBarcode,
        name: suggestedData.name,
        description: suggestedData.description,
        brand: openFoodFactsData?.brand || '',
        categories: openFoodFactsData?.categories || [],
        quantity: openFoodFactsData?.quantity || '',
        unit: suggestedData.unit,
        unitSize: suggestedData.unitSize,
        nutritionalInfo: suggestedData.nutritionalInfo
      },
      suggestedData: suggestedData,
      imageInfo: {
        totalDownloaded: downloadedImages.length,
        images: downloadedImages
      },
      autoFilledFields,
      missingRequiredFields,
      requiresConfirmation: true,
      availableCategories: allCategories.map(cat => ({ _id: cat._id, name: cat.name }))
    };

    console.log('✅ Returning product data with barcode:', cleanBarcode);
    res.status(200).json(response);

  } catch (error) {
    console.error('❌ Barcode Scan Error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during barcode scanning',
      error: error.message,
      errorType: 'SERVER_ERROR'
    });
  }
};

// @desc    Create product with scanned barcode data (FIXED BARCODE ASSIGNMENT)
// @route   POST /api/catalog/products/create-from-scan
// @access  Private (Admin)
export const createProductFromScanData = async (req, res) => {
  try {
    const {
      name,
      description,
      price,
      category,
      unit,
      unitSize,
      stock,
      milkType,
      nutritionalInfo,
      tags,
      discount,
      isFeatured,
      scannedBarcodeId,
      images
    } = req.body;

    console.log('=== CREATING PRODUCT FROM SCAN DATA ===');
    console.log('📦 Product:', name);
    console.log('📦 Barcode to assign:', scannedBarcodeId);

    // 1️⃣ Validate required fields
    if (!name || !name.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Product name is required',
        field: 'name'
      });
    }

    if (!price || isNaN(price) || Number(price) <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Valid price is required',
        field: 'price'
      });
    }

    if (!category) {
      return res.status(400).json({
        success: false,
        message: 'Category is required',
        field: 'category'
      });
    }

    if (!unit) {
      return res.status(400).json({
        success: false,
        message: 'Unit is required',
        field: 'unit'
      });
    }

    // 2️⃣ Check if barcode is already used using helper function
    if (scannedBarcodeId) {
      const { isUnique, existingProduct } = await checkBarcodeUniqueness(scannedBarcodeId);
      
      if (!isUnique) {
        return res.status(400).json({
          success: false,
          message: 'This barcode is already assigned to another product',
          existingProduct: {
            id: existingProduct._id,
            name: existingProduct.name
          }
        });
      }
    }

    // 3️⃣ Validate category exists
    const categoryExists = await Category.findById(category);
    if (!categoryExists) {
      return res.status(400).json({
        success: false,
        message: 'Selected category does not exist',
        field: 'category'
      });
    }

    // 4️⃣ Check for duplicate product name
    const existingProduct = await Product.findOne({
      name: { $regex: new RegExp(`^${name.trim()}$`, 'i') },
      isAvailable: true
    });

    if (existingProduct) {
      return res.status(400).json({
        success: false,
        message: 'A product with this name already exists',
        field: 'name'
      });
    }

    // 5️⃣ Handle images
    let mainImageUrl = '/images/default-product.jpg';
    let additionalImages = [];

    console.log('🖼️ Processing images...');
    
    if (images && images.length > 0) {
      console.log('📸 Images available:', images.length);
      
      // Use first image as main image
      const firstImage = images[0];
      if (firstImage && firstImage.url) {
        mainImageUrl = firstImage.url;
        console.log('✅ Main image set:', mainImageUrl);
      }
      
      // Remaining as additional images
      if (images.length > 1) {
        additionalImages = images.slice(1).map(img => ({
          url: img.url || img,
          publicId: img.publicId || null
        }));
        console.log('✅ Additional images:', additionalImages.length);
      }
    } else {
      console.log('⚠️ No images provided, using default');
    }

    // 6️⃣ Format tags
    const formattedTags = typeof tags === 'string' 
      ? tags.split(',').map(tag => tag.trim()).filter(tag => tag)
      : (Array.isArray(tags) ? tags : []);

    // 7️⃣ Format nutritional info
    const formattedNutritionalInfo = typeof nutritionalInfo === 'string' 
      ? JSON.parse(nutritionalInfo) 
      : (nutritionalInfo || {});

    // 8️⃣ Create product with scanned barcode
    console.log('🚀 Creating product in database with barcode:', scannedBarcodeId);
    
    const product = new Product({
      name: name.trim(),
      description: description?.trim() || '',
      price: Number(price),
      category,
      unit,
      unitSize: unitSize || '1',
      stock: Number(stock) || 0,
      milkType: milkType || 'Cow',
      image: mainImageUrl,
      imagePublicId: null,
      images: additionalImages,
      nutritionalInfo: formattedNutritionalInfo,
      tags: formattedTags,
      discount: Number(discount) || 0,
      isFeatured: Boolean(isFeatured),
      isAvailable: true,
      scannedBarcodeId: scannedBarcodeId?.trim() || null
    });

    await product.save();
    console.log('✅ Product saved to database with barcode assignment');

    await product.populate('category', 'name');
    console.log('✅ Product populated with category');

    // 9️⃣ Return created product
    const createdProduct = await Product.findById(product._id)
      .populate('category', 'name');

    console.log('🎉 Product creation completed successfully with barcode:', scannedBarcodeId);

    res.status(201).json({
      success: true,
      message: 'Product created successfully!',
      product: createdProduct,
      barcodeAssigned: !!scannedBarcodeId,
      assignedBarcode: scannedBarcodeId
    });

  } catch (error) {
    console.error('❌ Create Product from Scan Error:', error);
    
    if (error.name === 'ValidationError') {
      const errors = Object.keys(error.errors).map(key => ({
        field: key,
        message: error.errors[key].message
      }));
      
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors
      });
    }

    res.status(500).json({
      success: false,
      message: 'Server error during product creation',
      error: error.message
    });
  }
};

// @desc    Create product from scanned barcode (Legacy endpoint - enhanced)
// @route   POST /api/catalog/products/scan-create
// @access  Private (Admin)
export const createProductFromBarcode = async (req, res) => {
  try {
    const { barcode } = req.body;

    console.log('=== LEGACY BARCODE PRODUCT CREATION ===');
    console.log('📦 Barcode:', barcode);

    // 1️⃣ Validate barcode
    if (!barcode) {
      return res.status(400).json({
        success: false,
        message: 'Barcode is required'
      });
    }

    // 2️⃣ Check if barcode is already assigned
    const { isUnique, existingProduct } = await checkBarcodeUniqueness(barcode);

    if (!isUnique) {
      return res.status(200).json({
        success: true,
        message: 'Barcode already assigned to existing product',
        productExists: true,
        existingProduct: {
          id: existingProduct._id,
          name: existingProduct.name
        }
      });
    }

    // 3️⃣ Return data for frontend confirmation
    const response = {
      success: true,
      message: 'Barcode is available for product creation',
      scannedBarcode: barcode,
      requiresConfirmation: true
    };

    res.status(200).json(response);

  } catch (error) {
    console.error('❌ Create Product from Barcode Error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during barcode scanning',
      error: error.message
    });
  }
};

// @desc    Unified barcode lookup for offline orders
// @route   GET /api/catalog/products/barcode-lookup/:barcodeId
// @access  Public
export const getProductByAnyBarcode = async (req, res) => {
  try {
    const { barcodeId } = req.params;
    
    console.log('🔍 Unified barcode lookup for:', barcodeId);

    // Search by both barcode types
    const product = await Product.findOne({
      $and: [
        { isAvailable: true },
        {
          $or: [
            { scannedBarcodeId: barcodeId },
            { barcodeId: barcodeId },
            { _id: barcodeId }
          ]
        }
      ]
    }).populate('category');

    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Product not found for this barcode',
        barcodeId
      });
    }

    // Return product in the format expected by offline orders
    res.json({
      success: true,
      product: {
        _id: product._id,
        name: product.name,
        description: product.description,
        price: product.price,
        discountedPrice: product.discount > 0 
          ? product.price * (1 - product.discount / 100)
          : product.price,
        discount: product.discount || 0,
        image: product.image,
        category: product.category,
        unit: product.unit,
        unitSize: product.unitSize,
        milkType: product.milkType,
        nutritionalInfo: product.nutritionalInfo,
        tags: product.tags,
        isFeatured: product.isFeatured,
        isAvailable: product.isAvailable,
        stock: product.stock || 0,
        barcodeId: product.barcodeId,
        scannedBarcodeId: product.scannedBarcodeId,
        createdAt: product.createdAt,
        updatedAt: product.updatedAt
      }
    });

  } catch (error) {
    console.error('❌ Unified barcode lookup error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to lookup product by barcode',
      error: error.message
    });
  }
};

// @desc    Simple barcode search
// @route   GET /api/catalog/products/search-barcode/:barcodeId
// @access  Public
export const searchProductByBarcode = async (req, res) => {
  try {
    const { barcodeId } = req.params;
    
    console.log('🔍 Searching product by barcode:', barcodeId);

    // Search in both barcode fields
    const product = await Product.findOne({
      $or: [
        { barcodeId: barcodeId },
        { scannedBarcodeId: barcodeId },
        { _id: barcodeId }
      ]
    }).populate('category');

    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Product not found',
        barcodeId
      });
    }

    res.json({
      success: true,
      product
    });

  } catch (error) {
    console.error('❌ Barcode search error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to search product by barcode',
      error: error.message
    });
  }
};

// @desc    Download and process images from URLs
// @route   POST /api/catalog/products/download-images
// @access  Private (Admin)
export const downloadAndProcessImages = async (req, res) => {
  try {
    const { imageUrls, barcode } = req.body;

    console.log('🖼️ Downloading images for barcode:', barcode);
    console.log('📸 Original Image URLs:', imageUrls?.length || 0);

    if (!imageUrls || !Array.isArray(imageUrls) || imageUrls.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No image URLs provided'
      });
    }

    const downloadedImages = [];

    // Remove duplicate URLs before processing
    const uniqueImageUrls = [...new Set(imageUrls.map(img => 
      typeof img === 'string' ? img : img.url
    ))];
    
    console.log('🎯 Unique Image URLs:', uniqueImageUrls.length);

    // Process first 3 unique images maximum
    const imagesToProcess = uniqueImageUrls.slice(0, 3);
    
    for (let i = 0; i < imagesToProcess.length; i++) {
      const imageUrl = imagesToProcess[i];
      try {
        console.log(`📥 Downloading image ${i + 1}:`, imageUrl);
        
        // Download image
        const response = await fetch(imageUrl);
        if (!response.ok) {
          console.warn(`⚠️ Failed to download image ${i + 1}`);
          continue;
        }

        // Convert to buffer
        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        // Upload to Cloudinary
        const uploadResult = await uploadToCloudinary(
          buffer, 
          `dairy9/products/scanned/${barcode}`
        );

        // Preserve image type information
        const originalImage = imageUrls.find(img => 
          (typeof img === 'string' ? img : img.url) === imageUrl
        );
        
        downloadedImages.push({
          url: uploadResult.secure_url,
          publicId: uploadResult.public_id,
          originalUrl: imageUrl,
          type: typeof originalImage === 'object' ? originalImage.type : 'unknown',
          size: buffer.length,
          index: i
        });

        console.log(`✅ Image ${i + 1} uploaded to Cloudinary, type:`, downloadedImages[i].type);

      } catch (error) {
        console.error(`❌ Error processing image ${i + 1}:`, error.message);
      }
    }

    console.log(`🎉 Successfully processed ${downloadedImages.length} unique images`);

    res.status(200).json({
      success: true,
      message: `Downloaded and processed ${downloadedImages.length} images`,
      images: downloadedImages,
      totalProcessed: downloadedImages.length
    });

  } catch (error) {
    console.error('❌ Image Download Error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to download and process images',
      error: error.message
    });
  }
};