const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const connectWithRetry = async ({
  retries = Number(process.env.DB_CONNECT_RETRIES || 8),
  delayMs = Number(process.env.DB_CONNECT_RETRY_DELAY_MS || 2500),
} = {}) => {
  let lastError;

  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      await prisma.$connect();
      await prisma.$queryRaw`SELECT 1`;
      console.log(`Database connected on attempt ${attempt}`);
      return prisma;
    } catch (error) {
      lastError = error;
      const isLastAttempt = attempt === retries;
      console.error(`Database connection attempt ${attempt}/${retries} failed: ${error.message}`);
      if (!isLastAttempt) {
        await sleep(delayMs * attempt);
      }
    }
  }

  throw lastError;
};

module.exports = prisma;
module.exports.connectWithRetry = connectWithRetry;
