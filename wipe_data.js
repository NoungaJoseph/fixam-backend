const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function wipeData() {
  console.log('Starting data wipe...');
  try {
    const nonAdmins = await prisma.user.findMany({
      where: { role: { not: 'ADMIN' } },
      select: { id: true }
    });
    
    const userIds = nonAdmins.map(u => u.id);
    if (userIds.length === 0) return console.log('No users to delete. Exiting.');

    await prisma.notification.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.review.deleteMany({ where: { OR: [{ reviewerId: { in: userIds } }, { targetUserId: { in: userIds } }] } });
    await prisma.message.deleteMany({ where: { senderId: { in: userIds } } });
    await prisma.conversationParticipant.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.supportConversation.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.payment.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.coinPurchase.deleteMany({ where: { userId: { in: userIds } } });
    
    const wallets = await prisma.wallet.findMany({ where: { userId: { in: userIds } }, select: { id: true } });
    const walletIds = wallets.map(w => w.id);
    if (walletIds.length > 0) {
      await prisma.transaction.deleteMany({ where: { walletId: { in: walletIds } } });
      await prisma.wallet.deleteMany({ where: { id: { in: walletIds } } });
    }

    const providers = await prisma.providerProfile.findMany({ where: { userId: { in: userIds } }, select: { id: true } });
    const providerIds = providers.map(p => p.id);
    if (providerIds.length > 0) {
      await prisma.verificationDocument.deleteMany({ where: { providerId: { in: providerIds } } });
      await prisma.clientFavoriteProvider.deleteMany({ where: { OR: [{ clientId: { in: userIds } }, { providerId: { in: providerIds } }] } });
      await prisma.jobAssignment.deleteMany({ where: { providerId: { in: providerIds } } });
      await prisma.providerProfile.deleteMany({ where: { id: { in: providerIds } } });
    } else {
      await prisma.clientFavoriteProvider.deleteMany({ where: { clientId: { in: userIds } } });
    }

    await prisma.booking.deleteMany({ where: { OR: [{ clientId: { in: userIds } }, { providerId: { in: userIds } }] } });

    const jobs = await prisma.job.findMany({ where: { clientId: { in: userIds } }, select: { id: true } });
    const jobIds = jobs.map(j => j.id);
    if (jobIds.length > 0) {
      await prisma.jobAssignment.deleteMany({ where: { jobId: { in: jobIds } } });
      await prisma.job.deleteMany({ where: { id: { in: jobIds } } });
    }

    await prisma.jobAssignment.deleteMany({});
    await prisma.job.deleteMany({ where: { clientId: { in: userIds } } }); 
    await prisma.$executeRawUnsafe(`DELETE FROM "_BlockedUsers" WHERE "A" IN (SELECT id FROM "User" WHERE role != 'ADMIN') OR "B" IN (SELECT id FROM "User" WHERE role != 'ADMIN')`);

    const result = await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    console.log(`Successfully deleted ${result.count} users!`);
  } catch (error) {
    console.error('Error wiping data:', error);
  } finally {
    await prisma.$disconnect();
  }
}

wipeData();
