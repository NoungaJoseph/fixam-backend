const { execFileSync } = require('child_process');

require('dotenv').config();

// Prisma requires DIRECT_URL for schema operations. Railway deployments that
// only define DATABASE_URL can use the same Supabase session-pool connection
// with the transaction-pooler flag removed.
if (!process.env.DIRECT_URL && process.env.DATABASE_URL) {
  process.env.DIRECT_URL = process.env.DATABASE_URL
    .replace(/[?&]pgbouncer=true(&|$)/i, (_, separator) => separator === '&' ? '?' : '')
    .replace(/\?$/, '');
}

if (!process.env.DIRECT_URL) {
  console.error('DIRECT_URL or DATABASE_URL must be configured before running migrations.');
  process.exit(1);
}

const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
execFileSync(npx, ['prisma', 'migrate', 'deploy'], {
  stdio: 'inherit',
  env: process.env,
});
