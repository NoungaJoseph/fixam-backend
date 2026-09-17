const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkAdmins() {
  const admins = await prisma.user.findMany({
    where: { role: 'ADMIN' }
  });
  console.log('Admins found:', admins.map(a => ({ email: a.email, role: a.role })));
  process.exit(0);
}

checkAdmins();
