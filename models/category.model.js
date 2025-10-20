// C:\Users\Krishna\OneDrive\Desktop\backend-dairy9\Dairy9-Backend\models\category.model.js

import mongoose from 'mongoose';

const categorySchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    unique: true
  },
  description: String,
  image: String,
  isActive: {
    type: Boolean,
    default: true
  },
  displayOrder: {
    type: Number,
    default: 0
  }
}, { timestamps: true });

const Category = mongoose.model('Category', categorySchema);
export default Category;