const prisma = require('../config/prisma');
const { createJobSchema } = require('../validators/job.validator');
const { calculateProviderStats } = require('../utils/providerStats');

const calculateJobCoinCost = (budget) => {
  const amount = Number(budget || 0);
  if (amount > 10000) {
    return Math.max(2, Math.ceil((amount - 10000) / 25000) + 1);
  }
  return 1;
};

const normalizeBudgetRange = (data) => {
  const budgetMin = Number(data.budgetMin ?? data.budget);
  const budgetMax = Number(data.budgetMax ?? data.budget);
  return {
    budgetMin,
    budgetMax,
    budget: Number(data.budget ?? budgetMax),
  };
};

const parseEstimatedDays = (job) => {
  const candidates = [job.duration, job.estimatedDuration, job.description, job.title]
    .filter(Boolean)
    .map(String)
    .join(' ');
  const match = candidates.match(/\b(\d{1,3})\s*(day|days|jour|jours)\b/i);
  if (!match) return null;
  const days = Number(match[1]);
  return Number.isFinite(days) && days > 0 ? days : null;
};

const addTimingMetadata = (job) => {
  if (!job) return job;
  const status = String(job.status || '').toUpperCase();
  const acceptedAssignment = job.assignments?.find((assignment) => assignment.status === 'ACCEPTED');
  const estimatedDays = parseEstimatedDays(job);
  const startDate = acceptedAssignment?.selectedAt || job.updatedAt || job.createdAt;
  let expectedCompletionAt = null;

  if (status === 'IN_PROGRESS') {
    if (estimatedDays && startDate) {
      const due = new Date(startDate);
      due.setDate(due.getDate() + estimatedDays);
      expectedCompletionAt = due.toISOString();
    } else if (job.scheduledTime) {
      expectedCompletionAt = new Date(job.scheduledTime).toISOString();
    }
  }

  return {
    ...job,
    estimatedDurationDays: estimatedDays,
    expectedCompletionAt,
    isPastExpectedCompletion: Boolean(expectedCompletionAt && new Date(expectedCompletionAt) < new Date() && status === 'IN_PROGRESS'),
  };
};

