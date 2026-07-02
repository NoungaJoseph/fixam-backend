const prisma = require('../config/prisma');
const { enrichProvidersWithStats } = require('../utils/providerStats');
const { maskProvidersPhone } = require('./provider.controller');

const getDashboardData = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const role = req.user.role?.toUpperCase(); // 'CLIENT' or 'PROVIDER' or 'ADMIN'
    const userCountry = req.user.country || 'Cameroon';

    // Fast ETag check
    const [latestJob, latestBooking, latestTx, latestConv] = await Promise.all([
      prisma.job.findFirst({
        where: role === 'PROVIDER' 
          ? { OR: [
              { status: 'PENDING', approvalStatus: 'APPROVED', assignments: { none: { provider: { userId } } } },
              { assignments: { some: { provider: { userId } } } }
            ] }
          : { clientId: userId },
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

    const popularCategoriesQuery = prisma.job.groupBy({
      by: ['category'],
      where: { country: userCountry },
      _count: { category: true },
      orderBy: { _count: { category: 'desc' } },
    });
    const myProviderProfileQuery = role === 'PROVIDER' 
      ? prisma.providerProfile.findUnique({ 
          where: { userId },
          include: { 
            monthlyStats: {
              orderBy: [
                { year: 'desc' },
                { month: 'desc' }
              ]
            }
          }
        }) 
      : Promise.resolve(null);
    
    // Run all database queries in parallel
    const [providersRaw, jobsRaw, wallet, conversationsRaw, bookings, popularCategories, myProviderProfile] = await Promise.all([
      providersQuery,
      jobsQuery,
      walletQuery,
      conversationsQuery,
      bookingsQuery,
      popularCategoriesQuery,
      myProviderProfileQuery
    ]);

    // Process Providers
    const enrichedProvidersRaw = await enrichProvidersWithStats(providersRaw);
    let providers = enrichedProvidersRaw.sort((a, b) => {
      const scoreA = (a.profileScore || 0) + (a.verification === 'VERIFIED' ? 5 : 0) + (a.user?.isOnline ? 2 : 0) + Number(a.rating || 0);
      const scoreB = (b.profileScore || 0) + (b.verification === 'VERIFIED' ? 5 : 0) + (b.user?.isOnline ? 2 : 0) + Number(b.rating || 0);
      return scoreB - scoreA;
    });

    providers = maskProvidersPhone(providers);

    if (role === 'CLIENT') {
      const activeUnlocks = await prisma.unlockedProvider.findMany({
        where: { clientId: userId, expiresAt: { gt: new Date() } },
        include: { provider: { select: { id: true, user: { select: { phone: true } } } } }
      });
      
      const unlockMap = {};
      activeUnlocks.forEach(u => {
        if (u.provider?.user?.phone) unlockMap[u.providerId] = u.provider.user.phone;
      });

      providers = providers.map(p => {
        if (unlockMap[p.id]) {
          return {
            ...p,
            phoneUnlocked: true,
            user: { ...p.user, phone: unlockMap[p.id] }
          };
        }
        return p;
      });
    }

    // Process Wallet stats (mimicking wallet.controller.js)
    let thisMonthTxStats = { _sum: { amount: 0 } };
    const now = new Date();
    const firstDayOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    if (wallet) {
      thisMonthTxStats = await prisma.transaction.aggregate({
        _count: { id: true },
        _sum: { amount: true },
        where: { walletId: wallet.id, status: 'SUCCESS', createdAt: { gte: firstDayOfMonth } }
      });
    }

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

    const completedJobs = await prisma.job.count({
      where: {
        status: 'COMPLETED',
        OR: [
          { clientId: userId },
          { assignments: { some: { provider: { userId } } } }
        ]
      }
    });
    const completedBookings = await prisma.booking.count({
      where: {
        status: 'COMPLETED',
        OR: [
          { clientId: userId },
          { providerId: userId }
        ]
      }
    });
    const completedTasks = completedJobs + completedBookings;
    
    let nextLevelTasks = 5;
    if (completedTasks >= 5) nextLevelTasks = 10;
    if (completedTasks >= 10) nextLevelTasks = 20;
    if (completedTasks >= 20) nextLevelTasks = 50;
    if (completedTasks >= 50) nextLevelTasks = Math.floor(completedTasks / 10) * 10 + 10;
    
    const progressPercent = Math.min(100, Math.round((completedTasks / nextLevelTasks) * 100));
    
    let enrichedWallet = {
      ...(wallet || { balance: 0 }),
      thisMonthTransactions: completedTasksCount,
      thisMonthSpent: Math.abs(thisMonthTxStats._sum.amount || 0),
      completedTasks,
      nextLevelTasks,
      progressPercent
    };

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

    // Enrich provider jobs with client spending tier + review count
    let finalJobs = jobsRaw;
    if (role === 'PROVIDER' && jobsRaw.length > 0) {
      const clientIds = [...new Set(jobsRaw.map(j => j.clientId))];

      const [wallets, spendingData, reviewCounts] = await Promise.all([
        prisma.wallet.findMany({ where: { userId: { in: clientIds } }, select: { id: true, userId: true } }),
        prisma.transaction.groupBy({
          by: ['walletId'],
          where: { type: 'DEDUCTION', status: 'SUCCESS', wallet: { userId: { in: clientIds } } },
          _sum: { amount: true }
        }),
        prisma.review.groupBy({
          by: ['targetUserId'],
          where: { targetUserId: { in: clientIds } },
          _count: { id: true }
        })
      ]);

      const walletToUser = new Map(wallets.map(w => [w.id, w.userId]));
      const userSpending = new Map();
      spendingData.forEach(s => {
        const uid = walletToUser.get(s.walletId);
        if (uid) userSpending.set(uid, Math.abs(s._sum.amount || 0));
      });
      const userReviews = new Map(reviewCounts.map(r => [r.targetUserId, r._count.id]));

      const getSpendingTier = (amount) => {
        if (amount >= 100000) return '100k+ spent';
        if (amount >= 50000) return '50k+ spent';
        if (amount >= 10000) return '10k+ spent';
        if (amount >= 2000) return '2k+ spent';
        return 'New client';
      };

      finalJobs = jobsRaw.map(job => ({
        ...job,
        clientVerified: job.client?.providerProfile?.verification === 'VERIFIED',
        clientSpending: userSpending.get(job.clientId) || 0,
        clientSpendingTier: getSpendingTier(userSpending.get(job.clientId) || 0),
        clientReviewCount: userReviews.get(job.clientId) || 0,
      }));
    }

    res.status(200).json({
      success: true,
      data: {
        providers,
        jobs: finalJobs,
        wallet: enrichedWallet,
        conversations,
        transactions,
        bookings,
        popularCategories,
        ...(role === 'PROVIDER' && myProviderProfile ? { myProviderProfile } : {})
      }
    });

  } catch (error) {
    next(error);
  }
};

module.exports = { getDashboardData };
