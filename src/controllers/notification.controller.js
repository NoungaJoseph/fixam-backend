const prisma = require('../config/prisma');

const getNotifications = async (req, res, next) => {
  try {
    const notifications = await prisma.notification.findMany({
      where: { userId: req.user.id, archivedAt: null },
      orderBy: { createdAt: 'desc' }
    });
    res.status(200).json({ success: true, data: notifications });
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

module.exports = {
  getNotifications,
  markAsRead,
  archiveNotification,
  clearNotifications
};
