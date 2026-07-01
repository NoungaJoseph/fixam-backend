require('dotenv').config();

const http = require('http');
const app = require('./app');
const prisma = require('./config/prisma');
const { connectWithRetry } = require('./config/prisma');
const { initSocket } = require('./services/socket.service');
const { startStatusUpdater } = require('./jobs/statusUpdater');

const PORT = process.env.PORT || 8080;

const server = http.createServer(app);

initSocket(server);
startStatusUpdater();

async function startServer() {
  try {
    console.log('Starting Fixam backend...');

    // Try DB connection
    await connectWithRetry();

    console.log('Database connected successfully');

    // Ensure database schema matches our multi-country requirements
    try {
      console.log('Validating and running multi-country DB migrations...');
      const newEnums = ['M_PESA', 'AIRTEL_MONEY', 'VODAFONE_CASH', 'MOOV_MONEY', 'WAVE', 'TIGO_PESA', 'ETISALAT_CASH'];
      for (const val of newEnums) {
        try {
          await prisma.$executeRawUnsafe(`ALTER TYPE "PaymentMethod" ADD VALUE '${val}'`);
        } catch (e) {
          // Ignore "already exists" errors
          if (!e.message.includes('already exists') && !e.message.includes('labels')) {
            console.log(`[Migration] Enum warning for ${val}:`, e.message);
          }
        }
      }

      await prisma.$executeRawUnsafe(`ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "country" TEXT DEFAULT 'Cameroon'`);
      await prisma.$executeRawUnsafe(`ALTER TABLE "Job" ADD COLUMN IF NOT EXISTS "country" TEXT DEFAULT 'Cameroon'`);
      await prisma.$executeRawUnsafe(`ALTER TABLE "Job" ADD COLUMN IF NOT EXISTS "isRemote" BOOLEAN NOT NULL DEFAULT false`);

      console.log('Multi-country DB columns & enums verified successfully');
    } catch (migErr) {
      console.error('[Migration] Failed to run auto-migration:', migErr.message);
    }

    // Verify Firebase Admin initialization
    try {
      require('./config/firebase');
    } catch (fbErr) {
      console.error('[Firebase] Startup initialization failed:', fbErr.message);
    }

    // Start server
    server.listen(PORT, '0.0.0.0', () => {
      console.log(`Fixam Backend running on port ${PORT}`);
    });

  } catch (error) {
    console.error('Startup error:', error);

    // Railway should still see a running process
    if (process.env.REQUIRE_DB_ON_START === 'true') {
      process.exit(1);
    }

    // Start anyway even if DB fails
    server.listen(PORT, '0.0.0.0', () => {
      console.log(`Server running without DB on port ${PORT}`);
    });
  }
}

startServer();

setTimeout(() => {
  console.log('--- RAILWAY ENV DEBUG ---');
  console.log('EMAIL_HOST:', process.env.EMAIL_HOST);
  console.log('EMAIL_PORT:', process.env.EMAIL_PORT);
  console.log('EMAIL_USER:', process.env.EMAIL_USER);
  console.log('EMAIL_PASS exists:', !!process.env.EMAIL_PASS);
  console.log('RESEND_API_KEY exists:', !!process.env.RESEND_API_KEY);
  console.log('-------------------------');
}, 3000); // Wait 3 seconds after startup

process.on('unhandledRejection', (err) => {
  console.error('Unhandled Rejection:', err);
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
});

async function shutdown() {
  console.log('Shutting down server...');

  server.close(async () => {
    try {
      await prisma.$disconnect();
    } catch (e) {
      console.error('Prisma disconnect error:', e);
    }

    process.exit(0);
  });
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);