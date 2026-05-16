const prisma = require('../config/prisma');
const { createJobSchema } = require('../validators/job.validator');

const createJob = async (req, res, next) => {
  try {
    const validatedData = createJobSchema.parse(req.body);

    const job = await prisma.job.create({
      data: {
        ...validatedData,
        clientId: req.user.id,
        approvalStatus: 'PENDING_APPROVAL',  // New jobs require admin approval
        scheduledTime: validatedData.scheduledTime ? new Date(validatedData.scheduledTime) : null
      }
    });

    // Notify admins about new job awaiting approval
    try {
      const { getIO } = require('../services/socket.service');
      const io = getIO();
      io.emit('job:pending-approval', { 
        jobId: job.id, 
        title: job.title,
        clientName: req.user.fullName 
      });
    } catch (err) {
      console.error('[Socket Error] Job pending approval notification failed:', err.message);
    }

    res.status(201).json({ success: true, data: job });
  } catch (error) {
    next(error);
  }
};

const getClientJobs = async (req, res, next) => {
  try {
    const jobs = await prisma.job.findMany({
      where: { clientId: req.user.id },
      include: {
        assignments: {
          include: {
            provider: { include: { user: true, documents: true } }
          },
          orderBy: { assignedAt: 'desc' }
        }
      },
      orderBy: { createdAt: 'desc' }
    });
    res.status(200).json({ success: true, data: jobs });
  } catch (error) {
    next(error);
  }
};

const getJobById = async (req, res, next) => {
  try {
    const { jobId } = req.params;
    const job = await prisma.job.findUnique({
      where: { id: jobId },
      include: {
        client: { select: { id: true, fullName: true, avatar: true, phone: true } },
        assignments: {
          include: {
            provider: { include: { user: { select: { id: true, fullName: true, avatar: true, phone: true } } } }
          }
        }
      }
    });

    if (!job) {
      return res.status(404).json({ success: false, message: 'Job not found' });
    }

    const isClient = job.clientId === req.user.id;
    const isAssignedProvider = job.assignments.some((assignment) => assignment.provider?.userId === req.user.id);
    const canViewAvailable = req.user.role === 'PROVIDER' && job.approvalStatus === 'APPROVED';
    const isAdmin = req.user.role === 'ADMIN';

    if (!isClient && !isAssignedProvider && !canViewAvailable && !isAdmin) {
      return res.status(403).json({ success: false, message: 'Not allowed to view this job' });
    }

    res.status(200).json({ success: true, data: job });
  } catch (error) {
    next(error);
  }
};

