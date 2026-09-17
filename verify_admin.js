const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
  const admins = await prisma.user.findMany({
    where: { role: 'ADMIN' },
    select: { id: true, email: true, isEmailVerified: true, role: true }
  });
  console.log('Admins in DB:', admins);

  await prisma.user.updateMany({
    where: { role: 'ADMIN' },
    data: { isEmailVerified: true }
  });
  console.log('All admins verified!');
}
main().catch(console.error).finally(() => prisma.$disconnect());
