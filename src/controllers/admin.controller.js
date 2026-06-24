const prisma = require('../config/prisma');
const getSupportConversations = async (req, res, next) => {
  try {
    const conversations = await prisma.conversation.findMany({
      where: {
        participants: {
          some: { userId: req.user.id }
        }
      },
      select: {
        id: true,
        lastMessageAt: true,
        createdAt: true,
        participants: {
          select: {
            userId: true,
            unreadCount: true,
            user: {
              select: {
                id: true,
                fullName: true,
                email: true,
                phone: true,
                role: true,
                avatar: true,
                isOnline: true
              }
            }
          }
        },
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { id: true, content: true, createdAt: true, type: true }
        }
      },
      orderBy: { lastMessageAt: 'desc' }
    });

    const formatted = conversations
      .map((conversation) => {
        const other = conversation.participants.find((participant) => participant.userId !== req.user.id);
        return {
          id: conversation.id,
          lastMessageAt: conversation.lastMessageAt,
          createdAt: conversation.createdAt,
          user: other?.user,
          unreadCount: conversation.participants.find((participant) => participant.userId === req.user.id)?.unreadCount || 0,
          lastMessage: conversation.messages[0] || null,
          isSupport: true
        };
      })
      .filter((conversation) => conversation.user && conversation.user.role !== 'ADMIN');

    res.status(200).json({ success: true, data: formatted });
  } catch (error) {
    next(error);
  }
};
const { getIO } = require('../services/socket.service');
const { sendEmail, sendMarketingBroadcast, sendSecurityNotice } = require('../services/email.service');
const { sendPushNotification } = require('../services/notification.service');

const toNumber = (val) => Number(val) || 0;

const giveWelcomeCoins = async (userId, coins, reason) => {
  try {
    let wallet = await prisma.wallet.findUnique({ where: { userId } });
    if (!wallet) {
      wallet = await prisma.wallet.create({ data: { userId, balance: 0 } });
    }
    await prisma.wallet.update({
      where: { id: wallet.id },
      data: { balance: { increment: coins } }
    });
    await prisma.transaction.create({
      data: {
        walletId: wallet.id,
        amount: coins,
        type: 'PURCHASE',
        status: 'SUCCESS',
        description: reason,
        reference: 'WELCOME_' + userId + '_' + Date.now()
      }
    });
    
    await sendPushNotification(
      userId,
      coins === 1 ? '🎉 Welcome to Fixam!' : '🎁 Identity Verified!',
      coins === 1 ? 'You received 1 free coin for joining Fixam!' : 'You received 2 free coins for verifying your identity!',
      { type: 'COINS_ADDED', coins: String(coins) }
    ).catch(() => {});
    console.log(`[Welcome] ${coins} coin(s) awarded to ${userId}: ${reason}`);
  } catch (error) {
    console.error('[Welcome Coins] Error:', error.message);
  }
};

