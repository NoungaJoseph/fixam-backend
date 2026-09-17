const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  try {
    console.log('Adding appMaintenanceEnabled...');
    await prisma.$executeRawUnsafe(`ALTER TABLE "Settings" ADD COLUMN IF NOT EXISTS "appMaintenanceEnabled" BOOLEAN NOT NULL DEFAULT false;`);
    console.log('Adding webMaintenanceEnabled...');
    await prisma.$executeRawUnsafe(`ALTER TABLE "Settings" ADD COLUMN IF NOT EXISTS "webMaintenanceEnabled" BOOLEAN NOT NULL DEFAULT false;`);
    console.log('Database updated successfully!');
  } catch (error) {
    console.error('Failed to update database:', error);
  } finally {
    await prisma.$disconnect();
  }
}

main();
