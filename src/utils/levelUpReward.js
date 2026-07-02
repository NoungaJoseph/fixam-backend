const prisma = require('../config/prisma');

const getLevelInfo = (completedTasks) => {
  const safeCount = Math.max(0, Number(completedTasks) || 0);
  let level = 1;
  let prevThreshold = 0;
  let nextThreshold = 5;

  while (level < 200 && safeCount >= nextThreshold) {
    level += 1;
    prevThreshold = nextThreshold;
    nextThreshold += level * 5;
  }

  const tasksInThisLevel = nextThreshold - prevThreshold;
  const progressTasks = safeCount - prevThreshold;
  const progressPercent = Math.min(100, Math.round((progressTasks / tasksInThisLevel) * 100));

  return {
    level,
    completedTasksInLevel: progressTasks,
    tasksInThisLevel,
    nextLevelTasks: nextThreshold,
    progressPercent
  };
};

const checkAndAwardLevelUp = async (userId, prismaTx) => {
  try {
    const db = prismaTx || prisma;

    // 1. Fetch provider profile
    const providerProfile = await db.providerProfile.findUnique({
      where: { userId }
    });
    if (!providerProfile) return;

    // 2. Count completed jobs
    const completedJobs = await db.job.count({
      where: {
        status: 'COMPLETED',
        assignments: {
          some: {
            providerId: providerProfile.id,
            status: 'ACCEPTED'
          }
        }
      }
    });

    // 3. Count completed bookings
    const completedBookings = await db.booking.count({
      where: {
        status: 'COMPLETED',
        OR: [
          { clientId: userId },
          { providerId: userId }
        ]
      }
    });

    const totalCompleted = completedJobs + completedBookings;
    if (totalCompleted === 0) return;

    const currentLevelInfo = getLevelInfo(totalCompleted);
    const prevLevelInfo = getLevelInfo(totalCompleted - 1);

    // If level has increased, award reward coins
    if (currentLevelInfo.level > prevLevelInfo.level) {
      const rewardCoins = Math.min(currentLevelInfo.level, 200);

      // Get or create wallet
      let wallet = await db.wallet.findUnique({ where: { userId } });
      if (!wallet) {
        wallet = await db.wallet.create({
          data: { userId, balance: 0 }
        });
      }

      // Increment wallet balance
      await db.wallet.update({
        where: { id: wallet.id },
        data: { balance: { increment: rewardCoins } }
      });

      // Record transaction
      await db.transaction.create({
        data: {
          walletId: wallet.id,
          amount: rewardCoins,
          type: 'PURCHASE',
          status: 'SUCCESS',
          reference: `LEVEL-UP-L${currentLevelInfo.level}-${Date.now()}`,
          description: `Reached Level ${currentLevelInfo.level} Reward`
        }
      });

      // Create notification
      const notification = await db.notification.create({
        data: {
          userId,
          title: 'Level Up! 🎉',
          body: `Congratulations! You reached Level ${currentLevelInfo.level} and earned ${rewardCoins} coins!`,
          data: { type: 'LEVEL_UP', level: currentLevelInfo.level, coins: rewardCoins }
        }
      });

      // Emit sockets
      try {
        const { getIO } = require('../services/socket.service');
        const io = getIO();
        io.to(userId).emit('notification:new', notification);
        io.to(userId).emit('wallet:update', { balance: wallet.balance + rewardCoins });
      } catch (err) {
        console.error('[Socket Error] Level up emit failed:', err.message);
      }

      // Send push notification
      try {
        const { sendPushNotification } = require('../services/notification.service');
        await sendPushNotification(
          userId,
          'Level Up! 🎉',
          `You reached Level ${currentLevelInfo.level} and earned ${rewardCoins} coins!`,
          { type: 'LEVEL_UP', level: currentLevelInfo.level }
        );
      } catch (pushErr) {
        console.error('[Push Error] Level up push failed:', pushErr.message);
      }
    }
  } catch (error) {
    console.error('[Level Up Error]:', error);
  }
};

module.exports = {
  getLevelInfo,
  checkAndAwardLevelUp
};
