require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');

const authRoutes = require('./routes/auth.routes');
const userRoutes = require('./routes/user.routes');
const providerRoutes = require('./routes/provider.routes');
const jobRoutes = require('./routes/job.routes');
const walletRoutes = require('./routes/wallet.routes');
const chatRoutes = require('./routes/chat.routes');
const bookingRoutes = require('./routes/booking.routes');
const uploadRoutes = require('./routes/upload.routes');
const callRoutes = require('./routes/call.routes');
const adminRoutes = require('./routes/admin.routes');
const notificationRoutes = require('./routes/notification.routes');
const reviewRoutes = require('./routes/review.routes');
const paymentRoutes = require('./routes/payment.routes');
const { errorHandler } = require('./middlewares/error.middleware');

const app = express();

// Security Middlewares
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' }
}));
app.use(cors());

// Raw body MUST come before express.json() — required for Kora webhook HMAC verification
app.use('/api/payments/webhook/kora', express.raw({ type: 'application/json' }));

app.use(express.json());
app.use('/uploads', express.static('uploads'));
if (process.env.NODE_ENV !== 'production') {
  app.use(morgan('dev'));
}

// Rate Limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1000 // limit each IP to 1000 requests per windowMs
});
app.use('/api/', limiter);

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/providers', providerRoutes);
app.use('/api/jobs', jobRoutes);
app.use('/api/wallet', walletRoutes);
app.use('/api/transactions', walletRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/bookings', bookingRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/calls', callRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/reviews', reviewRoutes);
app.use('/api/payments', paymentRoutes);


// Health Check
app.get('/api/health', async (req, res) => {
  let dbStatus = 'Disconnected';
  try {
    const prisma = require('./config/prisma');
    await prisma.$queryRaw`SELECT 1`;
    dbStatus = 'Connected';
  } catch (error) {
    dbStatus = `Error: ${error.message}`;
  }

  const status = dbStatus === 'Connected' ? 200 : 503;
  
  res.status(status).json({
    success: dbStatus === 'Connected',
    message: dbStatus === 'Connected' ? "Fixam backend is running" : "Fixam backend has connectivity issues",
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'production',
    checks: {
      database: dbStatus,
      uptime: process.uptime(),
      memory: process.memoryUsage()
    }
  });
});

app.get('/health', (req, res) => res.redirect('/api/health'));

// Error Handling Middleware
app.use(errorHandler);

module.exports = app;
