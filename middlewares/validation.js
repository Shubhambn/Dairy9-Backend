export const validateBarcode = (req, res, next) => {
  const { barcode } = req.body;
  
  if (!barcode) {
    return res.status(400).json({
      success: false,
      message: 'Barcode is required'
    });
  }

  // Basic barcode validation
  const cleanBarcode = barcode.replace(/\D/g, '');
  if (cleanBarcode.length < 8 || cleanBarcode.length > 18) {
    return res.status(400).json({
      success: false,
      message: 'Invalid barcode format'
    });
  }

  next();
};

export const validateProductData = (req, res, next) => {
  const { name, price, category, unit } = req.body;

  if (!name?.trim()) {
    return res.status(400).json({
      success: false,
      message: 'Product name is required'
    });
  }

  if (!price || isNaN(price) || parseFloat(price) < 0) {
    return res.status(400).json({
      success: false,
      message: 'Valid price is required'
    });
  }

  if (!category) {
    return res.status(400).json({
      success: false,
      message: 'Category is required'
    });
  }

  if (!unit) {
    return res.status(400).json({
      success: false,
      message: 'Unit is required'
    });
  }

  next();
};