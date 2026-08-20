require('dotenv').config();
const Sentry = require('@sentry/node');
const { nodeProfilingIntegration } = require('@sentry/profiling-node');

Sentry.init({
  dsn: process.env.SENTRY_DSN || '',
  integrations: [
    Sentry.expressIntegration(),
    nodeProfilingIntegration(),
  ],
  tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.2 : 1.0,
  profilesSampleRate: process.env.NODE_ENV === 'production' ? 0.2 : 1.0,
  enabled: !!process.env.SENTRY_DSN,
});

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const hpp = require('hpp');
const compression = require('compression');
const { apiLimiter } = require('./middlewares/rateLimit.middleware');
const sanitizeMiddleware = require('./middlewares/sanitize.middleware');
const cookieParser = require('cookie-parser');

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
const systemRoutes = require('./routes/system.routes');
const dashboardRoutes = require('./routes/dashboard.routes');
const disputeRoutes = require('./routes/dispute.routes');
const agreementRoutes = require('./routes/agreement.routes');
const sportsRoutes = require('./routes/sports.routes');
const analyticsRoutes = require('./routes/web/analytics.routes');
const { errorHandler } = require('./middlewares/error.middleware');


const app = express();
app.set('trust proxy', 1);

// Enable HTTP Compression
app.use(compression());

// Security Middlewares
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' }
}));

const allowedOrigins = [
  process.env.DASHBOARD_URL,
  process.env.WEBSITE_URL,
  'https://dashboard.usefixam.com',
  'https://usefixam.com',
  'https://career.usefixam.com',
  'https://fixam-website-psi.vercel.app',
  'http://localhost:3000',
  'http://localhost:3001',
  'http://localhost:4000',
  'http://localhost:5173',
  'http://localhost:5174',
  'http://localhost:5175'
].filter(Boolean);

app.use(cors({
  credentials: true,
  origin: function (origin, callback) {
    // Only allow localhost in non-production environments
    const isLocalDev = process.env.NODE_ENV !== 'production' && origin && (
      origin.startsWith('http://localhost') ||
      origin.startsWith('http://127.0.0.1') ||
      origin.startsWith('http://192.168.') ||
      origin.startsWith('http://10.') ||
      /^http:\/\/172\.(1[6-9]|2[0-9]|3[0-1])\./.test(origin)
    );

    if (!origin || allowedOrigins.includes(origin) || isLocalDev) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  }
}));

// Raw body MUST come before express.json() — required for Kora webhook HMAC verification
app.use('/api/payments/webhook/kora', express.raw({ type: 'application/json' }));

app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());
// Public static assets — only non-sensitive buckets
app.use('/uploads/profile-images', express.static('uploads/profile-images', {
  maxAge: process.env.NODE_ENV === 'production' ? '7d' : 0,
  fallthrough: false
}));
app.use('/uploads/portfolio-images', express.static('uploads/portfolio-images', {
  maxAge: process.env.NODE_ENV === 'production' ? '7d' : 0,
  fallthrough: false
}));
app.use('/uploads/portfolio-videos', express.static('uploads/portfolio-videos', {
  maxAge: process.env.NODE_ENV === 'production' ? '7d' : 0,
  fallthrough: false
}));
app.use('/uploads/portfolio-media', express.static('uploads/portfolio-media', {
  maxAge: process.env.NODE_ENV === 'production' ? '7d' : 0,
  fallthrough: false
}));
app.use('/uploads/chat-media', express.static('uploads/chat-media', {
  maxAge: process.env.NODE_ENV === 'production' ? '7d' : 0,
  fallthrough: false
}));
app.use('/uploads', express.static('uploads', {
  maxAge: process.env.NODE_ENV === 'production' ? '7d' : 0,
  fallthrough: true
}));
// NOTE: verification-documents and payment-proofs are served via authenticated routes only (not static)
app.use('/public', express.static('public', {
  maxAge: process.env.NODE_ENV === 'production' ? '7d' : 0,
  fallthrough: false
}));
if (process.env.NODE_ENV !== 'production') {
  app.use(morgan('dev'));
}

// Rate Limiting
app.use('/api/', apiLimiter);

// Input Sanitization
app.use(sanitizeMiddleware);

// HTTP Parameter Pollution protection
app.use(hpp());

// Slow Request Logging
app.use((req, res, next) => {
  const start = Date.now()
  res.on('finish', () => {
    const duration = Date.now() - start
    if (duration > 2000) {
      console.warn('[SLOW REQUEST]', {
        method: req.method,
        path: req.path,
        duration: duration + 'ms',
        status: res.statusCode,
        timestamp: new Date().toISOString()
      })
    }
  })
  next()
})

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
app.use('/api/system', systemRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/sports', sportsRoutes);
app.use('/api/disputes', disputeRoutes);
app.use('/api/agreements', agreementRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/web/analytics', analyticsRoutes);

// Authenticated route for sensitive private file buckets
// Prevents public access to verification docs and payment proofs
const { protect: secureFileProtect } = require('./middlewares/auth.middleware');
const path = require('path');
const fs = require('fs');
const SENSITIVE_BUCKETS = ['verification-documents', 'payment-proofs'];
app.get('/uploads/:bucket/:filename', secureFileProtect, (req, res) => {
  const { bucket, filename } = req.params;
  if (!SENSITIVE_BUCKETS.includes(bucket)) {
    return res.status(404).json({ success: false, message: 'File not found' });
  }
  if (!/^[\w.\-]+$/.test(filename)) {
    return res.status(400).json({ success: false, message: 'Invalid filename' });
  }
  if (req.user.role !== 'ADMIN') {
    return res.status(403).json({ success: false, message: 'Access denied' });
  }
  const filePath = path.join(process.cwd(), 'uploads', bucket, filename);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ success: false, message: 'File not found' });
  }
  res.sendFile(filePath);
});

// --- WEB / CAREERPATH EXCLUSIVE ROUTES ---
const webAuthRoutes = require('./routes/web/web-auth.routes');
const careerpathRoutes = require('./routes/web/careerpath.routes');

app.use('/api/v1/web-auth', webAuthRoutes);
app.use('/api/v1/careerpath', careerpathRoutes);
app.use('/api/v1/analytics', analyticsRoutes);


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
      ...(process.env.NODE_ENV === 'production' ? {} : { memory: process.memoryUsage() })
    }
  });
});

app.get('/health', (req, res) => res.redirect('/api/health'));

// Error Handling Middleware
// Sentry v8+ error handler must be registered before custom error handler
Sentry.setupExpressErrorHandler(app);
app.use(errorHandler);

module.exports = app;
