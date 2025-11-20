// server.js - UPDATED
import express from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import connectDB from './config/db.js';
import { productionConfig } from './config/production.js';
import http from 'http';
import { initSocket } from './lib/socket.js';

// Import routes
import authRoutes from './routes/auth.routes.js';
import customerRoutes from './routes/customer.routes.js';
import categoryRoutes from './routes/category.routes.js';
import productRoutes from './routes/product.routes.js';
import orderRoutes from './routes/order.routes.js';
import retailerOrderRoutes from './routes/retailer.order.routes.js';
import paymentRoutes from './routes/payment.routes.js';
import adminRoutes from './routes/admin.routes.js';
import locationRoutes from './routes/location.routes.js';
import customerProductRoutes from './routes/customerProduct.routes.js';
import inventoryRoutes from './routes/inventory.routes.js';
import superadminRoutes from './routes/superadmin.routes.js';

dotenv.config();
const app = express();

// Basic CORS configuration (use your existing one)
app.use(cors(productionConfig.cors));

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Connect to database (non-blocking)
connectDB().catch(err => {
  console.error('Failed to connect to DB on startup:', err);
  // optionally: process.exit(1);
});

// =============================================
// ROUTE CONFIGURATION - PRESERVING BOTH VERSIONS
// =============================================

// Auth routes
app.use('/api/auth', authRoutes);
app.use('/api/superadmin', superadminRoutes);
app.use('/api/customer', customerRoutes);

// Category routes (both patterns supported)
app.use('/api/catalog', categoryRoutes); // Pattern 1: /api/catalog/
app.use('/api/catalog/categories', categoryRoutes); // Pattern 2: /api/catalog/categories/

// Product routes (both patterns supported)
app.use('/api/catalog', productRoutes); // Pattern 1: /api/catalog/
app.use('/api/catalog/products', productRoutes); // Pattern 2: /api/catalog/products/

// Order routes
app.use('/api/orders', orderRoutes);

// Retailer order routes
app.use('/api/orders/retailer', retailerOrderRoutes);

// Payment routes
app.use('/api/payments', paymentRoutes);

// Admin routes
app.use('/api/admin', adminRoutes);

// Location routes
app.use('/api/location', locationRoutes);

// Inventory routes
app.use('/api/retailer/inventory', inventoryRoutes);

app.use('/api/customer/products', customerProductRoutes);

// =============================================
// ROOT AND HEALTH CHECK ROUTES
// =============================================
app.get('/', (req, res) => res.json({
  message: 'Dairy9 Backend Running',
  timestamp: new Date().toISOString(),
  version: '1.0.0',
  routes: {
    auth: '/api/auth',
    customer: '/api/customer',
    catalog: '/api/catalog (and /api/catalog/categories, /api/catalog/products)',
    orders: '/api/orders',
    payments: '/api/payments',
    admin: '/api/admin',
    location: '/api/location',
    inventory: '/api/retailer/inventory',
    customerProducts: '/api/customer/products'
  }
}));

// Health check
app.get('/health', (req, res) => {
  res.json({
    success: true,
    message: 'Server is healthy',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    database: 'Connected' // You can add DB health check here
  });
});

// =============================================
// ERROR HANDLING MIDDLEWARE
// =============================================

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).json({
    success: false,
    message: 'Internal server error',
    ...(process.env.NODE_ENV === 'development' && { error: err.message })
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    message: 'Route not found',
    requestedUrl: req.originalUrl,
    availableEndpoints: [
      '/api/auth',
      '/api/customer',
      '/api/catalog',
      '/api/catalog/categories',
      '/api/catalog/products',
      '/api/orders',
      '/api/orders/retailer',
      '/api/payments',
      '/api/admin',
      '/api/location',
      '/api/retailer/inventory',
      '/api/customer/products',
      '/health'
    ]
  });
});

// Create HTTP server and initialize Socket.IO
const PORT = productionConfig.server.port;
const HOST = productionConfig.server.host || '0.0.0.0';

const server = http.createServer(app);

// Initialize Socket.IO and attach to app so controllers can use req.app.get('io')
try {
  const io = initSocket(server, {
    cors: { origin: productionConfig.cors.origin || '*' },
    // optional verifyToken: (token) => jwt.verify(token, process.env.JWT_SECRET)
  });
  app.set('io', io);
  console.log('✅ Socket.IO initialized');
} catch (e) {
  console.warn('⚠️ Socket.IO initialization failed (will run without realtime):', e.message);
}

// Start server
server.listen(PORT, HOST, () => {
  console.log(`✅ Server running on ${HOST}:${PORT}`);
  console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`📚 Available Routes:`);
  console.log(`   🔐 Auth: ${HOST}:${PORT}/api/auth`);
  console.log(`   👤 Customer: ${HOST}:${PORT}/api/customer`);
  console.log(`   📦 Catalog: ${HOST}:${PORT}/api/catalog`);
  console.log(`   📦 Catalog (Alt): ${HOST}:${PORT}/api/catalog/categories`);
  console.log(`   🛍️ Products: ${HOST}:${PORT}/api/catalog/products`);
  console.log(`   📋 Orders: ${HOST}:${PORT}/api/orders`);
  console.log(`   🏪 Retailer Orders: ${HOST}:${PORT}/api/orders/retailer`);
  console.log(`   💳 Payments: ${HOST}:${PORT}/api/payments`);
  console.log(`   👨‍💼 Admin: ${HOST}:${PORT}/api/admin`);
  console.log(`   📍 Location: ${HOST}:${PORT}/api/location`);
  console.log(`   📊 Inventory: ${HOST}:${PORT}/api/retailer/inventory`);
  console.log(`   🛒 Customer Products: ${HOST}:${PORT}/api/customer/products`);
  console.log(`   ❤️ Health: ${HOST}:${PORT}/health`);
});