const getAvailableJobsForProvider = async (req, res, next) => {
  try {
    const { page = 1, limit = 10, search = '', location = '', sortBy = 'newest' } = req.query;
    const skip = (page - 1) * limit;

    // Build where clause for filtering
    const whereClause = {
      status: 'PENDING',
      approvalStatus: 'APPROVED'  // Only show approved jobs
    };

    // Add search filter
    if (search) {
      whereClause.OR = [
        { title: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
        { category: { contains: search, mode: 'insensitive' } }
      ];
    }

    // Add location filter
    if (location) {
      whereClause.location = { contains: location, mode: 'insensitive' };
    }

    // Determine sort order
    let orderBy = { createdAt: 'desc' }; // newest by default
    if (sortBy === 'price_high') {
      orderBy = { budget: 'desc' };
    } else if (sortBy === 'price_low') {
      orderBy = { budget: 'asc' };
    } else if (sortBy === 'oldest') {
      orderBy = { createdAt: 'asc' };
    }

    // Get total count for pagination
    const total = await prisma.job.count({ where: whereClause });

    const jobs = await prisma.job.findMany({
      where: whereClause,
      include: {
        client: {
          select: {
            id: true, fullName: true, avatar: true,
            providerProfile: { select: { verification: true } }
          }
        },
        assignments: { select: { id: true, providerId: true, status: true } }
      },
      orderBy,
      skip,
      take: parseInt(limit)
    });

    // Enrich each job with client spending totals
    const clientIds = [...new Set(jobs.map(j => j.clientId))];
    const spendingData = await prisma.transaction.groupBy({
      by: ['walletId'],
      where: { type: 'DEDUCTION', status: 'SUCCESS', wallet: { userId: { in: clientIds } } },
      _sum: { amount: true }
    });

    // Get wallets for these clients
    const wallets = await prisma.wallet.findMany({
      where: { userId: { in: clientIds } },
      select: { id: true, userId: true }
    });
    const walletToUser = new Map(wallets.map(w => [w.id, w.userId]));
    const userSpending = new Map();
    spendingData.forEach(s => {
      const userId = walletToUser.get(s.walletId);
      if (userId) userSpending.set(userId, Math.abs(s._sum.amount || 0));
    });

    const getSpendingTier = (amount) => {
      if (amount >= 100000) return '100k+ spent';
      if (amount >= 50000) return '50k+ spent';
      if (amount >= 10000) return '10k+ spent';
      if (amount >= 2000) return '2k+ spent';
      return 'New client';
    };

    const enrichedJobs = jobs.map(job => ({
      ...job,
      clientVerified: job.client?.providerProfile?.verification === 'VERIFIED',
      clientSpending: userSpending.get(job.clientId) || 0,
      clientSpendingTier: getSpendingTier(userSpending.get(job.clientId) || 0),
    }));

    res.status(200).json({
      success: true,
      data: enrichedJobs,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    next(error);
  }
};

const applyForJob = async (req, res, next) => {
  try {
    const { jobId } = req.params;
    const providerId = req.user.providerProfile.id;

    const job = await prisma.job.findUnique({ where: { id: jobId }, include: { client: true } });
    if (!job || job.status !== 'PENDING' || job.approvalStatus !== 'APPROVED') {
      return res.status(400).json({ success: false, message: 'Job not available' });
    }

    const existing = await prisma.jobAssignment.findUnique({
      where: { jobId_providerId: { jobId, providerId } }
    });
    if (existing) {
      return res.status(409).json({ success: false, data: existing, message: 'You have already applied for this task.' });
    }

    // Check Wallet for Coins
    const wallet = await prisma.wallet.findUnique({ where: { userId: req.user.id } });
    if (!wallet || wallet.balance < 1) {
      return res.status(403).json({ success: false, message: 'You need at least 1 coin to accept a task. Please top up your wallet.' });
    }

    if (wallet.balance < job.coinCost) {
      return res.status(400).json({ success: false, message: 'Insufficient coins for this specific job. Please top up.' });
    }

    // Atomic transaction: create application and hold the coin until the task is resolved.
    const result = await prisma.$transaction([
      prisma.jobAssignment.create({
        data: { jobId, providerId, status: 'PENDING' }
      }),
      prisma.wallet.update({
        where: { userId: req.user.id },
        data: { balance: { decrement: job.coinCost } }
      }),
      prisma.transaction.create({
        data: {
          walletId: wallet.id,
          amount: -job.coinCost,
          type: 'DEDUCTION',
          status: 'SUCCESS',
          jobId,
          description: `Applied for task: ${job.title}`
        }
      })
    ]);

    const applicationCount = await prisma.jobAssignment.count({ where: { jobId } });

    const notification = await prisma.notification.create({
      data: {
        userId: job.clientId,
        title: 'New provider application',
        body: `${req.user.fullName || 'A provider'} applied for "${job.title}".`,
        data: { type: 'JOB_APPLICATION', jobId, assignmentId: result[0].id }
      }
    });

    try {
      const { getIO } = require('../services/socket.service');
      const io = getIO();
      io.to(job.clientId).emit('job:application-count', { jobId, applicationCount });
      io.to(job.clientId).emit('notification:new', notification);
      io.to(req.user.id).emit('wallet:update', { balance: result[1].balance });
    } catch (err) {
      console.error('[Socket Error] Job application notification failed:', err.message);
    }

    res.status(200).json({ success: true, data: result[0], applicationCount, message: 'Application sent successfully. Your coin is held for this task.' });
  } catch (error) {
    next(error);
  }
};

const selectProviderForJob = async (req, res, next) => {
  try {
    const { jobId, assignmentId } = req.params;

    const job = await prisma.job.findUnique({
      where: { id: jobId },
      include: {
        assignments: {
          include: { provider: { include: { user: true } } }
        }
      }
    });

    if (!job) {
      return res.status(404).json({ success: false, message: 'Job not found' });
    }

    if (job.clientId !== req.user.id) {
      return res.status(403).json({ success: false, message: 'Only the client can choose a provider for this task' });
    }

    if (job.status !== 'PENDING') {
      return res.status(400).json({ success: false, message: 'A provider has already been selected for this task' });
    }

    const selected = job.assignments.find((assignment) => assignment.id === assignmentId);
    if (!selected) {
      return res.status(404).json({ success: false, message: 'Application not found' });
    }

    const updated = await prisma.$transaction(async (tx) => {
      const clientWallet = await tx.wallet.findUnique({ where: { userId: req.user.id } });
      if (!clientWallet || clientWallet.balance < job.coinCost) {
        const error = new Error(`You need at least ${job.coinCost} coin${job.coinCost > 1 ? 's' : ''} to choose a provider.`);
        error.statusCode = 403;
        throw error;
      }

      await tx.wallet.update({
        where: { userId: req.user.id },
        data: { balance: { decrement: job.coinCost } }
      });

      await tx.transaction.create({
        data: {
          walletId: clientWallet.id,
          amount: -job.coinCost,
          type: 'DEDUCTION',
          status: 'SUCCESS',
          jobId,
          description: `Selected provider for task: ${job.title}`
        }
      });

      const rejectedAssignments = job.assignments.filter((assignment) => assignment.id !== assignmentId);

      const assignment = await tx.jobAssignment.update({
        where: { id: assignmentId },
        data: { status: 'ACCEPTED', selectedAt: new Date() },
        include: { provider: { include: { user: true } } }
      });

      await tx.job.update({
        where: { id: jobId },
        data: { status: 'ASSIGNED', selectedAssignmentId: assignmentId }
      });

      await tx.jobAssignment.updateMany({
        where: { jobId, id: { not: assignmentId } },
        data: { status: 'REJECTED', refundedAt: new Date() }
      });

      for (const rejected of rejectedAssignments) {
        const rejectedUserId = rejected.provider?.userId;
        if (!rejectedUserId) continue;

        const providerWallet = await tx.wallet.findUnique({
          where: { userId: rejectedUserId }
        });

        if (providerWallet && !rejected.refundedAt) {
          await tx.wallet.update({
            where: { id: providerWallet.id },
            data: { balance: { increment: job.coinCost } }
          });

          await tx.transaction.create({
            data: {
              walletId: providerWallet.id,
              amount: job.coinCost,
              type: 'REFUND',
              status: 'SUCCESS',
              jobId,
              description: `Coin returned because another provider was selected for: ${job.title}`
            }
          });
        }
      }

      const selectedJob = await tx.job.findUnique({
        where: { id: jobId },
        include: {
          client: true,
          assignments: { include: { provider: { include: { user: true } } } }
        }
      });

      return { assignment, job: selectedJob };
    }, { maxWait: 10000, timeout: 20000 });

    const notification = await prisma.notification.create({
      data: {
        userId: updated.assignment.provider.userId,
        title: 'You were selected',
        body: `${req.user.fullName || 'The client'} selected you for "${job.title}".`,
        data: { type: 'JOB', jobId, assignmentId, status: 'SELECTED' }
      }
    });

    try {
      const { getIO } = require('../services/socket.service');
      const io = getIO();
      io.to(updated.assignment.provider.userId).emit('notification:new', notification);
      io.emit('job:updated', updated.job);

      const selectedWallet = await prisma.wallet.findUnique({ where: { userId: updated.assignment.provider.userId } });
      const clientWallet = await prisma.wallet.findUnique({ where: { userId: req.user.id } });
      if (selectedWallet) io.to(updated.assignment.provider.userId).emit('wallet:update', { balance: selectedWallet.balance });
      if (clientWallet) io.to(req.user.id).emit('wallet:update', { balance: clientWallet.balance });
      const refundedUserIds = updated.job.assignments
        .filter((assignment) => assignment.status === 'REJECTED')
        .map((assignment) => assignment.provider?.userId)
        .filter(Boolean);
      for (const userId of refundedUserIds) {
        const wallet = await prisma.wallet.findUnique({ where: { userId } });
        if (wallet) io.to(userId).emit('wallet:update', { balance: wallet.balance });
      }
    } catch (err) {
      console.error('[Socket Error] Provider selection notification failed:', err.message);
    }

    res.status(200).json({ success: true, data: updated.job, message: 'Provider selected successfully. Client coin was deducted and unselected providers were refunded.' });
  } catch (error) {
    next(error);
  }
};

const updateJobStatus = async (req, res, next) => {
  try {
    const { jobId } = req.params;
    const { status } = req.body; // IN_PROGRESS, COMPLETED, CANCELLED

    const existing = await prisma.job.findUnique({
      where: { id: jobId },
      include: { assignments: { include: { provider: true } } }
    });

    if (!existing) {
      return res.status(404).json({ success: false, message: 'Job not found' });
    }

    const isClient = existing.clientId === req.user.id;
    const isAssignedProvider = existing.assignments.some((assignment) => assignment.provider?.userId === req.user.id);
    const isAdmin = req.user.role === 'ADMIN';

    if (!isClient && !isAssignedProvider && !isAdmin) {
      return res.status(403).json({ success: false, message: 'Not allowed to update this job' });
    }

    const allowedStatuses = ['PENDING', 'ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'];
    if (!allowedStatuses.includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid job status' });
    }

    const job = await prisma.job.update({
      where: { id: jobId },
      data: { status }
    });

    res.status(200).json({ success: true, data: job });
  } catch (error) {
    next(error);
  }
};

const updateJob = async (req, res, next) => {
  try {
    const { jobId } = req.params;
    const existing = await prisma.job.findUnique({ where: { id: jobId } });

    if (!existing) {
      return res.status(404).json({ success: false, message: 'Job not found' });
    }

    if (existing.clientId !== req.user.id && req.user.role !== 'ADMIN') {
      return res.status(403).json({ success: false, message: 'Not allowed to update this job' });
    }

    if (existing.status === 'COMPLETED' || existing.status === 'CANCELLED') {
      return res.status(400).json({ success: false, message: 'Completed or cancelled jobs cannot be edited' });
    }

    const allowed = ['category', 'title', 'description', 'location', 'latitude', 'longitude', 'budget', 'scheduledTime'];
    const data = {};

    allowed.forEach((field) => {
      if (req.body[field] !== undefined) data[field] = req.body[field];
    });

    if (data.budget !== undefined) data.budget = Number(data.budget);
    if (data.scheduledTime !== undefined) data.scheduledTime = data.scheduledTime ? new Date(data.scheduledTime) : null;

    const job = await prisma.job.update({
      where: { id: jobId },
      data
    });

    res.status(200).json({ success: true, data: job });
  } catch (error) {
    next(error);
  }
};

const getAllJobs = async (req, res, next) => {
  try {
    const jobs = await prisma.job.findMany({
      include: { 
        client: { select: { id: true, fullName: true, email: true } },
        assignments: { include: { provider: { include: { user: { select: { id: true, fullName: true } } } } } }
      },
      orderBy: { createdAt: 'desc' }
    });
    res.status(200).json({ success: true, data: jobs });
  } catch (error) {
    next(error);
  }
};

const getProviderJobs = async (req, res, next) => {
  try {
    const providerId = req.user.providerProfile.id;
    const assignments = await prisma.jobAssignment.findMany({
      where: { providerId },
      include: { 
        job: { 
          include: { 
            client: { select: { id: true, fullName: true, avatar: true, phone: true } },
            assignments: { select: { id: true, providerId: true, status: true } }
          } 
        } 
      },
      orderBy: { assignedAt: 'desc' }
    });

    const jobs = assignments.map(a => ({
      ...a.job,
      clientId: a.job.clientId || a.job.client?.id,
      assignmentId: a.id,
      assignmentStatus: a.status
    }));

    res.status(200).json({ success: true, data: jobs });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  createJob,
  getJobById,
  getClientJobs,
  getProviderJobs,
  getAvailableJobsForProvider,
  applyForJob,
  selectProviderForJob,
  updateJobStatus,
  updateJob,
  getAllJobs
};
