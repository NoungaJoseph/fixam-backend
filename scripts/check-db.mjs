import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  try {
    const admins = await prisma.$queryRaw`SELECT phone, role FROM "User" WHERE role = 'ADMIN' LIMIT 1`;
    console.log('=== ADMIN USERS ===');
    console.log(JSON.stringify(admins, null, 2));

    const tokens = await prisma.$queryRaw`
      SELECT id, phone, role,
        CASE WHEN "fcmToken" IS NOT NULL THEN 'HAS TOKEN' ELSE 'NO TOKEN' END as token_status
      FROM "User"
      LIMIT 10
    `;
    console.log('\n=== FCM TOKEN STATUS (first 10 users) ===');
    console.log(JSON.stringify(tokens, null, 2));
  } catch (e) {
    console.error('DB Error:', e.message);
  } finally {
    await prisma.$disconnect();
  }
}

main();
