// validation/inventory.validation.js
import { body } from 'express-validator';

export const validateAddProduct = [
  body('productId')
    .notEmpty()
    .withMessage('Product ID is required')
    .isMongoId()
    .withMessage('Valid Product ID is required'),
  
  body('currentStock')
    .optional()
    .isInt({ min: 0 })
    .withMessage('Current stock must be a non-negative integer'),
  
  body('count')
    .optional()
    .isInt({ min: 0 })
    .withMessage('Count must be a non-negative integer'),
  
  body('committedStock')
    .optional()
    .isInt({ min: 0 })
    .withMessage('Committed stock must be a non-negative integer'),
  
  // ✅ Make sellingPrice optional, not required
  body('sellingPrice')
    .optional() // This makes it optional
    .isFloat({ min: 0 })
    .withMessage('Selling price must be a non-negative number'),
  
  body('costPrice')
    .optional()
    .isFloat({ min: 0 })
    .withMessage('Cost price must be a non-negative number'),
  
  body('minStockLevel')
    .optional()
    .isInt({ min: 0 })
    .withMessage('Minimum stock level must be a non-negative integer'),
  
  body('maxStockLevel')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Maximum stock level must be a positive integer'),
  
  body('reorderQuantity')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Reorder quantity must be a positive integer'),
  
  body('stockUpdateReason')
    .optional()
    .isString()
    .withMessage('Stock update reason must be a string')
    .isLength({ max: 500 })
    .withMessage('Stock update reason must be less than 500 characters'),
  
  body('isActive')
    .optional()
    .isBoolean()
    .withMessage('isActive must be a boolean value')
];