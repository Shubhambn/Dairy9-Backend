// C:\Users\Krishna\OneDrive\Desktop\backend-dairy9\Dairy9-Backend\controllers\product.controller.js

import Product from '../models/product.model.js';
import Category from '../models/category.model.js';

// @desc    Create new product
// @route   POST /api/catalog/products
// @access  Private (Admin)
export const createProduct = async (req, res) => {
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
      image,
      images,
      nutritionalInfo,
      tags,
      discount,
      isFeatured
    } = req.body;

    // Check if category exists
    const categoryExists = await Category.findById(category);
    if (!categoryExists) {
      return res.status(400).json({ 
        success: false,
        message: 'Category not found' 
      });
    }

    // Check if product with same name already exists
    const existingProduct = await Product.findOne({ 
      name: { $regex: new RegExp(`^${name}$`, 'i') } 
    });
    
    if (existingProduct) {
      return res.status(400).json({
        success: false,
        message: 'Product with this name already exists'
      });
    }

    const product = new Product({
      name,
      description,
      price,
      category,
      unit,
      unitSize,
      stock: stock || 0,
      milkType: milkType || 'Cow',
      image: image || '/images/default-product.jpg',
      images: images || [],
      nutritionalInfo: nutritionalInfo || {},
      tags: tags || [],
      discount: discount || 0,
      isFeatured: isFeatured || false
    });

    await product.save();
    await product.populate('category', 'name');

    res.status(201).json({
      success: true,
      message: 'Product created successfully',
      product
    });
  } catch (error) {
    console.error('Create Product Error:', error);
    res.status(500).json({ 
      success: false,
      message: 'Server error', 
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