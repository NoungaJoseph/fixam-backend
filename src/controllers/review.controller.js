const prisma = require('../config/prisma');

const createReview = async (req, res, next) => {
  try {
    const { jobId, targetUserId, rating, comment } = req.body;
    const parsedRating = Number(rating);

    if (!jobId || !targetUserId || !Number.isInteger(parsedRating) || parsedRating < 1 || parsedRating > 5) {
      return res.status(400).json({ success: false, message: 'Job, target user, and rating from 1 to 5 are required' });
    }

    // Verify the reviewer is connected to this job (as client or assigned provider)
    const job = await prisma.job.findFirst({
      where: {
        id: jobId,
        OR: [
          { clientId: req.user.id },
          { assignments: { some: { provider: { userId: req.user.id } } } }
        ]
      },
      include: { assignments: { include: { provider: true } } }
    });

    if (!job) {
      return res.status(404).json({ success: false, message: 'Job not found or you are not authorized to review it' });
    }

    // Validate reviewer is not reviewing themselves
    if (targetUserId === req.user.id) {
      return res.status(400).json({ success: false, message: 'You cannot review yourself' });
    }

    // Prevent duplicate reviews for the same job by the same reviewer
    const existing = await prisma.review.findFirst({
      where: { jobId, reviewerId: req.user.id, targetUserId }
    });
    if (existing) {
      return res.status(409).json({ success: false, message: 'You have already reviewed this person for this job' });
    }

    // 1. Create the review and update target rating in a transaction
    const review = await prisma.$transaction(async (tx) => {
      const created = await tx.review.create({
        data: {
          jobId,
          targetUserId,
          reviewerId: req.user.id,
          rating: parsedRating,
          comment: comment || null
        }
      });

      // Update provider rating aggregate if the target user is a provider
      const targetProvider = await tx.providerProfile.findUnique({ where: { userId: targetUserId } });
      if (targetProvider) {
        const aggregate = await tx.review.aggregate({
          where: { targetUserId },
          _avg: { rating: true },
          _count: { rating: true }
        });

        await tx.providerProfile.update({
          where: { userId: targetUserId },
          data: {
            rating: aggregate._avg.rating || parsedRating,
            reviewCount: aggregate._count.rating
          }
        });
      }
      
      return created;
    });

    // 2. Notifications (Outside transaction to prevent "Transaction already closed" errors)
    try {
      // DB Notification
      await prisma.notification.create({
        data: {
          userId: targetUserId,
          title: 'New review',
          body: `You received a ${parsedRating}⭐ review from your recent task.`,
          data: { type: 'REVIEW', jobId, rating: parsedRating }
        }
      }).catch(err => console.error('[Review Notification DB Error]:', err.message));

      // Socket Notification
      const { getIO } = require('../services/socket.service');
      const io = getIO();
      if (io) {
        io.to(targetUserId).emit('notification:new', {
          id: review.id,
          userId: targetUserId,
          title: 'New review',
          body: `You received a ${parsedRating}⭐ review from your recent task.`,
          data: { type: 'REVIEW', jobId, rating: parsedRating },
          isRead: false,
          createdAt: new Date().toISOString()
        });
      }
    } catch (err) {
      console.error('[Socket Error] Review notification failed:', err.message);
    }

    res.status(201).json({ success: true, data: review });
  } catch (error) {
    next(error);
  }
};

const getUserReviews = async (req, res, next) => {
  try {
    const reviews = await prisma.review.findMany({
      where: { targetUserId: req.params.userId },
      include: {
        job: { select: { id: true, title: true, category: true } },
        reviewer: { select: { id: true, fullName: true, avatar: true } }
      },
      orderBy: { createdAt: 'desc' },
      take: 50
    });

    res.status(200).json({ success: true, data: reviews });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  createReview,
  getUserReviews
};
