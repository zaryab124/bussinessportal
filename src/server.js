const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');
const config = require('./config');
const { query } = require('./config/db');

// Import routes
const authRoutes = require('./routes/authRoutes');
const userRoutes = require('./routes/userRoutes');
const productRoutes = require('./routes/productRoutes');
const mediaRoutes = require('./routes/mediaRoutes');
const purchaseRoutes = require('./routes/purchaseRoutes');
const saleRoutes = require('./routes/saleRoutes');

const app = express();

// Security middleware
app.use(helmet({
  contentSecurityPolicy: false // Allows inline scripts for dashboard dynamic components
}));
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Static frontend assets and persistent media uploads
app.use(express.static(path.join(__dirname, '../public')));
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// Health check endpoint
app.get('/api/health', async (req, res) => {
  try {
    const dbTest = await query('SELECT 1 as healthy');
    return res.json({
      status: 'UP',
      timestamp: new Date().toISOString(),
      database: dbTest.rows.length > 0 ? 'connected' : 'disconnected'
    });
  } catch (err) {
    return res.status(500).json({
      status: 'DOWN',
      timestamp: new Date().toISOString(),
      error: err.message
    });
  }
});

// Mount API routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/products', productRoutes);
app.use('/api/products', mediaRoutes);
app.use('/api/purchases', purchaseRoutes);
app.use('/api/sales', saleRoutes);

// Fallback to SPA index for web routing
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) {
    return next();
  }
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// Centralized error handling
app.use((err, req, res, next) => {
  console.error('[Global Error Handler]', err);
  res.status(err.status || 500).json({
    success: false,
    message: err.message || 'Internal Server Error'
  });
});

if (require.main === module) {
  const server = app.listen(config.port, () => {
    console.log(`====================================================`);
    console.log(` Stock & Profit-Sharing Portal Server Active`);
    console.log(` Port: ${config.port}`);
    console.log(` Environment: ${config.nodeEnv}`);
    console.log(` Address: http://localhost:${config.port}`);
    console.log(`====================================================`);
  });

  const shutdown = async () => {
    console.log('Shutting down server gracefully...');
    server.close(() => {
      console.log('HTTP server closed.');
      process.exit(0);
    });
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

module.exports = app;
