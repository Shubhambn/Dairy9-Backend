import dotenv from 'dotenv';
import mongoose from 'mongoose';
import Category from './models/category.model.js';
import Product from './models/product.model.js';

dotenv.config();

const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('MongoDB connected');
  } catch (error) {
    console.error('MongoDB connection error:', error);
    process.exit(1);
  }
};

const seedProducts = async () => {
  try {
    await connectDB();

    // Check if categories exist
    const categories = await Category.find({});
    if (categories.length === 0) {
      console.log('No categories found. Creating default categories...');
      const defaultCategories = [
        { name: 'Milk', description: 'Fresh dairy milk products' },
        { name: 'Butter', description: 'Butter and ghee products' },
        { name: 'Cheese', description: 'Cheese varieties' },
        { name: 'Paneer', description: 'Fresh paneer and cottage cheese' },
        { name: 'Curd', description: 'Yogurt and curd products' },
        { name: 'Ice Cream', description: 'Ice cream and frozen desserts' },
        { name: 'Ghee', description: 'Pure ghee products' },
        { name: 'Cream', description: 'Cream and dairy toppings' }
      ];

      const createdCategories = await Category.insertMany(defaultCategories);
      console.log('Categories created:', createdCategories.length);
    }

    // Get category IDs
    const milkCat = await Category.findOne({ name: 'Milk' });
    const butterCat = await Category.findOne({ name: 'Butter' });
    const cheeseCat = await Category.findOne({ name: 'Cheese' });
    const paneerCat = await Category.findOne({ name: 'Paneer' });
    const curdCat = await Category.findOne({ name: 'Curd' });
    const iceCreamCat = await Category.findOne({ name: 'Ice Cream' });
    const gheeCat = await Category.findOne({ name: 'Ghee' });
    const creamCat = await Category.findOne({ name: 'Cream' });

    const products = [
      {
        name: 'Amul - Butter Salted, 500 gm',
        description: 'Salted butter',
        price: 261,
        category: butterCat._id,
        unit: 'gm',
        unitSize: 500,
        stock: 100,
        image: 'https://images.unsplash.com/photo-1589985270826-4b7bb135bc9d?w=400',
        isAvailable: true,
        milkType: 'Cow',
        isFeatured: true
      },
      {
        name: 'Fresh Cow Milk - Full Cream',
        description: 'Farm fresh full cream cow milk',
        price: 65,
        category: milkCat._id,
        unit: 'liter',
        unitSize: 1,
        stock: 200,
        image: 'https://images.unsplash.com/photo-1563636619-e9143da7973b?w=400',
        isAvailable: true,
        milkType: 'Cow',
        isFeatured: true
      },
      {
        name: 'Amul Fresh Paneer',
        description: 'Fresh cottage cheese',
        price: 90,
        category: paneerCat._id,
        unit: 'gm',
        unitSize: 200,
        stock: 50,
        image: 'https://images.unsplash.com/photo-1631452180519-c014fe946bc7?w=400',
        isAvailable: true,
        milkType: 'Cow',
        isFeatured: true
      },
      {
        name: 'Amul Masti Curd - Pouch',
        description: 'Fresh thick curd',
        price: 30,
        category: curdCat._id,
        unit: 'gm',
        unitSize: 400,
        stock: 150,
        image: 'https://images.unsplash.com/photo-1488477181946-6428a0291777?w=400',
        isAvailable: true,
        milkType: 'Cow',
        isFeatured: false
      },
      {
        name: 'Amul Processed Cheese Slices',
        description: 'Processed cheese slices',
        price: 120,
        category: cheeseCat._id,
        unit: 'gm',
        unitSize: 200,
        stock: 80,
        image: 'https://images.unsplash.com/photo-1486297678162-eb2a19b0a32d?w=400',
        isAvailable: true,
        milkType: 'Cow',
        isFeatured: true
      },
      {
        name: 'Amul Gold Milk - Tetra Pack',
        description: 'Standardized milk',
        price: 58,
        category: milkCat._id,
        unit: 'liter',
        unitSize: 1,
        stock: 300,
        image: 'https://images.unsplash.com/photo-1550583724-b2692b85b150?w=400',
        isAvailable: true,
        milkType: 'Cow',
        isFeatured: true
      },
      {
        name: 'Mother Dairy Toned Milk',
        description: 'Fresh toned milk',
        price: 52,
        category: milkCat._id,
        unit: 'liter',
        unitSize: 1,
        stock: 250,
        image: 'https://images.unsplash.com/photo-1563636619-e9143da7973b?w=400',
        isAvailable: true,
        milkType: 'Cow',
        isFeatured: false
      },
      {
        name: 'Amul Butter - Unsalted, 500 gm',
        description: 'Unsalted butter for cooking',
        price: 265,
        category: butterCat._id,
        unit: 'gm',
        unitSize: 500,
        stock: 90,
        image: 'https://images.unsplash.com/photo-1589985270826-4b7bb135bc9d?w=400',
        isAvailable: true,
        milkType: 'Cow',
        isFeatured: false
      },
      {
        name: 'Amul Vanilla Ice Cream',
        description: 'Premium vanilla ice cream',
        price: 180,
        category: iceCreamCat._id,
        unit: 'ml',
        unitSize: 500,
        stock: 60,
        image: 'https://images.unsplash.com/photo-1497034825429-c343d7c6a68f?w=400',
        isAvailable: true,
        milkType: 'Cow',
        isFeatured: true
      },
      {
        name: 'Amul Mozzarella Cheese',
        description: 'Shredded mozzarella cheese',
        price: 150,
        category: cheeseCat._id,
        unit: 'gm',
        unitSize: 200,
        stock: 40,
        image: 'https://images.unsplash.com/photo-1452195100486-9cc805987862?w=400',
        isAvailable: true,
        milkType: 'Cow',
        isFeatured: false
      },
      {
        name: 'Amul Fresh Cream',
        description: 'Fresh dairy cream',
        price: 55,
        category: creamCat._id,
        unit: 'ml',
        unitSize: 250,
        stock: 70,
        image: 'https://images.unsplash.com/photo-1628088062854-d1870b4553da?w=400',
        isAvailable: true,
        milkType: 'Cow',
        isFeatured: false
      },
      {
        name: 'Nestle Dahi - Cup',
        description: 'Fresh set curd',
        price: 25,
        category: curdCat._id,
        unit: 'gm',
        unitSize: 200,
        stock: 120,
        image: 'https://images.unsplash.com/photo-1571212515935-a9c0d2998f5d?w=400',
        isAvailable: true,
        milkType: 'Cow',
        isFeatured: false
      },
      {
        name: 'Mother Dairy Paneer',
        description: 'Premium quality paneer',
        price: 95,
        category: paneerCat._id,
        unit: 'gm',
        unitSize: 200,
        stock: 45,
        image: 'https://images.unsplash.com/photo-1631452180519-c014fe946bc7?w=400',
        isAvailable: true,
        milkType: 'Cow',
        isFeatured: false
      },
      {
        name: 'Amul Chocolate Ice Cream',
        description: 'Rich chocolate ice cream',
        price: 185,
        category: iceCreamCat._id,
        unit: 'ml',
        unitSize: 500,
        stock: 55,
        image: 'https://images.unsplash.com/photo-1563805042-7684c019e1cb?w=400',
        isAvailable: true,
        milkType: 'Cow',
        isFeatured: true
      },
      {
        name: 'Britannia Cheese Spread',
        description: 'Creamy cheese spread',
        price: 110,
        category: cheeseCat._id,
        unit: 'gm',
        unitSize: 180,
        stock: 35,
        image: 'https://images.unsplash.com/photo-1452195100486-9cc805987862?w=400',
        isAvailable: true,
        milkType: 'Cow',
        isFeatured: false
      },
      {
        name: 'Amul Buttermilk - Masala',
        description: 'Refreshing masala buttermilk',
        price: 20,
        category: curdCat._id,
        unit: 'ml',
        unitSize: 200,
        stock: 100,
        image: 'https://images.unsplash.com/photo-1553530979-7ee52a2670c4?w=400',
        isAvailable: true,
        milkType: 'Cow',
        isFeatured: false
      },
      {
        name: 'Amul Lassi - Sweet',
        description: 'Traditional sweet lassi',
        price: 25,
        category: curdCat._id,
        unit: 'ml',
        unitSize: 200,
        stock: 85,
        image: 'https://images.unsplash.com/photo-1609501676725-7186f017a4b7?w=400',
        isAvailable: true,
        milkType: 'Cow',
        isFeatured: false
      },
      {
        name: 'Mother Dairy Ghee',
        description: 'Pure cow ghee',
        price: 520,
        category: gheeCat._id,
        unit: 'ml',
        unitSize: 500,
        stock: 30,
        image: 'https://images.unsplash.com/photo-1619108224582-b8b4c3f6e83d?w=400',
        isAvailable: true,
        milkType: 'Cow',
        isFeatured: true
      }
    ];

    // Clear existing products
    await Product.deleteMany({});

    // Insert new products
    const createdProducts = await Product.insertMany(products);
    console.log('Products seeded successfully:', createdProducts.length);

    process.exit(0);
  } catch (error) {
    console.error('Seeding error:', error);
    process.exit(1);
  }
};

seedProducts();
