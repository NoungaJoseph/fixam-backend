const dotenv = require('dotenv');
dotenv.config();

// Override DATABASE_URL to use DIRECT_URL (direct connection on port 5432)
if (process.env.DIRECT_URL) {
  process.env.DATABASE_URL = process.env.DIRECT_URL;
}

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function inspectPortfolios() {
  try {
    const profiles = await prisma.providerProfile.findMany({
      select: {
        id: true,
        userId: true,
        portfolio: true,
        user: {
          select: {
            fullName: true
          }
        }
      }
    });

    console.log('--- Provider Portfolios ---');
    profiles.forEach(p => {
      if (p.portfolio && Array.isArray(p.portfolio) && p.portfolio.length > 0) {
        console.log(`Provider: ${p.user?.fullName} (ID: ${p.id})`);
        console.log('Portfolio Data:', JSON.stringify(p.portfolio, null, 2));
      }
    });
  } catch (error) {
    console.error('Error inspecting portfolios:', error);
  } finally {
    await prisma.$disconnect();
  }
}

inspectPortfolios();
