// C:\Users\Krishna\OneDrive\Desktop\backend-dairy9\Dairy9-Backend\controllers\product.controller.js

import Product from '../models/product.model.js';
import { v2 as cloudinary } from 'cloudinary';
import Category from '../models/category.model.js';
import { 
  uploadToCloudinary, 
  uploadMultipleToCloudinary, 
  deleteFromCloudinary 
} from '../utils/cloudinaryUpload.js';
import { generateBarcode, addTextToBarcode } from '../utils/barcodeGen.utils.js';
import streamifier from 'streamifier';
import { testCloudinaryConnection } from '../utils/cloudinaryUpload.js';

// @desc    Create new product (with optional barcode generation)
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
      generateBarcode: shouldGenerateBarcode = false
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
      name: { $regex: new RegExp(`^${name}$`, 'i') } 
    });
    if (existingProduct) {
      return res.status(400).json({
        success: false,
        message: 'Product with this name already exists'
      });
    }

    // 4️⃣ Upload main image
    let imageUrl = '/images/default-product.jpg';
    let imagePublicId = null;
    if (req.file) {
      try {
        const uploadResult = await uploadToCloudinary(req.file.buffer, 'dairy9/products');
        imageUrl = uploadResult.secure_url;
        imagePublicId = uploadResult.public_id;
      } catch (uploadError) {
        console.error('Image upload failed, using default:', uploadError.message);
      }
    }

    // 5️⃣ Create product
    const product = new Product({
      name,
      description,
      price,
      category,
      unit,
      unitSize,
      stock: stock || 0,
      milkType: milkType || 'Cow',
      image: imageUrl,
      imagePublicId,
      images: [],
      nutritionalInfo: nutritionalInfo || {},
      tags: tags || [],
      discount: discount || 0,
      isFeatured: isFeatured || false,
      // Initialize barcode fields
      barcodeId: null,
      barcodeUrl: null,
      scannedBarcodeId: null
    });

    await product.save();
    await product.populate('category', 'name');

    // 6️⃣ Generate barcode only if requested
    if (shouldGenerateBarcode === 'true') {
      try {
        await generateAndAssignBarcode(product);
      } catch (barcodeError) {
        console.error('Barcode generation failed:', barcodeError.message);
        // Continue without barcode
      }
    }

    // 7️⃣ Fetch final product
    const finalProduct = await Product.findById(product._id).populate('category', 'name');

    res.status(201).json({
      success: true,
      message: finalProduct.barcodeUrl
        ? '✅ Product created successfully with barcode'
        : '✅ Product created successfully',
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
      // Enhanced barcode information
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

    // 3️⃣ Check if scanned barcode is already assigned to another product
    const existingProductWithScannedBarcode = await Product.findOne({
      scannedBarcodeId: scannedBarcodeId,
      _id: { $ne: id }
    });

    if (existingProductWithScannedBarcode) {
      return res.status(400).json({
        success: false,
        message: 'This scanned barcode is already assigned to another product',
        existingProduct: {
          id: existingProductWithScannedBarcode._id,
          name: existingProductWithScannedBarcode.name
        }
      });
    }

    // 4️⃣ Check if this scanned barcode matches any generated barcode in system
    const productWithGeneratedBarcode = await Product.findOne({
      barcodeId: scannedBarcodeId,
      _id: { $ne: id }
    });

    if (productWithGeneratedBarcode) {
      return res.status(400).json({
        success: false,
        message: 'This barcode matches a generated barcode of another product',
        conflictingProduct: {
          id: productWithGeneratedBarcode._id,
          name: productWithGeneratedBarcode.name
        }
      });
    }

    // 5️⃣ Assign scanned barcode (this takes priority over generated barcode)
    const oldScannedBarcode = product.scannedBarcodeId;
    product.scannedBarcodeId = scannedBarcodeId;
    await product.save();

    console.log('✅ Scanned barcode assigned successfully');

    // 6️⃣ Return updated product with enhanced barcode info
    const updatedProduct = await Product.findById(id)
      .populate('category', 'name');

    const productWithBarcodeInfo = {
      ...updatedProduct.toObject(),
      hasGeneratedBarcode: !!updatedProduct.barcodeId,
      hasScannedBarcode: true,
      activeBarcodeId: scannedBarcodeId,
      barcodeType: 'scanned'
    };

    res.status(200).json({
      success: true,
      message: 'Scanned barcode assigned successfully',
      barcodeType: 'scanned',
      scannedBarcodeId: scannedBarcodeId,
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
      activeBarcodeId: updatedProduct.barcodeId, // Fall back to generated barcode
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
      // Continue with deletion from database even if Cloudinary delete fails
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
      activeBarcodeId: updatedProduct.scannedBarcodeId, // Fall back to scanned barcode if exists
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
            { scannedBarcodeId: barcodeId }, // Scanned barcodes first
            { barcodeId: barcodeId }         // Generated barcodes second
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