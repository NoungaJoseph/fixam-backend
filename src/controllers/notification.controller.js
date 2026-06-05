const prisma = require('../config/prisma');

const getNotifications = async (req, res, next) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const skip = (page - 1) * limit;

    const [items, total] = await prisma.$transaction([
      prisma.notification.findMany({
        where: { userId: req.user.id, archivedAt: null },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit
      }),
      prisma.notification.count({
        where: { userId: req.user.id, archivedAt: null }
      })
    ]);

    res.status(200).json({
      success: true,
      data: items,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
        hasMore: page * limit < total
      }
    });
  } catch (error) {
    next(error);
  }
};

const markAsRead = async (req, res, next) => {
  try {
    const { id } = req.params;
    const result = await prisma.notification.updateMany({
      where: { id, userId: req.user.id },
      data: { isRead: true }
    });
    if (!result.count) {
      return res.status(404).json({ success: false, message: 'Notification not found' });
    }
    res.status(200).json({ success: true, message: 'Notification marked as read' });
  } catch (error) {
    next(error);
  }
};

const clearNotifications = async (req, res, next) => {
  try {
    await prisma.notification.updateMany({
      where: { userId: req.user.id },
      data: { archivedAt: new Date(), isRead: true }
    });
    res.status(200).json({ success: true, message: 'All notifications archived' });
  } catch (error) {
    next(error);
  }
};

const archiveNotification = async (req, res, next) => {
  try {
    const { id } = req.params;
    const result = await prisma.notification.updateMany({
      where: { id, userId: req.user.id },
      data: { archivedAt: new Date(), isRead: true }
    });
    if (!result.count) {
      return res.status(404).json({ success: false, message: 'Notification not found' });
    }
    res.status(200).json({ success: true, message: 'Notification archived' });
  } catch (error) {
    next(error);
  }
};

const testPush = async (req, res) => {
  try {
    const { userId, title, body, data } = req.body
    
    if (!userId || !title || !body) {
      return res.status(400).json({
        success: false,
        message: 'userId, title and body are required'
      })
    }
    
    const { sendPushNotification, sendPushToMultiple } = 
      require('../services/notification.service')
    
    // Broadcast to all users
    if (userId === 'ALL') {
      const users = await prisma.user.findMany({
        where: { fcmToken: { not: null } },
        select: { id: true, phone: true, fcmToken: true }
      })
      
      console.log(`[Test] Broadcasting to ${users.length} users`)
      
      const results = await Promise.allSettled(
        users.map(u => sendPushNotification(u.id, title, body, data || {}))
      )
      
      const sent = results.filter(
        r => r.status === 'fulfilled' && r.value?.success
      ).length
      
      return res.json({
        success: true,
        message: `Broadcast sent`,
        sent,
        total: users.length,
        users: users.map(u => u.phone)
      })
    }
    
    // Single user
    const result = await sendPushNotification(
      userId, title, body, data || {}
    )
    
    return res.json({
      success: result.success,
      result,
      userId,
      title,
      body
    })
    
  } catch (error) {
    console.error('[Test Push] Error:', error)
    return res.status(500).json({
      success: false,
      message: error.message
    })
  }
};

module.exports = {
  getNotifications,
  markAsRead,
  archiveNotification,
  clearNotifications,
  testPush
};

