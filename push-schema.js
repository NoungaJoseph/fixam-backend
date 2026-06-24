const { execSync } = require('child_process');

// Ensure DIRECT_URL is set for Prisma
if (!process.env.DIRECT_URL) {
  process.env.DIRECT_URL = process.env.DATABASE_URL;
  console.log('[Setup] Set DIRECT_URL from DATABASE_URL for Prisma.');
}

try {
  console.log('[Setup] Running prisma db push...');
  execSync('npx prisma db push --accept-data-loss', { stdio: 'inherit' });
  console.log('[Setup] Prisma db push successful.');
} catch (error) {
  console.error('[Setup] Prisma db push failed.');
  process.exit(1);
}