const verifyProvider = async (req, res, next) => {
  try {
    const { providerId, status, reason } = req.body; // VERIFIED, REJECTED

    const profile = await prisma.providerProfile.update({
      where: { id: providerId },
      data: { verification: status },
      include: { user: true }
    });

    const isVerified = status === 'VERIFIED';
    
    if (isVerified && !profile.user.verificationCoinsGiven) {
      await giveWelcomeCoins(profile.user.id, 2, 'Identity verification reward — 2 bonus coins');
      await prisma.user.update({
        where: { id: profile.user.id },
        data: { verificationCoinsGiven: true }
      });
    }

    const titleEn = isVerified ? 'Identity Verification Approved' : 'Verification Needs Attention';
    const titleFr = isVerified ? 'Vérification d\'identité approuvée' : 'La vérification nécessite votre attention';
    
    const bodyEn = isVerified
      ? 'Congratulations! Your Fixam identity has been successfully verified. You can now receive and accept more jobs on the platform.'
      : `We could not approve your verification yet.${reason ? ` Reason: ${reason}` : ' Please submit clearer documents and try again.'}`;
      
    const bodyFr = isVerified
      ? 'Félicitations ! L\'identité de votre profil Fixam a été vérifiée avec succès. Vous pouvez désormais recevoir et accepter plus de tâches sur la plateforme.'
      : `Nous n'avons pas pu approuver votre vérification pour le moment.${reason ? ` Raison : ${reason}` : ' Veuillez soumettre des documents plus clairs et réessayer.'}`;

    const pushTitle = `${titleEn} / ${titleFr}`;
    const pushBody = `${bodyEn}\n\n${bodyFr}`;

    // Create Notification
    const notification = await prisma.notification.create({
      data: {
        userId: profile.userId,
        title: pushTitle,
        body: pushBody,
        data: { type: 'VERIFICATION', status, reason }
      }
    });

    try {
      const io = getIO();
      io.to(profile.userId).emit('notification:new', notification);
    } catch (err) {
      console.error('[Socket Error] Verification notification emit failed:', err.message);
    }

    // Send FCM Push Notification
    await sendPushNotification(
      profile.userId,
      pushTitle,
      pushBody,
      { type: 'VERIFICATION', status, reason: String(reason || '') }
    ).catch(err => console.error('[Push Error] Verification push failed:', err.message));


    if (profile.user.email) {
      sendEmail({
        email: profile.user.email,
        subject: `Fixam - ${titleEn} | ${titleFr}`,
        message: `${bodyEn}\n\n${bodyFr}`,
        html: `
          <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: auto; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden; background-color: #ffffff;">
            <div style="background-color: ${isVerified ? '#22C55E' : '#EF4444'}; color: #ffffff; padding: 24px; text-align: center;">
              <h1 style="margin: 0; font-size: 24px; font-weight: 800;">Fixam</h1>
              <p style="margin: 5px 0 0; font-size: 16px; opacity: 0.9;">Identity Verification / Vérification d'identité</p>
            </div>
            
            <div style="padding: 32px 24px;">
              <!-- English Section -->
              <div style="margin-bottom: 30px;">
                <h2 style="margin: 0 0 12px; color: #0f172a; font-size: 20px;">${titleEn}</h2>
                <p style="margin: 0; color: #475569; font-size: 16px; line-height: 1.6;">${bodyEn}</p>
                ${!isVerified ? `<p style="margin: 16px 0 0; color: #0f172a; font-weight: 600;">Please open the Fixam app to retry.</p>` : ''}
              </div>

              <hr style="border: 0; border-top: 1px solid #e2e8f0; margin: 0 0 30px;" />

              <!-- French Section -->
              <div style="margin-bottom: 10px;">
                <h2 style="margin: 0 0 12px; color: #0f172a; font-size: 20px;">${titleFr}</h2>
                <p style="margin: 0; color: #475569; font-size: 16px; line-height: 1.6;">${bodyFr}</p>
                ${!isVerified ? `<p style="margin: 16px 0 0; color: #0f172a; font-weight: 600;">Veuillez ouvrir l'application Fixam pour réessayer.</p>` : ''}
              </div>
            </div>
            
            <div style="background-color: #f8fafc; padding: 20px; text-align: center; color: #64748b; font-size: 13px;">
              <p style="margin: 0;">&copy; ${new Date().getFullYear()} Fixam. All rights reserved. / Tous droits réservés.</p>
            </div>
          </div>
        `
      }).catch((err) => console.error('[Email Error] Verification email failed:', err.message));
    }

    // Emit Socket Event
    try {
      const io = getIO();
      io.to(profile.userId).emit('notification:new', notification);
    } catch (err) {
      console.error('[Socket Error] Verification notification failed:', err.message);
    }

    res.status(200).json({ success: true, data: profile });
  } catch (error) {
    next(error);
  }
};

const approveTransaction = async (req, res, next) => {
  try {
    const { transactionId, status } = req.body; // SUCCESS, FAILED
    const allowedStatuses = ['SUCCESS', 'FAILED'];

    if (!transactionId || !allowedStatuses.includes(status)) {
      return res.status(400).json({ success: false, message: 'Transaction ID and a valid status are required' });
    }

    const transaction = await prisma.transaction.findUnique({
      where: { id: transactionId },
      include: { wallet: { include: { user: true } } }
    });

    if (!transaction) {
      return res.status(400).json({ success: false, message: 'Invalid transaction' });
    }

    if (transaction.status !== 'PENDING') {
      if (transaction.status === status) {
        return res.status(200).json({
          success: true,
          data: transaction,
          message: `Transaction already ${status.toLowerCase()}`
        });
      }

      return res.status(400).json({
        success: false,
        message: `Transaction has already been ${transaction.status.toLowerCase()}`
      });
    }

    const updatedTransaction = await prisma.$transaction(async (tx) => {
      const claimed = await tx.transaction.updateMany({
        where: { id: transactionId, status: 'PENDING' },
        data: { status }
      });

      if (!claimed.count) {
        return tx.transaction.findUnique({ where: { id: transactionId } });
      }

      if (status === 'SUCCESS') {
        await tx.wallet.update({
          where: { id: transaction.walletId },
          data: { balance: { increment: transaction.amount } }
        });
      }

      return tx.transaction.findUnique({ where: { id: transactionId } });
    });

    // Create Notification
    const notification = await prisma.notification.upsert({
      where: { id: `${transaction.id}-${status}` },
      update: {},
      create: {
        id: `${transaction.id}-${status}`,
        userId: transaction.wallet.userId,
        title: status === 'SUCCESS' ? 'Payment Approved' : 'Payment Rejected',
        body: status === 'SUCCESS'
          ? `Your purchase of ${transaction.amount} coins was approved. Your wallet balance has been updated.`
          : 'Your coin purchase request was rejected. Please contact support for more details.',
        data: { type: 'TRANSACTION', transactionId: transaction.id, status }
      }
    });

    // Emit Socket Event
    try {
      const io = getIO();
      io.to(transaction.wallet.userId).emit('notification:new', notification);
      
      // Also emit balance update
      if (status === 'SUCCESS') {
        const wallet = await prisma.wallet.findUnique({ where: { id: transaction.walletId } });
        io.to(transaction.wallet.userId).emit('wallet:update', { 
          balance: wallet?.balance ?? transaction.wallet.balance + transaction.amount
        });
      }
    } catch (err) {
      console.error('[Socket Error] Transaction notification failed:', err.message);
    }

    res.status(200).json({ success: true, data: updatedTransaction });
  } catch (error) {
    next(error);
  }
};

const getDashboardStats = async (req, res, next) => {
  try {
    const [
      totalUsers,
      totalProviders,
      totalJobs,
      activeJobs,
      completedJobs,
      pendingApprovals,
      totalReports,
      openReports,
      totalFeedback,
      newFeedback,
      recentSignups,
      recentBroadcasts,
      revenueRows,
      monthlyCoinSales
    ] = await prisma.$transaction([
      prisma.user.count({ where: { role: 'CLIENT' } }),
      prisma.user.count({ where: { role: 'PROVIDER' } }),
      prisma.job.count(),
      prisma.job.count({ where: { status: 'IN_PROGRESS' } }),
      prisma.job.count({ where: { status: 'COMPLETED' } }),
      prisma.job.count({ where: { approvalStatus: 'PENDING_APPROVAL' } }),
      prisma.report.count(),
      prisma.report.count({ where: { status: 'PENDING' } }),
      prisma.feedback.count(),
      prisma.feedback.count({ where: { status: 'NEW' } }),
      prisma.user.findMany({
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: { id: true, fullName: true, phone: true, role: true, avatar: true, createdAt: true }
      }),
      prisma.adminMessage.findMany({
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: { id: true, subject: true, content: true, recipientRole: true, createdAt: true }
      }),
      prisma.$queryRaw`
        SELECT COALESCE(SUM(NULLIF(regexp_replace("paidPrice", '[^0-9.]', '', 'g'), '')::float), 0) AS revenue
        FROM "Transaction"
        WHERE type = 'PURCHASE' AND status = 'SUCCESS'
      `,
      prisma.$queryRaw`
        SELECT
          date_trunc('month', "createdAt")::date AS month,
          COALESCE(SUM(amount), 0) AS "coinsPurchased",
          COALESCE(SUM(NULLIF(regexp_replace("paidPrice", '[^0-9.]', '', 'g'), '')::float), 0) AS "revenueFCFA"
        FROM "Transaction"
        WHERE type = 'PURCHASE'
          AND status = 'SUCCESS'
          AND "createdAt" >= date_trunc('month', CURRENT_DATE) - interval '5 months'
        GROUP BY date_trunc('month', "createdAt")::date
        ORDER BY month ASC
      `
    ]);

    const revenue = toNumber(revenueRows[0]?.revenue);

    res.status(200).json({
      success: true,
      data: {
        totalUsers,
        totalProviders,
        totalJobs,
        activeJobs,
        completedJobs,
        totalRevenue: revenue,
        pendingApprovals,
        pendingTaskApprovals: pendingApprovals,
        totalReports,
        openReports,
        pendingDisputes: openReports,
        totalFeedback,
        newFeedback,
        recentSignups,
        recentBroadcasts,
        monthlyCoinSales: monthlyCoinSales.map((row) => ({
          month: new Date(row.month).toLocaleDateString('en-US', { month: 'short' }),
          coinsPurchased: toNumber(row.coinsPurchased),
          revenueFCFA: toNumber(row.revenueFCFA)
        })),
        users: totalUsers,
        jobs: totalJobs,
        completed: completedJobs,
        reports: totalReports,
        revenue,
        monthlyRevenue: monthlyCoinSales.length > 0 ? toNumber(monthlyCoinSales[monthlyCoinSales.length - 1].revenueFCFA) : 0,
        monthlyCoins: monthlyCoinSales.length > 0 ? toNumber(monthlyCoinSales[monthlyCoinSales.length - 1].coinsPurchased) : 0
      }
    });
  } catch (error) {
    next(error);
  }
};

const getUsers = async (req, res, next) => {
  try {
    const users = await prisma.user.findMany({
      include: { wallet: true, providerProfile: true },
      orderBy: { createdAt: 'desc' },
      take: 50
    });
    res.status(200).json({ success: true, data: users });
  } catch (error) {
    next(error);
  }
};

const getUserDetails = async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.params.id },
      include: {
        wallet: { include: { transactions: { orderBy: { createdAt: 'desc' }, take: 25 } } },
        providerProfile: { include: { documents: true } },
        jobsAsClient: { orderBy: { createdAt: 'desc' }, take: 25 },
        notifications: { orderBy: { createdAt: 'desc' }, take: 25 }
      }
    });

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    res.status(200).json({ success: true, data: user });
  } catch (error) {
    next(error);
  }
};

const updateUserStatus = async (req, res, next) => {
  try {
    const { isBlocked, reason } = req.body;
    const user = await prisma.user.update({
      where: { id: req.params.id },
      data: {
        isBlocked: Boolean(isBlocked),
        blockedReason: isBlocked ? (reason || 'Blocked by admin') : null,
        blockedAt: isBlocked ? new Date() : null
      },
      include: { wallet: true, providerProfile: true }
    });

    const notification = await prisma.notification.create({
      data: {
        userId: user.id,
        title: isBlocked ? 'Account blocked' : 'Account restored',
        body: isBlocked
          ? `Your Fixam account has been blocked.${reason ? ` Reason: ${reason}` : ''}`
          : 'Your Fixam account has been restored.',
        data: { type: 'ACCOUNT', status: isBlocked ? 'BLOCKED' : 'ACTIVE' }
      }
    });

    try {
      const io = getIO();
      io.to(user.id).emit('notification:new', notification);
    } catch (err) {
      console.error('[Socket Error] User status notification failed:', err.message);
    }

    res.status(200).json({ success: true, data: user });
  } catch (error) {
    next(error);
  }
};

const getProviders = async (req, res, next) => {
  try {
    const providers = await prisma.providerProfile.findMany({
      include: { 
        user: true, 
        documents: true 
      },
      orderBy: { user: { createdAt: 'desc' } },
      take: 50
    });
    res.status(200).json({ success: true, data: providers });
  } catch (error) {
    next(error);
  }
};

const getPendingTransactions = async (req, res, next) => {
  try {
    const transactions = await prisma.transaction.findMany({
      where: { status: 'PENDING' },
      include: { wallet: { include: { user: true } } },
      orderBy: { createdAt: 'desc' }
    });
    res.status(200).json({ success: true, data: transactions });
  } catch (error) {
    next(error);
  }
};

const getTransactions = async (req, res, next) => {
  try {
    const transactions = await prisma.transaction.findMany({
      include: { wallet: { include: { user: true } } },
      orderBy: { createdAt: 'desc' },
      take: 50
    });
    res.status(200).json({ success: true, data: transactions });
  } catch (error) {
    next(error);
  }
};

const getFinancialStats = async (req, res, next) => {
  try {
    const [payments, activePayments, successCount, pendingCount, failedCount] = await Promise.all([
      prisma.payment.findMany({
        include: {
          user: { select: { id: true, fullName: true, phone: true, email: true, avatar: true } },
          transaction: true
        },
        orderBy: { createdAt: 'asc' },
        take: 1000
      }),
      prisma.payment.count({ where: { status: { in: ['PENDING', 'PROCESSING'] } } }),
      prisma.payment.count({ where: { status: 'SUCCESS' } }),
      prisma.payment.count({ where: { status: { in: ['PENDING', 'PROCESSING'] } } }),
      prisma.payment.count({ where: { status: 'FAILED' } })
    ]);

    const successfulPayments = payments.filter((payment) => payment.status === 'SUCCESS');

    const sumPaid = (tx) => {
      return Number(tx.amount || 0);
    };

    const buildBuckets = (mode) => successfulPayments.reduce((acc, tx) => {
      const date = new Date(tx.createdAt);
      let key = date.toISOString().slice(0, 10);
      if (mode === 'weekly') {
        const first = new Date(date);
        first.setDate(date.getDate() - date.getDay());
        key = first.toISOString().slice(0, 10);
      } else if (mode === 'monthly') {
        key = date.toISOString().slice(0, 7);
      }
      if (!acc[key]) acc[key] = { period: key, coins: 0, revenue: 0, count: 0 };
      acc[key].coins += Math.abs(tx.coins || 0);
      acc[key].revenue += sumPaid(tx);
      acc[key].count += 1;
      return acc;
    }, {});

    const methodStats = payments.reduce((acc, payment) => {
      const key = payment.paymentMethod || 'UNKNOWN';
      if (!acc[key]) acc[key] = { method: key, count: 0, revenue: 0, success: 0, failed: 0, pending: 0 };
      acc[key].count += 1;
      if (payment.status === 'SUCCESS') {
        acc[key].success += 1;
        acc[key].revenue += payment.amount;
      } else if (payment.status === 'FAILED') {
        acc[key].failed += 1;
      } else {
        acc[key].pending += 1;
      }
      return acc;
    }, {});

    const totalRevenue = successfulPayments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0);

    res.status(200).json({
      success: true,
      data: {
        daily: Object.values(buildBuckets('daily')),
        weekly: Object.values(buildBuckets('weekly')),
        monthly: Object.values(buildBuckets('monthly')),
        transactions: payments,
        methodStats: Object.values(methodStats),
        widgets: {
          totalRevenue,
          activePayments,
          successfulTransactions: successCount,
          pendingTransactions: pendingCount,
          failedTransactions: failedCount
        }
      }
    });
  } catch (error) {
    next(error);
  }
};

const formatDateKey = (date) => date.toISOString().slice(0, 10);

const getWalletStats = async (req, res, next) => {
  try {
    const now = new Date();
    const dailyStart = new Date(now);
    dailyStart.setDate(now.getDate() - 29);
    dailyStart.setHours(0, 0, 0, 0);

    const monthlyStart = new Date(now.getFullYear(), now.getMonth() - 11, 1);
    const weeklyStart = new Date(now);
    weeklyStart.setDate(now.getDate() - 7 * 7);
    weeklyStart.setHours(0, 0, 0, 0);

    const [
      overviewRows,
      dailyRows,
      weeklyRows,
      monthlyRows,
      recentTransactions
    ] = await Promise.all([
      prisma.$queryRaw`
        SELECT
          COALESCE(SUM(CASE WHEN status = 'SUCCESS' THEN NULLIF(regexp_replace("paidPrice", '[^0-9.]', '', 'g'), '')::float ELSE 0 END), 0) AS "totalRevenueFCFA",
          COALESCE(SUM(CASE WHEN status = 'SUCCESS' THEN amount ELSE 0 END), 0) AS "totalCoinsIssued",
          COUNT(*) AS "totalTransactions",
          COUNT(*) FILTER (WHERE status = 'SUCCESS') AS "successfulTransactions",
          COUNT(*) FILTER (WHERE status = 'PENDING') AS "pendingTransactions",
          COUNT(*) FILTER (WHERE status = 'FAILED') AS "failedTransactions"
        FROM "Transaction"
        WHERE type = 'PURCHASE'
      `,
      prisma.$queryRaw`
        SELECT
          DATE("createdAt") AS date,
          COALESCE(SUM(amount), 0) AS "coinsPurchased",
          COALESCE(SUM(NULLIF(regexp_replace("paidPrice", '[^0-9.]', '', 'g'), '')::float), 0) AS "revenueFCFA",
          COUNT(*) AS "transactionCount"
        FROM "Transaction"
        WHERE type = 'PURCHASE' AND status = 'SUCCESS' AND "createdAt" >= ${dailyStart}
        GROUP BY DATE("createdAt")
        ORDER BY date ASC
      `,
      prisma.$queryRaw`
        SELECT
          date_trunc('week', "createdAt")::date AS week,
          COALESCE(SUM(amount), 0) AS "coinsPurchased",
          COALESCE(SUM(NULLIF(regexp_replace("paidPrice", '[^0-9.]', '', 'g'), '')::float), 0) AS "revenueFCFA",
          COUNT(*) AS "transactionCount"
        FROM "Transaction"
        WHERE type = 'PURCHASE' AND status = 'SUCCESS' AND "createdAt" >= ${weeklyStart}
        GROUP BY date_trunc('week', "createdAt")::date
        ORDER BY week ASC
      `,
      prisma.$queryRaw`
        SELECT
          date_trunc('month', "createdAt")::date AS month,
          COALESCE(SUM(amount), 0) AS "coinsPurchased",
          COALESCE(SUM(NULLIF(regexp_replace("paidPrice", '[^0-9.]', '', 'g'), '')::float), 0) AS "revenueFCFA",
          COUNT(*) AS "transactionCount"
        FROM "Transaction"
        WHERE type = 'PURCHASE' AND status = 'SUCCESS' AND "createdAt" >= ${monthlyStart}
        GROUP BY date_trunc('month', "createdAt")::date
        ORDER BY month ASC
      `,
      prisma.transaction.findMany({
        where: { type: 'PURCHASE' },
        include: { wallet: { include: { user: { select: { fullName: true, phone: true } } } } },
        orderBy: { createdAt: 'desc' },
        take: 20
      })
    ]);

    const dailyMap = new Map(dailyRows.map((row) => [formatDateKey(new Date(row.date)), row]));
    const daily = Array.from({ length: 30 }, (_, index) => {
      const date = new Date(dailyStart);
      date.setDate(dailyStart.getDate() + index);
      const key = formatDateKey(date);
      const row = dailyMap.get(key);
      return {
        date: key,
        coinsPurchased: toNumber(row?.coinsPurchased),
        revenueFCFA: toNumber(row?.revenueFCFA),
        transactionCount: toNumber(row?.transactionCount)
      };
    });

    const weekly = weeklyRows.map((row) => ({
      week: `Week of ${new Date(row.week).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`,
      coinsPurchased: toNumber(row.coinsPurchased),
      revenueFCFA: toNumber(row.revenueFCFA),
      transactionCount: toNumber(row.transactionCount)
    }));

    const monthly = monthlyRows.map((row) => ({
      month: new Date(row.month).toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
      coinsPurchased: toNumber(row.coinsPurchased),
      revenueFCFA: toNumber(row.revenueFCFA),
      transactionCount: toNumber(row.transactionCount)
    }));

    const overview = overviewRows[0] || {};

    res.status(200).json({
      success: true,
      data: {
        overview: {
          totalRevenueFCFA: toNumber(overview.totalRevenueFCFA),
          totalCoinsIssued: toNumber(overview.totalCoinsIssued),
          totalTransactions: toNumber(overview.totalTransactions),
          successfulTransactions: toNumber(overview.successfulTransactions),
          pendingTransactions: toNumber(overview.pendingTransactions),
          failedTransactions: toNumber(overview.failedTransactions)
        },
        daily,
        weekly,
        monthly,
        recentTransactions: recentTransactions.map((transaction) => ({
          id: transaction.id,
          userPhone: transaction.wallet?.user?.phone || transaction.payerPhone || '',
          userName: transaction.wallet?.user?.fullName || transaction.payerName || 'Unknown user',
          coins: transaction.amount,
          amountFCFA: transaction.paidPrice || '0',
          status: transaction.status,
          createdAt: transaction.createdAt
        }))
      }
    });
  } catch (error) {
    next(error);
  }
};

const getAnalytics = async (req, res, next) => {
  try {
    const [
      userGrowthRows,
      jobStatsRows,
      revenueRows,
      categoryRows,
      totalJobs,
      verificationRows,
      avgRating,
      topProviders,
      completedJobs,
      activeUsers
    ] = await Promise.all([
      prisma.$queryRaw`
        SELECT
          date_trunc('month', "createdAt")::date AS month,
          COUNT(*) FILTER (WHERE role = 'CLIENT') AS "newUsers",
          COUNT(*) FILTER (WHERE role = 'PROVIDER') AS "newProviders"
        FROM "User"
        WHERE "createdAt" >= date_trunc('month', CURRENT_DATE) - interval '11 months'
        GROUP BY date_trunc('month', "createdAt")::date
        ORDER BY month ASC
      `,
      prisma.$queryRaw`
        SELECT
          date_trunc('month', "createdAt")::date AS month,
          COUNT(*) AS posted,
          COUNT(*) FILTER (WHERE status = 'COMPLETED') AS completed,
          COUNT(*) FILTER (WHERE status = 'CANCELLED') AS cancelled
        FROM "Job"
        WHERE "createdAt" >= date_trunc('month', CURRENT_DATE) - interval '11 months'
        GROUP BY date_trunc('month', "createdAt")::date
        ORDER BY month ASC
      `,
      prisma.$queryRaw`
        SELECT
          date_trunc('month', "createdAt")::date AS month,
          COALESCE(SUM(NULLIF(regexp_replace("paidPrice", '[^0-9.]', '', 'g'), '')::float), 0) AS "revenueFCFA",
          COALESCE(SUM(amount), 0) AS "coinsIssued"
        FROM "Transaction"
        WHERE type = 'PURCHASE' AND status = 'SUCCESS' AND "createdAt" >= date_trunc('month', CURRENT_DATE) - interval '11 months'
        GROUP BY date_trunc('month', "createdAt")::date
        ORDER BY month ASC
      `,
      prisma.job.groupBy({ by: ['category'], _count: { category: true }, orderBy: { _count: { category: 'desc' } }, take: 10 }),
      prisma.job.count(),
      prisma.providerProfile.groupBy({ by: ['verification'], _count: { verification: true } }),
      prisma.providerProfile.aggregate({ _avg: { rating: true } }),
      prisma.providerProfile.findMany({
        orderBy: [{ profileScore: 'desc' }, { rating: 'desc' }],
        take: 5,
        include: { user: { select: { fullName: true, avatar: true } } }
      }),
      prisma.job.count({ where: { status: 'COMPLETED' } }),
      prisma.user.count({ where: { lastSeen: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } } })
    ]);

    const monthLabel = (value) => new Date(value).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
    const verification = Object.fromEntries(verificationRows.map((row) => [row.verification, toNumber(row._count.verification)]));
    const providerIds = topProviders.map((provider) => provider.id);
    const completedAssignments = providerIds.length
      ? await prisma.jobAssignment.groupBy({
          by: ['providerId'],
          where: { providerId: { in: providerIds }, status: 'ACCEPTED', job: { status: 'COMPLETED' } },
          _count: { providerId: true }
        })
      : [];
    const completedByProvider = new Map(completedAssignments.map((row) => [row.providerId, toNumber(row._count.providerId)]));

    res.status(200).json({
      success: true,
      data: {
        userGrowth: userGrowthRows.map((row) => ({
          month: monthLabel(row.month),
          newUsers: toNumber(row.newUsers),
          newProviders: toNumber(row.newProviders)
        })),
        jobStats: jobStatsRows.map((row) => ({
          month: monthLabel(row.month),
          posted: toNumber(row.posted),
          completed: toNumber(row.completed),
          cancelled: toNumber(row.cancelled)
        })),
        revenueStats: revenueRows.map((row) => ({
          month: monthLabel(row.month),
          revenueFCFA: toNumber(row.revenueFCFA),
          coinsIssued: toNumber(row.coinsIssued)
        })),
        topCategories: categoryRows.map((row) => ({
          category: row.category || 'Uncategorized',
          count: row._count.category,
          percentage: totalJobs ? Math.round((row._count.category / totalJobs) * 100) : 0
        })),
        providerStats: {
          totalVerified: verification.VERIFIED || 0,
          totalPending: verification.PENDING || 0,
          totalUnverified: verification.UNVERIFIED || 0,
          averageRating: Number((avgRating._avg.rating || 0).toFixed(1)),
          topRanked: topProviders.map((provider) => ({
            name: provider.user?.fullName || 'Provider',
            avatar: provider.user?.avatar || null,
            rating: provider.rating,
            skillRank: provider.skillRank,
            completedJobs: completedByProvider.get(provider.id) || 0
          }))
        },
        platformHealth: {
          avgJobCompletionRate: totalJobs ? Math.round((completedJobs / totalJobs) * 100) : 0,
          avgProviderResponseTime: 'N/A',
          totalActiveUsers: activeUsers
        }
      }
    });
  } catch (error) {
    next(error);
  }
};

const getBroadcasts = async (req, res, next) => {
  try {
    const notifications = await prisma.adminMessage.findMany({
      orderBy: { createdAt: 'desc' },
      take: 5
    });
    res.status(200).json({ success: true, data: notifications });
  } catch (error) {
    next(error);
  }
};

const getReports = async (req, res, next) => {
  try {
    const reports = await prisma.report.findMany({
      orderBy: { createdAt: 'desc' }
    });

    const userIds = [...new Set(reports.flatMap((report) => [report.reporterId, report.targetUserId]))];
    const users = await prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, fullName: true }
    });
    const usersById = new Map(users.map((user) => [user.id, user]));

    const formatted = reports.map((report) => ({
      ...report,
      reporter: usersById.get(report.reporterId) || null,
      target: usersById.get(report.targetUserId) || null
    }));

    res.status(200).json({ success: true, data: formatted });
  } catch (error) {
    next(error);
  }
};

const updateReportStatus = async (req, res, next) => {
  try {
    const { status } = req.body;
    const report = await prisma.report.update({
      where: { id: req.params.id },
      data: { status }
    });
    res.status(200).json({ success: true, data: report });
  } catch (error) {
    next(error);
  }
};

const getFeedback = async (req, res, next) => {
  try {
    const feedback = await prisma.feedback.findMany({
      orderBy: { createdAt: 'desc' }
    });

    const userIds = [...new Set(feedback.map((item) => item.userId))];
    const users = await prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, fullName: true, phone: true, email: true, role: true }
    });
    const usersById = new Map(users.map((user) => [user.id, user]));

    res.status(200).json({
      success: true,
      data: feedback.map((item) => ({ ...item, user: usersById.get(item.userId) || null }))
    });
  } catch (error) {
    next(error);
  }
};

const updateFeedbackStatus = async (req, res, next) => {
  try {
    const { status } = req.body;
    const feedback = await prisma.feedback.update({
      where: { id: req.params.id },
      data: { status }
    });
    res.status(200).json({ success: true, data: feedback });
  } catch (error) {
    next(error);
  }
};

const sendAdminMessage = async (req, res, next) => {
  try {
    const { subject, content, recipientId, recipientRole } = req.body;
    if (!subject || !content) {
      return res.status(400).json({ success: false, message: 'Subject and content are required' });
    }

    let recipients = [];
    if (recipientId) {
      recipients = await prisma.user.findMany({ where: { id: recipientId }, select: { id: true, fcmToken: true } });
    } else if (recipientRole && recipientRole !== 'ALL') {
      recipients = await prisma.user.findMany({ where: { role: recipientRole }, select: { id: true, fcmToken: true } });
    } else {
      recipients = await prisma.user.findMany({ where: { role: { not: 'ADMIN' } }, select: { id: true, fcmToken: true } });
    }

    const adminMessage = await prisma.adminMessage.create({
      data: {
        recipientId: recipientId || null,
        recipientRole: recipientRole || 'ALL',
        subject,
        content
      }
    });

    const notifications = await prisma.notification.createMany({
      data: recipients.map((recipient) => ({
        userId: recipient.id,
        title: subject,
        body: content,
        data: { type: 'ADMIN_MESSAGE', adminMessageId: adminMessage.id }
      }))
    });

    try {
      const io = getIO();
      recipients.forEach((recipient) => {
        io.to(recipient.id).emit('notification:new', {
          id: `${adminMessage.id}-${recipient.id}`,
          userId: recipient.id,
          title: subject,
          body: content,
          data: { type: 'ADMIN_MESSAGE', adminMessageId: adminMessage.id },
          isRead: false,
          createdAt: new Date().toISOString()
        });
      });
    } catch (err) {
      console.error('[Socket Error] Admin message broadcast failed:', err.message);
    }

    // Send FCM Push Notification
    const tokens = recipients.map(r => r.fcmToken).filter(Boolean);
    if (tokens.length > 0) {
      const { sendMulticastNotification } = require('../services/notification.service');
      await sendMulticastNotification(tokens, { title: subject, body: content, data: { type: 'ADMIN_MESSAGE', adminMessageId: adminMessage.id } });
    }

    res.status(201).json({ success: true, data: adminMessage, delivered: notifications.count });
  } catch (error) {
    next(error);
  }
};

const getPendingJobs = async (req, res, next) => {
  try {
    const jobs = await prisma.job.findMany({
      where: { approvalStatus: 'PENDING_APPROVAL' },
      include: {
        client: {
          select: { id: true, fullName: true, phone: true, email: true }
        },
        assignments: {
          include: {
            provider: {
              include: { user: { select: { fullName: true, phone: true } } }
            }
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    res.status(200).json({ success: true, data: jobs });
  } catch (error) {
    next(error);
  }
};

const getApprovedJobs = async (req, res, next) => {
  try {
    const jobs = await prisma.job.findMany({
      where: { approvalStatus: 'APPROVED' },
      include: {
        client: {
          select: { id: true, fullName: true, phone: true, email: true }
        },
        assignments: {
          include: {
            provider: {
              include: { user: { select: { fullName: true, phone: true } } }
            }
          }
        }
      },
      orderBy: { createdAt: 'desc' },
      take: 100
    });

    res.status(200).json({ success: true, data: jobs });
  } catch (error) {
    next(error);
  }
};

const approveJob = async (req, res, next) => {
  try {
    const { id } = req.params;

    const job = await prisma.job.update({
      where: { id },
      data: {
        approvalStatus: 'APPROVED'
      },
      include: {
        client: {
          select: { id: true, fullName: true, email: true }
        }
      }
    });

    // Notify client
    const notification = await prisma.notification.create({
      data: {
        userId: job.clientId,
        title: 'Task Approved',
        body: `Your task "${job.title}" has been approved and is now live for providers to discover!`,
        data: { type: 'JOB', jobId: job.id, status: 'APPROVED' }
      }
    });

    // Emit socket event
    try {
      const { getIO } = require('../services/socket.service');
      const io = getIO();
      io.to(job.clientId).emit('notification:new', notification);
      io.emit('job:approved', job);
    } catch (err) {
      console.error('[Socket Error] Job approval notification failed:', err.message);
    }

    try {
      const { sendPushNotification } = require('../services/notification.service');
      await sendPushNotification(
        job.clientId,
        'Task Approved ✅',
        `Your task "${job.title}" is now live!`,
        { type: 'JOB_APPROVED', jobId: job.id }
      );
    } catch (pushErr) {
      console.error('[Push Error] Job approve push failed:', pushErr.message);
    }

    res.status(200).json({ success: true, data: job, message: 'Job approved successfully' });
  } catch (error) {
    next(error);
  }
};

const rejectJob = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;

    if (!reason) {
      return res.status(400).json({ success: false, message: 'Rejection reason is required' });
    }

    const existing = await prisma.job.findUnique({
      where: { id },
      include: {
        assignments: { include: { provider: { include: { user: { include: { wallet: true } } } } } },
        client: { select: { id: true, fullName: true, email: true } }
      }
    });

    if (!existing) {
      return res.status(404).json({ success: false, message: 'Job not found' });
    }

    const job = await prisma.$transaction(async (tx) => {
      const updated = await tx.job.update({
        where: { id },
        data: {
          approvalStatus: 'REJECTED',
          rejectionReason: reason
        },
        include: {
          client: {
            select: { id: true, fullName: true, email: true }
          }
        }
      });

      for (const assignment of existing.assignments) {
        const wallet = assignment.provider.user.wallet;
        if (!wallet || assignment.refundedAt) continue;

        await tx.wallet.update({
          where: { id: wallet.id },
          data: { balance: { increment: existing.coinCost } }
        });
        await tx.transaction.create({
          data: {
            walletId: wallet.id,
            amount: existing.coinCost,
            type: 'REFUND',
            status: 'SUCCESS',
            jobId: existing.id,
            description: `Refund for rejected task: ${existing.title}`
          }
        });
        await tx.jobAssignment.update({
          where: { id: assignment.id },
          data: { refundedAt: new Date(), status: 'REJECTED' }
        });
      }

      return updated;
    });

    // Notify client
    const notification = await prisma.notification.create({
      data: {
        userId: job.clientId,
        title: 'Task Rejected',
        body: `Your task "${job.title}" was not approved. Reason: ${reason}`,
        data: { type: 'JOB', jobId: job.id, status: 'REJECTED', reason }
      }
    });

    // Emit socket event
    try {
      const { getIO } = require('../services/socket.service');
      const io = getIO();
      io.to(job.clientId).emit('notification:new', notification);
    } catch (err) {
      console.error('[Socket Error] Job rejection notification failed:', err.message);
    }

    try {
      const { sendPushNotification } = require('../services/notification.service');
      await sendPushNotification(
        job.clientId,
        'Task Rejected ❌',
        `Your task "${job.title}" was rejected.`,
        { type: 'JOB_REJECTED', jobId: job.id, reason }
      );
    } catch (pushErr) {
      console.error('[Push Error] Job reject push failed:', pushErr.message);
    }

    res.status(200).json({ success: true, data: job, message: 'Job rejected successfully' });
  } catch (error) {
    next(error);
  }
};

const getSettings = async (req, res, next) => {
  try {
    let settings = await prisma.settings.findUnique({ where: { id: 'global' } });
    if (!settings) {
      settings = await prisma.settings.create({ data: { id: 'global' } });
    }
    res.status(200).json({ success: true, data: settings });
  } catch (error) {
    next(error);
  }
};

const updateSettings = async (req, res, next) => {
  try {
    const data = req.body;
    
    const allowedFields = [
      'platformName', 'supportEmail', 'serviceFee', 'defaultLanguage', 
      'baseCurrency', 'apiEndpoint', 'adminSecret', 'appMaintenanceEnabled', 
      'webMaintenanceEnabled', 'maintenanceMessage'
    ];
    
    const updateData = {};
    for (const key of allowedFields) {
      if (data[key] !== undefined) {
        updateData[key] = data[key];
      }
    }

    const settings = await prisma.settings.upsert({
      where: { id: 'global' },
      update: updateData,
      create: { id: 'global', ...updateData }
    });
    res.status(200).json({ success: true, data: settings });
  } catch (error) {
    next(error);
  }
};

const wireCoins = async (req, res, next) => {
  try {
    const { userId, amount, reason } = req.body;
    if (!userId || !amount) {
      return res.status(400).json({ success: false, message: 'User ID and amount are required' });
    }

    let wallet = await prisma.wallet.findUnique({ where: { userId } });
    if (!wallet) {
      wallet = await prisma.wallet.create({ data: { userId, balance: 0 } });
    }

    const transaction = await prisma.$transaction(async (tx) => {
      const updatedWallet = await tx.wallet.update({
        where: { id: wallet.id },
        data: { balance: { increment: Number(amount) } }
      });

      const trans = await tx.transaction.create({
        data: {
          walletId: wallet.id,
          amount: Math.abs(Number(amount)),
          type: Number(amount) >= 0 ? 'PURCHASE' : 'DEDUCTION',
          status: 'SUCCESS',
          description: `Admin wired coins manually: ${reason || 'Manual adjustment'}`
        }
      });
      return trans;
    });
    
    // Emit wallet update socket event
    const { getIO } = require('../services/socket.service');
    try {
      getIO().to(userId).emit('wallet:update', { balance: wallet.balance + Number(amount) });
    } catch(err) {}
    
    // Notification
    const notification = await prisma.notification.create({
      data: {
        userId,
        title: Number(amount) >= 0 ? 'Coins Added' : 'Coins Deducted',
        body: `Admin ${Number(amount) >= 0 ? 'added' : 'deducted'} ${Math.abs(Number(amount))} coins. Reason: ${reason || 'Manual adjustment'}`,
        data: { type: 'WALLET' }
      }
    });

    try {
      getIO().to(userId).emit('notification:new', notification);
      const { sendPushNotification } = require('../services/notification.service');
      await sendPushNotification(userId, notification.title, notification.body, notification.data);
    } catch(err) {
      console.error('[Socket/Push Error] Wallet adjustment notification failed:', err.message);
    }

    res.status(200).json({ success: true, data: transaction });
  } catch (error) {
    next(error);
  }
};

const getWireHistory = async (req, res, next) => {
  try {
    const history = await prisma.transaction.findMany({
      where: { description: { startsWith: 'Admin wired', mode: 'insensitive' } },
      include: { wallet: { include: { user: { select: { id: true, fullName: true, phone: true } } } } },
      orderBy: { createdAt: 'desc' },
      take: 20
    });
    res.status(200).json({ success: true, data: history });
  } catch (error) {
    next(error);
  }
};

const sendBroadcastEmail = async (req, res, next) => {
  try {
    const { subjectEn, contentEn, subjectFr, contentFr, subject, content, recipientRole } = req.body;
    
    const finalSubjectEn = subjectEn || subject;
    const finalContentEn = contentEn || content;
    const finalSubjectFr = subjectFr || subject;
    const finalContentFr = contentFr || content;

    if (!finalSubjectEn || !finalContentEn) {
      return res.status(400).json({ success: false, message: 'Subject and content are required' });
    }

    const query = { where: { email: { not: null } }, select: { email: true, preferredLanguage: true } };
    if (recipientRole) {
      query.where.role = recipientRole;
    }

    const users = await prisma.user.findMany(query);
    const emailsEn = users.filter(u => u.preferredLanguage !== 'fr' && u.email).map(u => u.email);
    const emailsFr = users.filter(u => u.preferredLanguage === 'fr' && u.email).map(u => u.email);

    if (emailsEn.length === 0 && emailsFr.length === 0) {
      return res.status(400).json({ success: false, message: 'No users with emails found' });
    }

    const batchSize = 50;
    
    for (let i = 0; i < emailsEn.length; i += batchSize) {
      const batch = emailsEn.slice(i, i + batchSize);
      await sendMarketingBroadcast(batch, finalSubjectEn, finalContentEn).catch(e => console.error('[BroadcastError EN]', e.message));
    }

    for (let i = 0; i < emailsFr.length; i += batchSize) {
      const batch = emailsFr.slice(i, i + batchSize);
      await sendMarketingBroadcast(batch, finalSubjectFr, finalContentFr).catch(e => console.error('[BroadcastError FR]', e.message));
    }

    res.status(200).json({ success: true, message: `Broadcast sent to ${emailsEn.length + emailsFr.length} users` });
  } catch (error) {
    next(error);
  }
};

const sendSecurityAlert = async (req, res, next) => {
  try {
    const { issueDetailsEn, issueDetailsFr, issueDetails, recipientRole } = req.body;
    
    const finalDetailsEn = issueDetailsEn || issueDetails;
    const finalDetailsFr = issueDetailsFr || issueDetails;

    if (!finalDetailsEn) {
      return res.status(400).json({ success: false, message: 'Issue details are required' });
    }

    const query = { where: { email: { not: null } }, select: { email: true, preferredLanguage: true } };
    if (recipientRole) {
      query.where.role = recipientRole;
    }

    const users = await prisma.user.findMany(query);
    const emailsEn = users.filter(u => u.preferredLanguage !== 'fr' && u.email).map(u => u.email);
    const emailsFr = users.filter(u => u.preferredLanguage === 'fr' && u.email).map(u => u.email);

    if (emailsEn.length === 0 && emailsFr.length === 0) {
      return res.status(400).json({ success: false, message: 'No users with emails found' });
    }

    const batchSize = 50;
    for (let i = 0; i < emailsEn.length; i += batchSize) {
      const batch = emailsEn.slice(i, i + batchSize);
      await sendSecurityNotice(batch, finalDetailsEn).catch(e => console.error('[SecurityAlertError EN]', e.message));
    }
    
    for (let i = 0; i < emailsFr.length; i += batchSize) {
      const batch = emailsFr.slice(i, i + batchSize);
      await sendSecurityNotice(batch, finalDetailsFr).catch(e => console.error('[SecurityAlertError FR]', e.message));
    }

    res.status(200).json({ success: true, message: `Security alert sent to ${emailsEn.length + emailsFr.length} users` });
  } catch (error) {
    next(error);
  }
};

const getConversationBetweenUsers = async (req, res, next) => {
  try {
    const { user1Id, user2Id } = req.params;

    const conversation = await prisma.conversation.findFirst({
      where: {
        AND: [
          { participants: { some: { userId: user1Id } } },
          { participants: { some: { userId: user2Id } } }
        ],
        support: null // Exclude support conversations if we only want standard ones
      },
      orderBy: { lastMessageAt: 'desc' },
      include: {
        messages: {
          orderBy: { createdAt: 'asc' }
        },
        participants: {
          include: {
            user: { select: { id: true, fullName: true, avatar: true, role: true } }
          }
        }
      }
    });

    if (!conversation) {
      return res.status(200).json({ success: true, data: { messages: [], participants: [] } });
    }

    res.status(200).json({ success: true, data: conversation });
  } catch (error) {
    next(error);
  }
};

const getAllBookings = async (req, res, next) => {
  try {
    const bookings = await prisma.booking.findMany({
      include: {
        client: { select: { id: true, fullName: true, email: true, avatar: true } },
        provider: { select: { id: true, fullName: true, email: true, avatar: true } },
      },
      orderBy: { createdAt: 'desc' }
    });
    res.status(200).json({ success: true, data: bookings });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  verifyProvider,
  approveTransaction,
  getDashboardStats,
  getUsers,
  getUserDetails,
  updateUserStatus,
  getProviders,
  getPendingTransactions,
  getTransactions,
  getFinancialStats,
  getWalletStats,
  getAnalytics,
  getBroadcasts,
  getReports,
  getSupportConversations,
  updateReportStatus,
  getFeedback,
  updateFeedbackStatus,
  sendAdminMessage,
  getPendingJobs,
  getApprovedJobs,
  approveJob,
  rejectJob,
  getSettings,
  updateSettings,
  wireCoins,
  getWireHistory,
  sendBroadcastEmail,
  sendSecurityAlert,
  getConversationBetweenUsers,
  getAllBookings
};
