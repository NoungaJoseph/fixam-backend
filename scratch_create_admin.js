const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');
const prisma = new PrismaClient();

async function createAdmin() {
  const email = 'fixam8899@gmail.com';
  const password = await bcrypt.hash('fixam2026', 10);
  
  const admin = await prisma.user.upsert({
    where: { email },
    update: { role: 'ADMIN', password },
    create: {
      email,
      fullName: 'Fixam Admin',
      password,
      role: 'ADMIN',
      phone: '000000000'
    }
  });
  
  console.log('Admin created/updated:', admin.email);
  process.exit(0);
}

createAdmin();