const createJob = async (req, res, next) => {
  try {
    const validatedData = createJobSchema.parse(req.body);
    const budgetRange = normalizeBudgetRange(validatedData);

    const job = await prisma.job.create({
      data: {
        ...validatedData,
        ...budgetRange,
        clientId: req.user.id,
        status: 'OPEN',
        coinCost: calculateJobCoinCost(budgetRange.budgetMax),
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
    const page = parseInt(req.query.page) || 1;
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const skip = (page - 1) * limit;

    const items = await prisma.job.findMany({
      where: { clientId: req.user.id },
      include: {
        _count: { select: { assignments: true } },
        assignments: {
          include: {
            provider: { include: { user: true, documents: true } }
          },
          orderBy: { assignedAt: 'desc' }
        }
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit
    });

    res.status(200).json({
      success: true,
      data: items.map(addTimingMetadata),
      pagination: {
        page,
        limit,
        total: items.length,
        pages: 1,
        hasMore: items.length === limit
      }
    });
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
        client: { select: { id: true, fullName: true, avatar: true, phone: true, providerProfile: { select: { verification: true } } } },
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

    res.status(200).json({
      success: true,
      data: {
        ...addTimingMetadata(job),
        client: {
          ...job.client,
          isVerified: job.client?.providerProfile?.verification === 'VERIFIED',
        },
        clientVerified: job.client?.providerProfile?.verification === 'VERIFIED',
      }
    });
  } catch (error) {
    next(error);
  }
};

const getAvailableJobsForProvider = async (req, res, next) => {
  try {
    const { page = 1, limit = 10, search = '', location = '', sortBy = 'newest', budgetMin, budgetMax } = req.query;
    const skip = (page - 1) * limit;

    // Build where clause for filtering
    const whereClause = {
      status: 'OPEN',
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
    if (budgetMin || budgetMax) {
      whereClause.AND = [
        ...(budgetMin ? [{ budgetMax: { gte: Number(budgetMin) } }] : []),
        ...(budgetMax ? [{ budgetMin: { lte: Number(budgetMax) } }] : []),
      ];
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

    const enrichedJobs = jobs.map(job => addTimingMetadata({
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
    if (!job || job.status !== 'OPEN' || job.approvalStatus !== 'APPROVED') {
      return res.status(400).json({ success: false, message: 'Job not available' });
    }

    const existing = await prisma.jobAssignment.findUnique({
      where: { jobId_providerId: { jobId, providerId } }
    });
    if (existing) {
      return res.status(409).json({ success: false, data: existing, message: 'You have already applied for this task.' });
    }

    if (!req.user.isOnline) {
      return res.status(403).json({ success: false, message: 'You must be available for work to apply for tasks.' });
    }

    // Providers can apply for free, but must have enough coins for the task before applying.
    // The coins are deducted only if the client selects this provider.
    const wallet = await prisma.wallet.findUnique({ where: { userId: req.user.id } });
    if (!wallet || wallet.balance < job.coinCost) {
      return res.status(403).json({ success: false, message: `You need at least ${job.coinCost} coin${job.coinCost > 1 ? 's' : ''} in your balance to apply for this task.` });
    }

    const assignment = await prisma.jobAssignment.create({
      data: { jobId, providerId, status: 'PENDING' }
    });

    const applicationCount = await prisma.jobAssignment.count({ where: { jobId } });

    const notification = await prisma.notification.create({
      data: {
        userId: job.clientId,
        title: 'New provider application',
        body: `${req.user.fullName || 'A provider'} applied for "${job.title}".`,
        data: { type: 'JOB_APPLICATION', jobId, assignmentId: assignment.id }
      }
    });

    try {
      const { getIO } = require('../services/socket.service');
      const io = getIO();
      io.to(job.clientId).emit('job:application-count', { jobId, applicationCount });
      io.to(job.clientId).emit('notification:new', notification);
    } catch (err) {
      console.error('[Socket Error] Job application notification failed:', err.message);
    }

    try {
      const { sendPushNotification } = require('../services/notification.service');
      await sendPushNotification(
        job.clientId,
        'New Application',
        `${req.user.fullName || 'A provider'} applied to your task: ${job.title}`,
        { type: 'NEW_APPLICATION', jobId, assignmentId: assignment.id }
      );
    } catch (pushErr) {
      console.error('[Push Error] Application push failed:', pushErr.message);
    }

    res.status(200).json({ success: true, data: assignment, applicationCount, message: 'Application sent successfully. Coins are only deducted if the client selects you.' });
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

    if (job.status !== 'OPEN') {
      return res.status(400).json({ success: false, message: 'A provider has already been selected for this task' });
    }

    const selected = job.assignments.find((assignment) => assignment.id === assignmentId);
    if (!selected) {
      return res.status(404).json({ success: false, message: 'Application not found' });
    }

    const updated = await prisma.$transaction(async (tx) => {
      const selectedUserId = selected.provider?.userId;
      const providerWallet = selectedUserId ? await tx.wallet.findUnique({ where: { userId: selectedUserId } }) : null;
      if (!providerWallet || providerWallet.balance < job.coinCost) {
        const error = new Error(`This provider does not have the ${job.coinCost} coin${job.coinCost > 1 ? 's' : ''} required for this task.`);
        error.statusCode = 403;
        throw error;
      }

      await tx.wallet.update({
        where: { id: providerWallet.id },
        data: { balance: { decrement: job.coinCost } }
      });

      await tx.transaction.create({
        data: {
          walletId: providerWallet.id,
          amount: -job.coinCost,
          type: 'DEDUCTION',
          status: 'SUCCESS',
          jobId,
          description: `Selected for task: ${job.title}`
        }
      });

      const assignment = await tx.jobAssignment.update({
        where: { id: assignmentId },
        data: { status: 'ACCEPTED', selectedAt: new Date() },
        include: { provider: { include: { user: true } } }
      });

      await tx.job.update({
        where: { id: jobId },
        data: { status: 'IN_PROGRESS', selectedAssignmentId: assignmentId }
      });

      await tx.jobAssignment.updateMany({
        where: { jobId, id: { not: assignmentId } },
        data: { status: 'REJECTED' }
      });

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
      if (selectedWallet) io.to(updated.assignment.provider.userId).emit('wallet:update', { balance: selectedWallet.balance });
    } catch (err) {
      console.error('[Socket Error] Provider selection notification failed:', err.message);
    }

    try {
      const { sendPushNotification } = require('../services/notification.service');
      await sendPushNotification(
        updated.assignment.provider.userId,
        'Application Accepted! 🎉',
        `You were selected for: ${job.title}`,
        { type: 'APPLICATION_ACCEPTED', jobId }
      );
    } catch (pushErr) {
      console.error('[Push Error] Selection push failed:', pushErr.message);
    }

    res.status(200).json({ success: true, data: updated.job, message: 'Provider selected successfully. Provider coins were deducted.' });
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

    if (status === 'COMPLETED') {
      await Promise.all(
        existing.assignments
          .filter((assignment) => assignment.status === 'ACCEPTED')
          .map((assignment) => calculateProviderStats(assignment.providerId).catch(() => null))
      );

      try {
        const { sendPushNotification } = require('../services/notification.service');
        const providerId = existing.assignments.find(a => a.status === 'ACCEPTED')?.provider?.userId;
        
        // Notify client
        if (req.user.id !== existing.clientId) {
          await sendPushNotification(
            existing.clientId,
            'Task Completed',
            `${req.user.fullName || 'Your provider'} marked your task as complete`,
            { type: 'JOB_COMPLETED', jobId }
          );
        }
        
        // Notify provider
        if (providerId && req.user.id !== providerId) {
          await sendPushNotification(
            providerId,
            'Task Marked Complete',
            `Great work on: ${existing.title}`,
            { type: 'JOB_COMPLETED', jobId }
          );
        }
      } catch (pushErr) {
        console.error('[Push Error] Job complete push failed:', pushErr.message);
      }
    }
      try {
        const { getIO } = require('../services/socket.service');
        const io = getIO();
        io.to(existing.clientId).emit('job:updated', job);
        
        const providerId = existing.assignments.find(a => a.status === 'ACCEPTED')?.provider?.userId;
        if (providerId) {
          io.to(providerId).emit('job:updated', job);
        }
      } catch (socketErr) {
        console.error('[Socket Error] Job status update failed:', socketErr.message);
      }

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

    const allowed = ['category', 'title', 'description', 'location', 'latitude', 'longitude', 'budget', 'budgetMin', 'budgetMax', 'scheduledTime'];
    const data = {};

    allowed.forEach((field) => {
      if (req.body[field] !== undefined) data[field] = req.body[field];
    });

    if (data.budget !== undefined || data.budgetMin !== undefined || data.budgetMax !== undefined) {
      const budgetRange = normalizeBudgetRange({ ...existing, ...data });
      data.budget = budgetRange.budget;
      data.budgetMin = budgetRange.budgetMin;
      data.budgetMax = budgetRange.budgetMax;
      data.coinCost = calculateJobCoinCost(budgetRange.budgetMax);
    }
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
    const page = parseInt(req.query.page) || 1;
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const skip = (page - 1) * limit;

    const [items, total] = await prisma.$transaction([
      prisma.job.findMany({
        include: { 
          client: { select: { id: true, fullName: true, email: true, avatar: true } },
          assignments: { include: { provider: { include: { user: { select: { id: true, fullName: true, avatar: true } } } } } }
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit
      }),
      prisma.job.count()
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

const getProviderJobs = async (req, res, next) => {
  try {
    const providerId = req.user.providerProfile.id;
    const page = parseInt(req.query.page) || 1;
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const skip = (page - 1) * limit;

    const assignments = await prisma.jobAssignment.findMany({
      where: { providerId },
      include: { 
        job: { 
          include: { 
            client: { select: { id: true, fullName: true, avatar: true, phone: true } },
            assignments: { 
              where: { status: 'ACCEPTED' },
              select: { id: true, providerId: true, status: true, selectedAt: true }
            }
          } 
        } 
      },
      orderBy: { assignedAt: 'desc' },
      skip,
      take: limit
    });

    const items = assignments.map(a => addTimingMetadata({
      ...a.job,
      clientId: a.job.clientId || a.job.client?.id,
      assignmentId: a.id,
      assignmentStatus: a.status
    }));

    res.status(200).json({
      success: true,
      data: items,
      pagination: {
        page,
        limit,
        total: items.length,
        pages: 1,
        hasMore: items.length === limit
      }
    });
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
