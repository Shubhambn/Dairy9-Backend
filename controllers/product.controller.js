// C:\Users\Krishna\OneDrive\Desktop\backend-dairy9\Dairy9-Backend\controllers\product.controller.js

import Product from '../models/product.model.js';
import { v2 as cloudinary } from 'cloudinary';
import Category from '../models/category.model.js';
import { 
  uploadToCloudinary, 
  uploadMultipleToCloudinary, 
  deleteFromCloudinary 
} from '../utils/cloudinaryUpload.js';
import { generateQRCode } from '../utils/QrGen.utils.js';
import { addTextToQR } from '../utils/Qrinfo.utils.js'; // 👈 new util
import streamifier from 'streamifier';
import { testCloudinaryConnection } from '../utils/cloudinaryUpload.js';



// @desc    Create new product (with QR + text overlay)
// controllers/product.controller.js
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
      milkType, nutritionalInfo, tags, discount, isFeatured 
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

    // 5️⃣ Create product first to get _id
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
      isFeatured: isFeatured || false
    });

    await product.save();
    await product.populate('category', 'name');

    // 6️⃣ Generate QR code
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

      // Save QR info to product
      product.qrCodeUrl = qrUpload.secure_url;
      product.qrCodeId = qrUpload.public_id;
      await product.save();

    } catch (qrError) {
      console.error('QR code generation/upload failed:', qrError.message);
      // Continue without QR
    }

    // 7️⃣ Fetch final updated product for response
    const finalProduct = await Product.findById(product._id).populate('category', 'name');

    // 8️⃣ Return success
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
      .lean(); // For better performance

    // Add discounted price to each product
    const productsWithDiscount = products.map(product => ({
      ...product,
      discountedPrice: product.price - (product.price * (product.discount || 0) / 100)
    }));

    // Get total count for pagination
    const total = await Product.countDocuments(filter);
    const totalPages = Math.ceil(total / limitNum);

    res.status(200).json({
      success: true,
      products: productsWithDiscount,
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

    // Add discounted price
    const productWithDiscount = {
      ...product.toObject(),
      discountedPrice: product.price - (product.price * (product.discount || 0) / 100)
    };

    res.status(200).json({
      success: true,
      product: productWithDiscount
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

    const productsWithDiscount = products.map(product => ({
      ...product.toObject(),
      discountedPrice: product.price - (product.price * (product.discount || 0) / 100)
    }));

    res.status(200).json({
      success: true,
      products: productsWithDiscount
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

    const productsWithDiscount = products.map(product => ({
      ...product.toObject(),
      discountedPrice: product.price - (product.price * (product.discount || 0) / 100)
    }));

    res.status(200).json({
      success: true,
      products: productsWithDiscount,
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

// 🎯 Generate a QR for an existing product
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




// 🎯 Decode QR — when user scans and sends data
export const scanProductQR = async (req, res) => {
  try {
    const { productId } = req.body; // Data extracted from QR scanner app

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

// @desc    Scan and assign barcode to product
// @route   POST /api/catalog/products/:id/barcode
// @access  Private (Admin)
export const scanAndAssignBarcode = async (req, res) => {
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

    // 3️⃣ Check if barcode is already assigned to another product
    const existingProductWithBarcode = await Product.findOne({
      barcodeId: barcodeId,
      _id: { $ne: id } // Exclude current product
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

    // 4️⃣ Check if product already has a barcode
    if (product.barcodeId) {
      return res.status(400).json({
        success: false,
        message: 'Product already has a barcode assigned',
        currentBarcode: product.barcodeId
      });
    }

    // 5️⃣ Assign barcode to product
    product.barcodeId = barcodeId;
    await product.save();

    // 6️⃣ Populate and return updated product
    const updatedProduct = await Product.findById(id)
      .populate('category', 'name');

    res.status(200).json({
      success: true,
      message: 'Barcode assigned successfully',
      product: updatedProduct
    });

  } catch (error) {
    console.error('Barcode Assignment Error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during barcode assignment',
      error: error.message
    });
  }
};

// @desc    Update product barcode
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
      barcodeId: barcodeId,
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

    // 4️⃣ Update barcode
    const oldBarcode = product.barcodeId;
    product.barcodeId = barcodeId;
    await product.save();

    const updatedProduct = await Product.findById(id)
      .populate('category', 'name');

    res.status(200).json({
      success: true,
      message: 'Barcode updated successfully',
      oldBarcode,
      newBarcode: barcodeId,
      product: updatedProduct
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

// @desc    Remove barcode from product
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

    // 2️⃣ Check if product has a barcode
    if (!product.barcodeId) {
      return res.status(400).json({
        success: false,
        message: 'Product does not have a barcode assigned'
      });
    }

    // 3️⃣ Remove barcode
    const removedBarcode = product.barcodeId;
    product.barcodeId = undefined;
    await product.save();

    const updatedProduct = await Product.findById(id)
      .populate('category', 'name');

    res.status(200).json({
      success: true,
      message: 'Barcode removed successfully',
      removedBarcode,
      product: updatedProduct
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

// @desc    Get product by barcode ID
// @route   GET /api/catalog/products/barcode/:barcodeId
// @access  Public
export const getProductByBarcode = async (req, res) => {
  try {
    const { barcodeId } = req.params;

    const product = await Product.findOne({ 
      barcodeId: barcodeId,
      isAvailable: true 
    }).populate('category', 'name');

    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Product not found for this barcode'
      });
    }

    // Add discounted price
    const productWithDiscount = {
      ...product.toObject(),
      discountedPrice: product.price - (product.price * (product.discount || 0) / 100)
    };

    res.status(200).json({
      success: true,
      product: productWithDiscount
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
// @route   POST /api/catalog/products/scan-barcode
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

    const product = await Product.findOne({ 
      barcodeId: barcodeId,
      isAvailable: true 
    }).populate('category', 'name');

    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'No product found with this barcode'
      });
    }

    // Add discounted price
    const productWithDiscount = {
      ...product.toObject(),
      discountedPrice: product.price - (product.price * (product.discount || 0) / 100)
    };

    res.status(200).json({
      success: true,
      message: 'Barcode scan successful',
      product: productWithDiscount
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