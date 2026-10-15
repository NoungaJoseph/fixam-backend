const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  try {
    console.log('Adding monetization and tracking columns to PostgreSQL...');

    // Job columns
    await prisma.$executeRawUnsafe(`ALTER TABLE "Job" ADD COLUMN IF NOT EXISTS "isPinned" BOOLEAN NOT NULL DEFAULT false;`);
    await prisma.$executeRawUnsafe(`ALTER TABLE "Job" ADD COLUMN IF NOT EXISTS "pinnedExpiresAt" TIMESTAMP(3);`);
    await prisma.$executeRawUnsafe(`ALTER TABLE "Job" ADD COLUMN IF NOT EXISTS "forwardToEmail" BOOLEAN NOT NULL DEFAULT false;`);
    await prisma.$executeRawUnsafe(`ALTER TABLE "Job" ADD COLUMN IF NOT EXISTS "hiringEmail" TEXT;`);

    // ExternalJobApplication columns
    await prisma.$executeRawUnsafe(`ALTER TABLE "ExternalJobApplication" ADD COLUMN IF NOT EXISTS "isPriority" BOOLEAN NOT NULL DEFAULT false;`);
    await prisma.$executeRawUnsafe(`ALTER TABLE "ExternalJobApplication" ADD COLUMN IF NOT EXISTS "coinsSpent" INTEGER NOT NULL DEFAULT 0;`);
    await prisma.$executeRawUnsafe(`ALTER TABLE "ExternalJobApplication" ADD COLUMN IF NOT EXISTS "cvViewedAt" TIMESTAMP(3);`);
    await prisma.$executeRawUnsafe(`ALTER TABLE "ExternalJobApplication" ADD COLUMN IF NOT EXISTS "cvViewCount" INTEGER NOT NULL DEFAULT 0;`);
    await prisma.$executeRawUnsafe(`ALTER TABLE "ExternalJobApplication" ADD COLUMN IF NOT EXISTS "viewToken" TEXT;`);

    // JobAssignment columns
    await prisma.$executeRawUnsafe(`ALTER TABLE "JobAssignment" ADD COLUMN IF NOT EXISTS "cvUrl" TEXT;`);
    await prisma.$executeRawUnsafe(`ALTER TABLE "JobAssignment" ADD COLUMN IF NOT EXISTS "cvName" TEXT;`);
    await prisma.$executeRawUnsafe(`ALTER TABLE "JobAssignment" ADD COLUMN IF NOT EXISTS "cvViewedAt" TIMESTAMP(3);`);

    console.log('Columns added successfully to database!');
  } catch (error) {
    console.error('Migration note (will apply when deployed):', error.message);
  } finally {
    await prisma.$disconnect();
  }
}

main();
