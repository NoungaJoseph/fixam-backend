const prisma = require('../src/config/prisma');
const bcrypt = require('bcrypt');

async function main() {
  console.log('--- Starting Database Reset & Test Seeding ---');

  // 1. Identify Admin Users to preserve
  const adminUsers = await prisma.user.findMany({
    where: { role: 'ADMIN' },
    select: { id: true, email: true, phone: true, fullName: true, role: true }
  });
  const adminIds = adminUsers.map(a => a.id);
  console.log(`Found ${adminUsers.length} Admin account(s) to preserve:`, adminUsers.map(a => a.email || a.phone || a.fullName));

  // 2. Clean up non-admin database tables in dependency order
  console.log('Clearing dependent tables...');

  // Optional/auxiliary tables
  const safeDelete = async (modelName, where = {}) => {
    if (prisma[modelName] && typeof prisma[modelName].deleteMany === 'function') {
      try {
        await prisma[modelName].deleteMany({ where });
      } catch (err) {
        console.warn(`[Cleanup Notice] Error deleting ${modelName}:`, err.message);
      }
    }
  };

  await safeDelete('review');
  await safeDelete('callSession');
  await safeDelete('jobAssignment');
  await safeDelete('booking');
  await safeDelete('job');
  await safeDelete('message');
  await safeDelete('conversationParticipant');
  await safeDelete('supportConversation');
  await safeDelete('conversation');
  await safeDelete('feedback');
  await safeDelete('report');
  await safeDelete('securityLog');
  await safeDelete('pageView');
  
  await safeDelete('notification', { userId: { notIn: adminIds } });
  await safeDelete('coinPurchase', { userId: { notIn: adminIds } });
  await safeDelete('payment', { userId: { notIn: adminIds } });
  await safeDelete('transaction', { wallet: { userId: { notIn: adminIds } } });
  await safeDelete('wallet', { userId: { notIn: adminIds } });

  await safeDelete('unlockedProvider');
  await safeDelete('clientFavoriteProvider');
  await safeDelete('providerMonthlyStats');
  await safeDelete('providerReport');
  await safeDelete('verificationDocument');
  await safeDelete('providerProfile', { userId: { notIn: adminIds } });

  await safeDelete('careerpathEnrollment');
  await safeDelete('careerpathModuleProgress');
  await safeDelete('careerpathCertificate');
  await safeDelete('careerpathBookmark');

  // Delete all non-admin users
  const deleteUsersResult = await prisma.user.deleteMany({
    where: { role: { not: 'ADMIN' } }
  });
  console.log(`Deleted ${deleteUsersResult.count} non-admin user(s).`);

  // Ensure every preserved Admin has an active wallet
  for (const admin of adminUsers) {
    await prisma.wallet.upsert({
      where: { userId: admin.id },
      update: {},
      create: { userId: admin.id, balance: 1000 }
    });
  }

  // 3. Create Clean Test Client for App Store Review
  console.log('Creating Test Client account for Apple Review...');
  const hashedPassword = await bcrypt.hash('Password123!', 10);

  const testClient = await prisma.user.create({
    data: {
      fullName: 'Fixam Test Client',
      email: 'test.client@usefixam.com',
      phone: '237670000001',
      password: hashedPassword,
      role: 'CLIENT',
      country: 'Cameroon',
      preferredLanguage: 'en',
      isEmailVerified: true,
      twoFactorEnabled: false,
      isBlocked: false,
      avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=400&auto=format&fit=crop&q=80',
      wallet: {
        create: {
          balance: 100
        }
      }
    },
    include: { wallet: true }
  });

  // 4. Create a Verified Test Provider with Rich Portfolio for Client to Test Booking/Proposals
  console.log('Creating Verified Test Provider with Portfolio for marketplace testing...');
  const testProvider = await prisma.user.create({
    data: {
      fullName: 'Jean Dupont',
      email: 'test.provider@usefixam.com',
      phone: '237670000002',
      password: hashedPassword,
      role: 'PROVIDER',
      country: 'Cameroon',
      preferredLanguage: 'en',
      isEmailVerified: true,
      twoFactorEnabled: false,
      isBlocked: false,
      isOnline: true,
      avatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=400&auto=format&fit=crop&q=80',
      wallet: {
        create: {
          balance: 100
        }
      },
      providerProfile: {
        create: {
          skills: ['Plumbing Services', 'Pipe Fitting', 'Bathroom Installation'],
          bio: 'Certified Master Plumber with over 8 years of residential and commercial installation & repair experience. Fast response, quality delivery.',
          rate: 5000,
          rating: 5.0,
          reviewCount: 15,
          serviceArea: 'Douala, Cameroon',
          experienceLevel: 'Expert (5+ yrs)',
          verification: 'VERIFIED',
          profileMode: 'WORK',
          profileScore: 9,
          portfolio: [
            {
              id: 'proj_plumbing_sample_1',
              title: 'Full Master Bathroom & Pipe Installation',
              category: 'Plumbing Services',
              description: 'Complete replacement and modern installation of copper & PVC piping, luxury shower heads, vanity faucets, and drainage inspection.',
              imageUrl: 'https://images.unsplash.com/photo-1584622650111-993a426fbf0a?w=800&auto=format&fit=crop&q=80',
              images: [
                'https://images.unsplash.com/photo-1584622650111-993a426fbf0a?w=800&auto=format&fit=crop&q=80',
                'https://images.unsplash.com/photo-1507652313519-d4e9174996dd?w=800&auto=format&fit=crop&q=80'
              ],
              price: 15000,
              packages: {
                basic: {
                  enabled: true,
                  name: 'Basic Leak Repair',
                  summary: 'Diagnostic check and fixture leak repair with standard sealants.',
                  price: 5000,
                  deliveryDays: 1,
                  revisions: 1,
                  expressDeliveryEnabled: true,
                  expressDeliveryDays: 1,
                  expressDeliveryPrice: 2000,
                  features: ['Leak diagnosis', 'Sealant replacement', '1-hour labor']
                },
                standard: {
                  enabled: true,
                  name: 'Standard Pipe & Faucet Fitting',
                  summary: 'Complete faucet/sink fixture fitting, water pressure optimization & safety test.',
                  price: 15000,
                  deliveryDays: 2,
                  revisions: 2,
                  expressDeliveryEnabled: true,
                  expressDeliveryDays: 1,
                  expressDeliveryPrice: 4000,
                  features: ['Full fixture installation', 'Pressure test', 'Drain clearing', '30-day warranty']
                },
                premium: {
                  enabled: true,
                  name: 'Premium Complete Bathroom Overhaul',
                  summary: 'Full master plumbing replacement, shower valve installation, certified safety check.',
                  price: 35000,
                  deliveryDays: 4,
                  revisions: 3,
                  expressDeliveryEnabled: true,
                  expressDeliveryDays: 2,
                  expressDeliveryPrice: 8000,
                  features: ['Master pipe overhaul', 'Complete shower installation', 'All materials verification', 'Priority support', '60-day warranty']
                }
              }
            }
          ]
        }
      }
    },
    include: { wallet: true, providerProfile: true }
  });

  console.log('--- Database Reset & Seeding Completed Successfully! ---');
  console.log('\n=============================================');
  console.log('TEST CLIENT CREDENTIALS (For Apple / Testing):');
  console.log('Email:    test.client@usefixam.com');
  console.log('Phone:    670000001 (or +237670000001)');
  console.log('Password: Password123!');
  console.log('Coins:    100 Coins');
  console.log('=============================================');
  console.log('TEST PROVIDER CREDENTIALS:');
  console.log('Email:    test.provider@usefixam.com');
  console.log('Phone:    670000002 (or +237670000002)');
  console.log('Password: Password123!');
  console.log('Status:   Verified Pro (with sample portfolio)');
  console.log('=============================================\n');
}

main()
  .catch((e) => {
    console.error('Error during reset & seed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
