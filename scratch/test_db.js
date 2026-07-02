const { PrismaClient } = require('@prisma/client');

const dbUrl = "postgresql://postgres.bvzebfcjirnrcjxxdjrt:FixamSecure2026@52.209.89.87:6543/postgres?pgbouncer=true&connection_limit=10&sslmode=require";

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: dbUrl
    }
  },
  log: ['query', 'info', 'warn', 'error']
});

async function main() {
  console.log('Testing connection to:', dbUrl);
  try {
    const user = await prisma.user.findFirst();
    console.log('Successfully connected! User found:', user ? user.fullName : 'No users in DB');
  } catch (err) {
    console.error('Connection failed:', err);
  } finally {
    await prisma.$disconnect();
  }
}

main();
