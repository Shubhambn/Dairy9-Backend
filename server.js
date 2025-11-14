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
import { initializeSuperAdmin } from './config/initializeSuperAdmin.js';
// Import inventory routes (NEW)
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

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/superadmin', superadminRoutes);
app.use('/api/customer', customerRoutes);
app.use('/api/catalog', categoryRoutes);
app.use('/api/catalog', productRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/orders/retailer', retailerOrderRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/location', locationRoutes);

// 👇 ADD INVENTORY ROUTES
app.use('/api/retailer/inventory', inventoryRoutes);

app.get('/', (req, res) => res.json({
  message: 'Dairy9 Backend Running',
  timestamp: new Date().toISOString()
}));

// Health check
app.get('/health', (req, res) => {
  res.json({
    success: true,
    message: 'Server is healthy',
    timestamp: new Date().toISOString()
  });
});

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
    message: 'Route not found'
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
  // optional init: create superadmin user if missing
  if (typeof initializeSuperAdmin === 'function') {
    initializeSuperAdmin().catch(err => console.warn('initializeSuperAdmin failed:', err));
  }
});
