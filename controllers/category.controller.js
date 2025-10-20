// C:\Users\Krishna\OneDrive\Desktop\backend-dairy9\Dairy9-Backend\controllers\category.controller.js

import Category from '../models/category.model.js';
import Product from '../models/product.model.js';

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
    const { name, description, image, displayOrder } = req.body;
    
    const category = new Category({
      name,
      description,
      image,
      displayOrder
    });
    
    await category.save();
    res.status(201).json({ message: 'Category created successfully', category });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({ message: 'Category name already exists' });
    }
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};