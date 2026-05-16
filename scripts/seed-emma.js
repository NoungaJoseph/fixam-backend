const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const bcrypt = require('bcrypt');

async function seed() {
  const email = 'emma@fixam.com';
  const phone = '237670000000';
  const fullName = 'Emma Ngassa';

  const existing = await prisma.user.findFirst({ where: { OR: [{ email }, { phone }] } });
  if (existing) {
    console.log('Emma already exists. Updating...');
    await prisma.providerProfile.upsert({
      where: { userId: existing.id },
      update: { skills: ['Plumber', 'Construction'], bio: 'Top rated plumber in the region.', serviceArea: 'Bastos, Douala', rating: 5.0 },
      create: { userId: existing.id, skills: ['Plumber', 'Construction'], bio: 'Top rated plumber in the region.', serviceArea: 'Bastos, Douala', rating: 5.0 }
    });
    console.log('Updated Emma.');
    return;
  }

  const hashedPassword = await bcrypt.hash('password123', 10);
  const user = await prisma.user.create({
    data: {
      fullName,
      email,
      phone,
      password: hashedPassword,
      role: 'PROVIDER',
      providerProfile: {
        create: {
          skills: ['Plumber', 'Construction'],
          bio: 'Professional plumber with 10 years experience.',
          rate: 5000,
          serviceArea: 'Bastos, Douala',
          rating: 5.0,
          experienceLevel: 'Pro'
        }
      },
      wallet: { create: { balance: 100 } }
    }
  });

  console.log('Seeded Emma Ngassa successfully!');
}

seed().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
