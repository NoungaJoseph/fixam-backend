const http = require('http');
const app = require('./app');
const { initSocket } = require('./services/socket.service');
const prisma = require('./config/prisma');
const { connectWithRetry } = require('./config/prisma');

const PORT = process.env.PORT || 5000;
const server = http.createServer(app);

initSocket(server);

const startServer = async () => {
  try {
    await connectWithRetry();
  } catch (error) {
    console.error('Database was not reachable during startup:', error.message);
    if (process.env.REQUIRE_DB_ON_START === 'true') {
      process.exit(1);
    }
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Fixam Backend running on port ${PORT}`);
  });
};

startServer();

process.on('unhandledRejection', (err) => {
  console.error('Unhandled Rejection:', err);
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
});

const shutdown = async () => {
  server.close(async () => {
    await prisma.$disconnect().catch(() => {});
    process.exit(0);
  });
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
