const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const bcrypt = require('bcrypt');

async function checkUsers() {
  try {
    const users = await prisma.user.findMany({
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: {
        id: true,
        phone: true,
        fullName: true,
        email: true,
        password: true,
        role: true,
        createdAt: true,
      }
    });

    console.log('--- LATEST 10 USERS ---');
    users.forEach(u => {
      console.log(`ID: ${u.id}`);
      console.log(`Phone: ${u.phone}`);
      console.log(`Name: ${u.fullName}`);
      console.log(`Email: ${u.email}`);
      console.log(`Password Hash: ${u.password ? u.password.substring(0, 20) + '...' : 'NULL'}`);
      console.log(`Role: ${u.role}`);
      console.log(`Created At: ${u.createdAt}`);
      console.log('------------------------');
    });

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

checkUsers();
