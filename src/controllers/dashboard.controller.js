const prisma = require('../config/prisma');
const { enrichProvidersWithStats } = require('../utils/providerStats');

const getDashboardData = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const role = req.user.role?.toUpperCase(); // 'CLIENT' or 'PROVIDER' or 'ADMIN'

    // Fast ETag check
    const [latestJob, latestBooking, latestTx, latestConv] = await Promise.all([
      prisma.job.findFirst({
        where: role === 'PROVIDER' ? { status: 'PENDING', approvalStatus: 'APPROVED', assignments: { none: { provider: { userId } } } } : { clientId: userId },
        orderBy: { updatedAt: 'desc' },
        select: { updatedAt: true }
      }),
      role === 'CLIENT' ? prisma.booking.findFirst({
        where: { clientId: userId },
        orderBy: { updatedAt: 'desc' },
        select: { updatedAt: true }
      }) : Promise.resolve(null),
      prisma.transaction.findFirst({
        where: { wallet: { userId } },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true }
      }),
      prisma.conversation.findFirst({
        where: { participants: { some: { userId } } },
        orderBy: { updatedAt: 'desc' },
        select: { updatedAt: true }
      })
    ]);

    const lastUpdated = Math.max(
      latestJob?.updatedAt?.getTime() || 0,
      latestBooking?.updatedAt?.getTime() || 0,
      latestTx?.createdAt?.getTime() || 0,
      latestConv?.updatedAt?.getTime() || 0
    );

    const etag = `W/"${lastUpdated}-${role}"`;
    if (req.headers['if-none-match'] === etag) {
      return res.status(304).end();
    }
    res.setHeader('ETag', etag);

    // 1. Providers Query
    const providersQuery = prisma.providerProfile.findMany({
      where: { profileMode: 'WORK' },
      include: {
        user: { select: { id: true, fullName: true, avatar: true, isOnline: true, phone: true } }
      },
      orderBy: { rating: 'desc' },
      take: 20
    });

    // 2. Jobs Query
    let jobsQuery;
    if (role === 'PROVIDER') {
      jobsQuery = prisma.job.findMany({
        where: {
          status: 'PENDING',
          approvalStatus: 'APPROVED',
          assignments: { none: { provider: { userId } } }
        },
        include: {
          client: { select: { id: true, fullName: true, avatar: true } },
          assignments: { include: { provider: { include: { user: { select: { id: true, fullName: true, avatar: true } } } } } },
        },
        orderBy: { createdAt: 'desc' },
        take: 10
      });
    } else {
      jobsQuery = prisma.job.findMany({
        where: { clientId: userId },
        include: {
          client: { select: { id: true, fullName: true, avatar: true } },
          assignments: { include: { provider: { include: { user: { select: { id: true, fullName: true, avatar: true } } } } } },
          reviews: true
        },
        orderBy: { createdAt: 'desc' }
      });
    }

    // 3. Wallet Balance & Stats Query
    const walletQuery = prisma.wallet.findUnique({
      where: { userId },
      include: { transactions: { orderBy: { createdAt: 'desc' }, take: 10 } }
    });

    // 4. Conversations Query
    const conversationsQuery = prisma.conversation.findMany({
      where: { participants: { some: { userId } } },
      select: {
        id: true,
        lastMessageAt: true,
        createdAt: true,
        updatedAt: true,
        participants: {
          select: {
            userId: true,
            unreadCount: true,
            user: { select: { id: true, fullName: true, phone: true, avatar: true, isOnline: true, role: true, providerProfile: { select: { profileMode: true } } } }
          }
        },
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { id: true, content: true, createdAt: true, type: true, deliveredAt: true, readAt: true, isRead: true }
        }
      },
      orderBy: { lastMessageAt: 'desc' }
    });

    // 5. Bookings Query (only if CLIENT)
    let bookingsQuery = Promise.resolve([]);
    if (role === 'CLIENT') {
      bookingsQuery = prisma.booking.findMany({
        where: { clientId: userId },
        include: {
          client: { select: { id: true, fullName: true, avatar: true, phone: true } },
          provider: { select: { id: true, fullName: true, avatar: true, phone: true } },
          task: { select: { id: true, title: true, status: true, budget: true } }
        },
        orderBy: { createdAt: 'desc' }
      });
    }

    // Run all database queries in parallel
    const [providersRaw, jobsRaw, wallet, conversationsRaw, bookings] = await Promise.all([
      providersQuery,
      jobsQuery,
      walletQuery,
      conversationsQuery,
      bookingsQuery
    ]);

    // Process Providers
    const enrichedProvidersRaw = await enrichProvidersWithStats(providersRaw);
    const providers = enrichedProvidersRaw.sort((a, b) => {
      const scoreA = (a.profileScore || 0) + (a.verification === 'VERIFIED' ? 5 : 0) + (a.user?.isOnline ? 2 : 0) + Number(a.rating || 0);
      const scoreB = (b.profileScore || 0) + (b.verification === 'VERIFIED' ? 5 : 0) + (b.user?.isOnline ? 2 : 0) + Number(b.rating || 0);
      return scoreB - scoreA;
    });

    // Process Wallet stats (mimicking wallet.controller.js)
    let enrichedWallet = { balance: 0, thisMonthTransactions: 0, thisMonthSpent: 0, completedTasks: 0, nextLevelTasks: 5, progressPercent: 0 };
    if (wallet) {
      const now = new Date();
      const firstDayOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      
      const thisMonthTxStats = await prisma.transaction.aggregate({
        _count: { id: true },
        _sum: { amount: true },
        where: { walletId: wallet.id, status: 'SUCCESS', createdAt: { gte: firstDayOfMonth } }
      });

      const completedJobsCount = await prisma.job.count({
        where: {
          status: 'COMPLETED',
          updatedAt: { gte: firstDayOfMonth },
          OR: [
            { clientId: userId },
            { assignments: { some: { provider: { userId } } } }
          ]
        }
      });

      const completedBookingsCount = await prisma.booking.count({
        where: {
          status: 'COMPLETED',
          updatedAt: { gte: firstDayOfMonth },
          OR: [
            { clientId: userId },
            { providerId: userId }
          ]
        }
      });

      const completedTasksCount = completedJobsCount + completedBookingsCount;

      const completedJobs = await prisma.job.count({ where: { clientId: userId, status: 'COMPLETED' } });
      const completedBookings = await prisma.booking.count({ where: { clientId: userId, status: 'COMPLETED' } });
      const completedTasks = completedJobs + completedBookings;
      
      let nextLevelTasks = 5;
      if (completedTasks >= 5) nextLevelTasks = 10;
      if (completedTasks >= 10) nextLevelTasks = 20;
      if (completedTasks >= 20) nextLevelTasks = 50;
      if (completedTasks >= 50) nextLevelTasks = Math.floor(completedTasks / 10) * 10 + 10;
      
      const progressPercent = Math.min(100, Math.round((completedTasks / nextLevelTasks) * 100));
      enrichedWallet = {
        ...wallet,
        thisMonthTransactions: completedTasksCount,
        thisMonthSpent: Math.abs(thisMonthTxStats._sum.amount || 0),
        completedTasks,
        nextLevelTasks,
        progressPercent
      };
    }

    // Process Conversations
    const conversations = conversationsRaw.map((conv) => ({
      id: conv.id,
      lastMessageAt: conv.lastMessageAt,
      createdAt: conv.createdAt,
      updatedAt: conv.updatedAt,
      participants: conv.participants.filter((p) => p.userId !== userId).map((p) => p.user),
      lastMessage: conv.messages[0] || null,
      unreadCount: conv.participants.find((p) => p.userId === userId)?.unreadCount || 0,
      activeTask: null,
    }));

    // Transactions extracted from wallet (take 10 is enough for dashboard)
    const transactions = wallet?.transactions || [];

    res.status(200).json({
      success: true,
      data: {
        providers,
        jobs: jobsRaw,
        wallet: enrichedWallet,
        conversations,
        transactions,
        bookings
      }
    });

  } catch (error) {
    next(error);
  }
};

module.exports = { getDashboardData };
