const prisma = require('../config/prisma');
const { getIO } = require('../services/socket.service');
const { sendBookingNotification } = require('../services/notification.service');

const emitBooking = (booking) => {
  try {
    const io = getIO();
    io.to(booking.clientId).emit('booking:update', booking);
    io.to(booking.providerId).emit('booking:update', booking);
  } catch (err) {
    console.error('[Socket Error] Booking update failed:', err.message);
  }
};

const includeBooking = {
  client: { select: { id: true, fullName: true, avatar: true, phone: true, email: true } },
  provider: { select: { id: true, fullName: true, avatar: true, phone: true, email: true } },
  task: true,
};

const createBooking = async (req, res, next) => {
  try {
    console.log('[Booking] Request body:', JSON.stringify(req.body));
    console.log('[Booking] User:', req.user.id);

    const { providerId, taskId, bookingDate, bookingTime, budget, location, notes } = req.body;
    if (!providerId || !bookingDate || !bookingTime || budget === undefined || budget === null) {
      return res.status(400).json({ success: false, message: 'Provider, date, time and budget are required.' });
    }

    const provider = await prisma.user.findFirst({
      where: { id: providerId, role: 'PROVIDER' },
      include: { providerProfile: true },
    });
    if (!provider) return res.status(404).json({ success: false, message: 'Provider not found.' });

    const providerProfile = await prisma.providerProfile.findUnique({ where: { userId: providerId } });
    if (!providerProfile) {
      return res.status(404).json({ success: false, message: 'Provider profile not found.' });
    }

    if (taskId) {
      const task = await prisma.job.findUnique({ where: { id: taskId } });
      if (!task || task.clientId !== req.user.id) {
        return res.status(403).json({ success: false, message: 'Task not available for this booking.' });
      }
    }

    const bookingBudget = Number(budget);
    if (Number.isNaN(bookingBudget)) {
      return res.status(400).json({ success: false, message: 'Budget must be a valid number.' });
    }

    const booking = await prisma.$transaction(async (tx) => {
      const wallet = await tx.wallet.findUnique({ where: { userId: req.user.id } });
      if (!wallet || wallet.balance < 1) {
        const error = new Error('Insufficient coins. You need 1 coin to book a provider.');
        error.statusCode = 400;
        throw error;
      }

      const newBooking = await tx.booking.create({
        data: {
          clientId: req.user.id,
          providerId,
          taskId: taskId || null,
          bookingDate: new Date(bookingDate),
          bookingTime,
          budget: bookingBudget,
          location: location || '',
          notes: notes || '',
        },
        include: includeBooking,
      });

      await tx.wallet.update({
        where: { userId: req.user.id },
        data: { balance: { decrement: 1 } },
      });

      await tx.transaction.create({
        data: {
          walletId: wallet.id,
          amount: 1,
          type: 'DEDUCTION',
          status: 'SUCCESS',
          description: `Booking: ${provider.fullName || provider.phone || 'Provider'}`,
        },
      });

      return newBooking;
    });

    const notification = await prisma.notification.create({
      data: {
        userId: providerId,
        title: 'New booking request',
        body: `${req.user.fullName || 'A client'} requested a service booking.`,
        data: { type: 'BOOKING', bookingId: booking.id, status: booking.status }
      }
    });

    emitBooking(booking);
    try { getIO().to(providerId).emit('notification:new', notification); } catch (_) {}

    // Send FCM Push Notification
    try {
      if (provider.fcmToken) {
        await sendBookingNotification(provider.fcmToken, notification.title, notification.body, booking.id);
      }
    } catch (notifError) {
      console.error('[Booking] Notification failed:', notifError.message);
    }

    res.status(201).json({ success: true, data: booking });
  } catch (error) {
    console.error('[Booking] Creation error:', error.message);
    console.error('[Booking] Full error:', error);
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message,
    });
  }
};

const getMyBookings = async (req, res, next) => {
  try {
    const role = String(req.query.role || req.user.role || '').toUpperCase();
    const where = role === 'PROVIDER'
      ? { providerId: req.user.id }
      : { clientId: req.user.id };

    const bookings = await prisma.booking.findMany({
      where,
      include: includeBooking,
      orderBy: [{ bookingDate: 'asc' }, { createdAt: 'desc' }],
    });

    res.status(200).json({ success: true, data: bookings });
  } catch (error) {
    next(error);
  }
};

const updateBookingStatus = async (req, res, next) => {
  try {
    const { bookingId } = req.params;
    const { status, paymentStatus } = req.body;
    const allowed = ['PENDING', 'ACCEPTED', 'REJECTED', 'CANCELLED', 'COMPLETED'];
    const existing = await prisma.booking.findUnique({ where: { id: bookingId } });
    if (!existing) return res.status(404).json({ success: false, message: 'Booking not found.' });

    const isClient = existing.clientId === req.user.id;
    const isProvider = existing.providerId === req.user.id;
    const isAdmin = req.user.role === 'ADMIN';
    if (!isClient && !isProvider && !isAdmin) {
      return res.status(403).json({ success: false, message: 'Not allowed to update this booking.' });
    }
    if (status && !allowed.includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid booking status.' });
    }

    const booking = await prisma.booking.update({
      where: { id: bookingId },
      data: {
        ...(status && { status }),
        ...(paymentStatus && { paymentStatus }),
      },
      include: includeBooking,
    });

    emitBooking(booking);
    res.status(200).json({ success: true, data: booking });
  } catch (error) {
    next(error);
  }
};

const checkBooking = async (req, res, next) => {
  try {
    const { providerId } = req.query;
    if (!providerId) {
      return res.status(400).json({ success: false, message: 'providerId query parameter is required' });
    }

    const booking = await prisma.booking.findFirst({
      where: {
        clientId: req.user.id,
        providerId,
        status: { in: ['PENDING', 'ACCEPTED'] },
      },
      select: { id: true, status: true },
    });

    res.status(200).json({
      success: true,
      data: {
        hasBooking: !!booking,
        bookingId: booking?.id || null,
        status: booking?.status || null,
      },
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  createBooking,
  getMyBookings,
  updateBookingStatus,
  checkBooking,
};
