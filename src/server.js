require('dotenv').config();

const http = require('http');
const app = require('./app');
const prisma = require('./config/prisma');
const { connectWithRetry } = require('./config/prisma');
const { initSocket } = require('./services/socket.service');

const PORT = process.env.PORT || 8080;

const server = http.createServer(app);

initSocket(server);

async function startServer() {
  try {
    console.log('Starting Fixam backend...');

    // Try DB connection
    await connectWithRetry();

    console.log('Database connected successfully');

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