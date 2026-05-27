const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const crypto = require('crypto');

async function markApplied() {
  try {
    const migrations = await prisma.$queryRawUnsafe(`SELECT * FROM _prisma_migrations ORDER BY started_at ASC`);
    console.log('Current migrations:', migrations.map(m => m.migration_name));

    const pending = [
      '20260514193000_add_profile_mode_and_social_links',
      '20260522090000_add_client_favorite_providers',
      '20260524170000_automated_payments_bookings_support'
    ];

    for (const name of pending) {
      if (!migrations.find(m => m.migration_name === name)) {
        // Create an empty checksum since we ran it manually, or use a dummy hash
        const checksum = crypto.createHash('sha256').update(name).digest('hex');
        await prisma.$executeRawUnsafe(`
          INSERT INTO _prisma_migrations 
          (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
          VALUES 
          ($1, $2, NOW(), $3, '', NULL, NOW(), 1)
        `, crypto.randomUUID(), checksum, name);
        console.log(`Marked ${name} as applied in DB manually.`);
      } else {
        console.log(`${name} is already applied.`);
      }
    }
  } catch (error) {
    console.error(error);
  } finally {
    await prisma.$disconnect();
  }
}
markApplied();
