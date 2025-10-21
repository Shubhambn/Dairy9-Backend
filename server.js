// C:\Users\Krishna\OneDrive\Desktop\backend-dairy9\Dairy9-Backend\server.js


import express from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import connectDB from './config/db.js';
import authRoutes from './routes/auth.routes.js';
import customerRoutes from './routes/customer.routes.js';
import categoryRoutes from './routes/category.routes.js';
import productRoutes from './routes/product.routes.js';
import orderRoutes from './routes/order.routes.js'; 
import paymentRoutes from './routes/payment.routes.js'; 

dotenv.config();
const app = express();

app.use(cors());
app.use(express.json());

connectDB();

app.use('/api/auth', authRoutes);
app.use('/api/customer', customerRoutes);
app.use('/api/catalog', categoryRoutes);
app.use('/api/catalog', productRoutes);
app.use('/api/orders', orderRoutes); 
app.use('/api/payments', paymentRoutes); 

app.get('/', (req, res) => res.json({ message: 'Dairy9 Backend Running' }));

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
