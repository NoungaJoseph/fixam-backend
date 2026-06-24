const { execSync } = require('child_process');
require('dotenv').config();

// Ensure DIRECT_URL is set for Prisma
if (!process.env.DIRECT_URL && process.env.DATABASE_URL) {
  // Supabase specific: construct direct URL from pooled URL
  let directUrl = process.env.DATABASE_URL;
  if (directUrl.includes('pooler.supabase.com')) {
    // Keep port 6543 for IPv4 compatibility (Railway), but remove ?pgbouncer=true (Transaction pooling) 
    // so it uses Session pooling which supports DDL/migrations!
    directUrl = directUrl.split('?')[0]; 
  }
  process.env.DIRECT_URL = directUrl;
  console.log('[Setup] Constructed DIRECT_URL from DATABASE_URL for Prisma.');
} else if (!process.env.DIRECT_URL) {
  console.error('[Setup] DIRECT_URL and DATABASE_URL are both missing!');
}

try {
  console.log('[Setup] Running prisma db push...');
  execSync('npx prisma db push --accept-data-loss', { stdio: 'inherit' });
  console.log('[Setup] Prisma db push successful.');
} catch (error) {
  console.error('[Setup] Prisma db push failed.');
  process.exit(1);
}
