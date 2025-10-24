// C:\Users\Krishna\OneDrive\Desktop\backend-dairy9\Dairy9-Backend\controllers\category.controller.js

import Category from '../models/category.model.js';
import Product from '../models/product.model.js';
import { uploadToCloudinary, deleteFromCloudinary } from '../utils/cloudinaryUpload.js';

// Get all active categories
export const getCategories = async (req, res) => {
  try {
    const categories = await Category.find({ isActive: true })
      .sort({ displayOrder: 1 });
    
    res.status(200).json(categories);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// Get products by category
export const getProductsByCategory = async (req, res) => {
  try {
    const { categoryId } = req.params;
    
    const products = await Product.find({ 
      category: categoryId,
      isAvailable: true 
    }).populate('category', 'name');
    
    res.status(200).json(products);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// Search products
export const searchProducts = async (req, res) => {
  try {
    const { query } = req.query;
    
    const products = await Product.find({
      $and: [
        { isAvailable: true },
        {
          $or: [
            { name: { $regex: query, $options: 'i' } },
            { description: { $regex: query, $options: 'i' } },
            { tags: { $in: [new RegExp(query, 'i')] } }
          ]
        }
      ]
    }).populate('category', 'name');
    
    res.status(200).json(products);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// Get all products with filters
export const getAllProducts = async (req, res) => {
  try {
    const { category, milkType, minPrice, maxPrice, sortBy } = req.query;
    
    let filter = { isAvailable: true };
    
    if (category) filter.category = category;
    if (milkType && milkType !== 'all') filter.milkType = milkType;
    if (minPrice || maxPrice) {
      filter.price = {};
      if (minPrice) filter.price.$gte = Number(minPrice);
      if (maxPrice) filter.price.$lte = Number(maxPrice);
    }
    
    let sortOptions = {};
    switch(sortBy) {
      case 'price-low': sortOptions = { price: 1 }; break;
      case 'price-high': sortOptions = { price: -1 }; break;
      case 'name': sortOptions = { name: 1 }; break;
      default: sortOptions = { createdAt: -1 };
    }
    
    const products = await Product.find(filter)
      .populate('category', 'name')
      .sort(sortOptions);
    
    res.status(200).json(products);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// Admin: Create category
export const createCategory = async (req, res) => {
  try {
    const { name, description, displayOrder } = req.body;
    
    let imageUrl = '/images/default-category.jpg';
    let imagePublicId = null;

    // Upload image if provided
    if (req.file) {
      try {
        const uploadResult = await uploadToCloudinary(req.file.buffer, 'dairy9/categories');
        imageUrl = uploadResult.secure_url;
        imagePublicId = uploadResult.public_id;
      } catch (uploadError) {
        return res.status(400).json({
          success: false,
          message: 'Error uploading image',
          error: uploadError.message
        });
      }
    }
    
    const category = new Category({
      name,
      description,
      image: imageUrl,
      imagePublicId,
      displayOrder
    });
    
    await category.save();
    res.status(201).json({ 
      success: true,
      message: 'Category created successfully', 
      category 
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({ 
        success: false,
        message: 'Category name already exists' 
      });
    }
    res.status(500).json({ 
      success: false,
      message: 'Server error', 
      error: error.message 
    });
  }
};

// Admin: Update category
export const updateCategory = async (req, res) => {
  try {
    const { name, description, displayOrder } = req.body;
    const category = await Category.findById(req.params.id);
    
    if (!category) {
      return res.status(404).json({
        success: false,
        message: 'Category not found'
      });
    }

    // Handle image upload if new image is provided
    if (req.file) {
      try {
        // Delete old image from Cloudinary if exists
        if (category.imagePublicId) {
          await deleteFromCloudinary(category.imagePublicId);
        }

        // Upload new image
        const uploadResult = await uploadToCloudinary(req.file.buffer, 'dairy9/categories');
        category.image = uploadResult.secure_url;
        category.imagePublicId = uploadResult.public_id;
      } catch (uploadError) {
        return res.status(400).json({
          success: false,
          message: 'Error uploading image',
          error: uploadError.message
        });
      }
    }

    // Update other fields
    if (name) category.name = name;
    if (description !== undefined) category.description = description;
    if (displayOrder !== undefined) category.displayOrder = displayOrder;

    await category.save();

    res.json({
      success: true,
      message: 'Category updated successfully',
      category
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: 'Category name already exists'
      });
    }
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

// Admin: Delete category
export const deleteCategory = async (req, res) => {
  try {
    const category = await Category.findById(req.params.id);
    
    if (!category) {
      return res.status(404).json({
        success: false,
        message: 'Category not found'
      });
    }

    // Delete image from Cloudinary if exists
    if (category.imagePublicId) {
      try {
        await deleteFromCloudinary(category.imagePublicId);
      } catch (deleteError) {
        console.error('Error deleting image from Cloudinary:', deleteError);
      }
    }

    // Soft delete - set isActive to false
    category.isActive = false;
    await category.save();

    res.json({
      success: true,
      message: 'Category deleted successfully'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};