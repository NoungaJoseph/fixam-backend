const prisma = require('../config/prisma');
const { getIO } = require('../services/socket.service');
const { sendPushNotification } = require('../services/notification.service');

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
  reviews: { select: { id: true, reviewerId: true, targetUserId: true, rating: true, createdAt: true } },
};

const createBooking = async (req, res, next) => {
  try {
    console.log('[Booking] Request body:', JSON.stringify(req.body));
    console.log('[Booking] User:', req.user.id);

    const { providerId, taskId, bookingDate, bookingTime, budget, location, notes, bookingDuration, urgencyLevel } = req.body;
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

    // CHECK CLIENT VERIFICATION HERE
    const clientUser = await prisma.user.findUnique({
      where: { id: req.user.id },
      include: { providerProfile: true }
    });
    
    const isVerified = clientUser.fullName && !clientUser.isBlocked;
    
    if (!isVerified) {
      return res.status(403).json({
        success: false,
        message: 'Please verify your identity before booking',
        requiresVerification: true,
        code: 'VERIFICATION_REQUIRED'
      });
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

    const COIN_COSTS = {
      NORMAL: 1,
      URGENT: 2,
      EMERGENCY: 3
    };
    const resolvedUrgency = urgencyLevel || 'NORMAL';
    const coinCost = COIN_COSTS[resolvedUrgency] || 1;

    const booking = await prisma.$transaction(async (tx) => {
      const wallet = await tx.wallet.findUnique({ where: { userId: req.user.id } });
      if (!wallet || wallet.balance < coinCost) {
        const error = new Error(`Insufficient coins. You need ${coinCost} coins for this booking.`);
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
          bookingDuration: bookingDuration || 'DAY',
          urgencyLevel: resolvedUrgency,
          coinCost: coinCost,
          budget: bookingBudget,
          location: location || '',
          notes: notes || '',
        },
        include: includeBooking,
      });

      await tx.wallet.update({
        where: { userId: req.user.id },
        data: { balance: { decrement: coinCost } },
      });

      await tx.transaction.create({
        data: {
          walletId: wallet.id,
          amount: coinCost,
          type: 'DEDUCTION',
          status: 'SUCCESS',
          description: `Booking: ${resolvedUrgency} - ${provider.fullName || provider.phone || 'Provider'}`,
          isSystemTransaction: false
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
      await sendPushNotification(
        providerId,
        'New Booking Request 📅',
        `${req.user.fullName || 'A client'} wants to book your service`,
        {
          type: 'NEW_BOOKING',
          bookingId: booking.id,
          clientId: req.user.id,
          screen: 'BookingDetails'
        }
      );
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

    const page = parseInt(req.query.page) || 1;
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const skip = (page - 1) * limit;

    // Fast ETag check
    const [latestBooking, total] = await Promise.all([
      prisma.booking.findFirst({
        where,
        orderBy: { updatedAt: 'desc' },
        select: { updatedAt: true }
      }),
      prisma.booking.count({ where })
    ]);

    const lastUpdated = latestBooking ? latestBooking.updatedAt.getTime() : 0;
    const etag = `W/"${lastUpdated}-${total}-${page}-${limit}"`;

    if (req.headers['if-none-match'] === etag) {
      return res.status(304).end();
    }
    res.setHeader('ETag', etag);

    const bookings = await prisma.booking.findMany({
      where,
      include: includeBooking,
      orderBy: [{ bookingDate: 'asc' }, { createdAt: 'desc' }],
      skip,
      take: limit,
    });

    res.status(200).json({
      success: true,
      data: bookings,
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

const updateBookingStatus = async (req, res, next) => {
  try {
    const { bookingId } = req.params;
    const { status, paymentStatus } = req.body;
    const allowed = ['PENDING', 'ACCEPTED', 'IN_PROGRESS', 'REJECTED', 'CANCELLED', 'COMPLETED'];
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

    if (status === 'ACCEPTED' && isProvider && !req.user.isOnline) {
      return res.status(403).json({ success: false, message: 'You must be available for work to accept a booking.' });
    }

    if (status === 'CANCELLED' && existing.status === 'PENDING') {
      const wallet = await prisma.wallet.findUnique({ where: { userId: existing.clientId } });
      if (wallet) {
        await prisma.wallet.update({
          where: { userId: existing.clientId },
          data: { balance: { increment: existing.coinCost || 1 } }
        });
        await prisma.transaction.create({
          data: {
            walletId: wallet.id,
            amount: existing.coinCost || 1,
            type: 'REFUND',
            status: 'SUCCESS',
            reference: `REF-${existing.id.substring(0, 8)}`,
            description: 'Refund for cancelled booking'
          }
        });
      }
    }

    const booking = await prisma.booking.update({
      where: { id: bookingId },
      data: {
        ...(status && { status }),
        ...(paymentStatus && { paymentStatus }),
      },
      include: includeBooking,
    });

    if (status === 'ACCEPTED') {
      try {
        await sendPushNotification(
          booking.clientId,
          'Booking Confirmed ✅',
          `Your booking with ${booking.provider?.fullName || 'the provider'} is confirmed`,
          {
            type: 'BOOKING_CONFIRMED',
            bookingId: booking.id,
            providerId: booking.providerId,
            screen: 'BookingDetails'
          }
        );
      } catch (notifError) {
        console.error('[Booking] Confirmed Notification failed:', notifError.message);
      }
    }
    if (status === 'COMPLETED' || status === 'ACCEPTED') {
      try {
        const { calculateProviderStats } = require('../utils/providerStats');
        const providerProfile = await prisma.providerProfile.findUnique({ where: { userId: booking.providerId } });
        if (providerProfile) {
          await calculateProviderStats(providerProfile.id).catch(() => null);
        }
      } catch (statsErr) {
        console.error('[Booking] Stats update failed:', statsErr.message);
      }
    }

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
      select: { id: true, status: true, bookingDuration: true, urgencyLevel: true, bookingDate: true },
    });

    res.status(200).json({
      success: true,
      data: {
        hasBooking: !!booking,
        bookingId: booking?.id || null,
        status: booking?.status || null,
        booking: booking || null,
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
