const prisma = require('../config/prisma');
const { createJobSchema } = require('../validators/job.validator');
const { calculateProviderStats } = require('../utils/providerStats');
const agreementService = require('../services/agreement.service');

const calculateJobCoinCost = (providersCount) => {
  const count = parseInt(providersCount) || 1;
  if (count >= 1 && count <= 5) return 1;
  if (count >= 6 && count <= 10) return 2;
  if (count >= 11 && count <= 20) return 3;
  if (count >= 21 && count <= 30) return 4;
  return 5;
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

    // 1. Fetch latest user profile to ensure up-to-date verification & wallet states
    const clientUser = await prisma.user.findUnique({
      where: { id: req.user.id },
      include: { providerProfile: true, wallet: true }
    });

    // 2. Check client verification status
    const verificationStatus = clientUser?.providerProfile?.verification;
    if (verificationStatus !== 'VERIFIED') {
      return res.status(403).json({
        success: false,
        message: 'Your account must be verified before you can post a task.',
        code: verificationStatus === 'PENDING' ? 'VERIFICATION_PENDING' : 'VERIFICATION_REQUIRED'
      });
    }

    // 3. Check client wallet balance
    const providersNeeded = validatedData.providersNeeded || 1;
    const coinCost = calculateJobCoinCost(providersNeeded);
    const clientWallet = clientUser?.wallet;
    if (!clientWallet || clientWallet.balance < coinCost) {
      return res.status(400).json({
        success: false,
        message: `You do not have enough coins to post this task. Cost is ${coinCost} coins. Please top up.`
      });
    }

    // 4. Deduct coins and create job in a transaction
    const job = await prisma.$transaction(async (tx) => {
      // Decrement wallet balance
      await tx.wallet.update({
        where: { id: clientWallet.id },
        data: { balance: { decrement: coinCost } }
      });

      // Record deduction transaction
      await tx.transaction.create({
        data: {
          walletId: clientWallet.id,
          amount: -coinCost,
          type: 'DEDUCTION',
          status: 'SUCCESS',
          description: `Posted task: ${validatedData.title}`
        }
      });

      // Determine if the job is remote
      const { isRemoteSkill } = require('../utils/skillClassifier');
      const isRemote = typeof validatedData.isRemote === 'boolean'
        ? validatedData.isRemote
        : isRemoteSkill(validatedData.category);

      const isDiagnosisReq = Boolean(req.body.requiresDiagnosis || validatedData.requiresDiagnosis);
      const rawMaterials = req.body.materialsList || validatedData.materialsList;
      const formattedMaterials = isDiagnosisReq ? null : (Array.isArray(rawMaterials) ? rawMaterials : []);
      const materialsStatus = isDiagnosisReq ? 'DIAGNOSIS_REQUIRED' : (formattedMaterials && formattedMaterials.length > 0 ? 'PENDING_AGREEMENT' : 'AGREED');

      // Create job
      return await tx.job.create({
        data: {
          ...validatedData,
          ...budgetRange,
          providersNeeded,
          coinCost,
          clientId: req.user.id,
          status: 'PENDING',
          approvalStatus: 'PENDING_APPROVAL',  // New jobs require admin approval
          scheduledTime: validatedData.scheduledTime ? new Date(validatedData.scheduledTime) : null,
          isRemote,
          country: clientUser.country || 'Cameroon',
          requiresDiagnosis: isDiagnosisReq,
          diagnosisStatus: isDiagnosisReq ? 'PENDING_DIAGNOSIS' : null,
          materialsList: formattedMaterials,
          materialsStatus: materialsStatus,
          materialsVersion: 1,
        }
      });
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

    // Fast ETag check
    const [latestJob, total] = await Promise.all([
      prisma.job.findFirst({
        where: { clientId: req.user.id },
        orderBy: { updatedAt: 'desc' },
        select: { updatedAt: true }
      }),
      prisma.job.count({ where: { clientId: req.user.id } })
    ]);

    const lastUpdated = latestJob ? latestJob.updatedAt.getTime() : 0;
    const etag = `W/"${lastUpdated}-${total}-${page}-${limit}"`;

    if (req.headers['if-none-match'] === etag) {
      return res.status(304).end();
    }
    res.setHeader('ETag', etag);

    const items = await prisma.job.findMany({
      where: { clientId: req.user.id },
      include: {
        _count: { select: { assignments: true } },
        assignments: {
          include: {
            provider: { include: { user: true, documents: true } }
          },
          orderBy: { assignedAt: 'desc' }
        },
        reviews: {
          where: { reviewerId: req.user.id },
          select: { id: true, reviewerId: true, targetUserId: true, rating: true, createdAt: true }
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

    const sortedAssignments = [...(job.assignments || [])].sort((a, b) => {
      if ((b.boostCoins || 0) !== (a.boostCoins || 0)) {
        return (b.boostCoins || 0) - (a.boostCoins || 0);
      }
      return new Date(a.assignedAt).getTime() - new Date(b.assignedAt).getTime();
    });

    const filteredAssignments = sortedAssignments.map((assignment, index) => {
      const isOwn = assignment.provider?.userId === req.user.id;
      if (isClient || isAdmin || isOwn) {
        return {
          ...assignment,
          isAnonymous: false
        };
      }
      return {
        id: `anon-${index}`,
        boostCoins: assignment.boostCoins || 0,
        status: assignment.status,
        assignedAt: assignment.assignedAt,
        isAnonymous: true,
        provider: {
          id: `anon-prov-${index}`,
          user: {
            fullName: `Provider #${index + 1}`,
            avatar: null,
            isAnonymous: true
          }
        }
      };
    });

    res.status(200).json({
      success: true,
      data: {
        ...addTimingMetadata(job),
        assignments: filteredAssignments,
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
    const { page = 1, limit = 10, search = '', location = '', sortBy = 'newest', budgetMin, budgetMax, jobType = '' } = req.query;
    const skip = (page - 1) * limit;

    // Build where clause for filtering
    const whereClause = {
      clientId: { not: req.user.id }, // Exclude own tasks
      status: 'PENDING',
      approvalStatus: 'APPROVED',  // Only show approved jobs
      assignments: {
        none: {
          OR: [
            { provider: { userId: req.user.id } },
            { status: 'ACCEPTED' } // Exclude accepted tasks
          ]
        }
      }
    };

    // Filter by provider's country and location for local jobs, or show remote jobs from any country
    const providerCountry = req.user.country || 'Cameroon';

    if (jobType === 'remote') {
      whereClause.isRemote = true;
    } else if (jobType === 'physical') {
      whereClause.OR = [
        { isRemote: false, country: providerCountry },
        { isRemote: false }
      ];
    } else {
      whereClause.OR = [
        { isRemote: true },
        { isRemote: false, country: providerCountry },
        { isRemote: false, country: null },
        { isRemote: false, country: '' }
      ];
    }

    // Add search filter (nested inside AND to work with OR)
    if (search) {
      whereClause.AND = [
        {
          OR: [
            { title: { contains: search, mode: 'insensitive' } },
            { description: { contains: search, mode: 'insensitive' } },
            { category: { contains: search, mode: 'insensitive' } }
          ]
        }
      ];
    }

    // Add manual location filter if explicitly requested in query
    if (location) {
      whereClause.AND = [
        ...(whereClause.AND || []),
        { location: { contains: location, mode: 'insensitive' } }
      ];
    }
    if (budgetMin || budgetMax) {
      whereClause.AND = [
        ...(whereClause.AND || []),
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
        assignments: { 
          select: { 
            id: true, 
            providerId: true, 
            status: true, 
            boostCoins: true, 
            assignedAt: true,
            provider: {
              select: {
                id: true,
                user: {
                  select: { id: true, fullName: true, avatar: true }
                }
              }
            }
          } 
        }
      },
      orderBy,
      skip,
      take: parseInt(limit)
    });

    if (!jobs || jobs.length === 0) {
      return res.status(200).json({
        success: true,
        data: [],
        pagination: {
          total: 0,
          page: parseInt(page),
          limit: parseInt(limit),
          pages: 0
        }
      });
    }

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

    // Get review counts for each client
    const reviewCounts = await prisma.review.groupBy({
      by: ['targetUserId'],
      where: { targetUserId: { in: clientIds } },
      _count: { id: true }
    });
    const userReviews = new Map(reviewCounts.map(r => [r.targetUserId, r._count.id]));

    const enrichedJobs = jobs.map(job => addTimingMetadata({
      ...job,
      clientVerified: job.client?.providerProfile?.verification === 'VERIFIED',
      clientSpending: userSpending.get(job.clientId) || 0,
      clientSpendingTier: getSpendingTier(userSpending.get(job.clientId) || 0),
      clientReviewCount: userReviews.get(job.clientId) || 0,
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

    if (req.user.isBlocked) {
      return res.status(403).json({ success: false, message: req.user.blockedReason || 'This account has been blocked.', code: 'ACCOUNT_BLOCKED' });
    }

    const verificationStatus = req.user.providerProfile?.verification;
    if (verificationStatus !== 'VERIFIED') {
      return res.status(403).json({
        success: false,
        message: 'Please verify your identity before applying to jobs.',
        requiresVerification: true,
        code: verificationStatus === 'PENDING' ? 'VERIFICATION_PENDING' : 'VERIFICATION_REQUIRED'
      });
    }

    const job = await prisma.job.findUnique({ where: { id: jobId }, include: { client: true } });
    if (!job || job.status !== 'PENDING' || job.approvalStatus !== 'APPROVED') {
      return res.status(400).json({ success: false, message: 'Job not available' });
    }

    const wallet = await prisma.wallet.findUnique({ where: { userId: req.user.id } });
    const boostCoinsAmount = Math.max(0, Number(req.body.boostCoins || 0));
    const coverLetter = typeof req.body.coverLetter === 'string' ? req.body.coverLetter.trim() : null;

    const existing = await prisma.jobAssignment.findUnique({
      where: { jobId_providerId: { jobId, providerId } }
    });
    if (existing) {
      if (boostCoinsAmount > (existing.boostCoins || 0)) {
        const extraBoostCoins = boostCoinsAmount - (existing.boostCoins || 0);
        if (!wallet || wallet.balance < extraBoostCoins) {
          return res.status(403).json({ 
            success: false, 
            message: `You need at least ${extraBoostCoins} coin${extraBoostCoins > 1 ? 's' : ''} in your balance to boost this proposal.`, 
            code: 'INSUFFICIENT_COINS' 
          });
        }
        await prisma.$transaction([
          prisma.wallet.update({
            where: { id: wallet.id },
            data: { balance: { decrement: extraBoostCoins } }
          }),
          prisma.transaction.create({
            data: {
              walletId: wallet.id,
              amount: -extraBoostCoins,
              type: 'DEDUCTION',
              status: 'SUCCESS',
              reference: `BID_BOOST-${Date.now()}`,
              description: `Bid boost for task: ${job.title}`
            }
          })
        ]);
        const updatedAssignment = await prisma.jobAssignment.update({
          where: { id: existing.id },
          data: { boostCoins: boostCoinsAmount }
        });
        return res.status(200).json({
          success: true,
          data: updatedAssignment,
          message: `Proposal boosted successfully to ${boostCoinsAmount} coins! If not selected, boost coins will be refunded.`
        });
      }
      return res.status(409).json({ success: false, data: existing, message: 'You have already applied for this task.', code: 'ALREADY_APPLIED' });
    }

    if (!req.user.isOnline) {
      return res.status(403).json({ success: false, message: 'You must be available for work to apply for tasks.', code: 'PROVIDER_OFFLINE' });
    }

    if (boostCoinsAmount > 0) {
      if (!wallet || wallet.balance < boostCoinsAmount) {
        return res.status(403).json({ 
          success: false, 
          message: `You need at least ${boostCoinsAmount} coin${boostCoinsAmount > 1 ? 's' : ''} in your balance to boost this task.`, 
          code: 'INSUFFICIENT_COINS' 
        });
      }
      await prisma.$transaction([
        prisma.wallet.update({
          where: { id: wallet.id },
          data: { balance: { decrement: boostCoinsAmount } }
        }),
        prisma.transaction.create({
          data: {
            walletId: wallet.id,
            amount: -boostCoinsAmount,
            type: 'DEDUCTION',
            status: 'SUCCESS',
            reference: `BID_BOOST-${Date.now()}`,
            description: `Bid boost for task: ${job.title}`
          }
        })
      ]);
    }

    const { coverLetter, boostCoins, materialsList } = req.body;

    const assignment = await prisma.jobAssignment.create({
      data: { 
        jobId, 
        providerId, 
        status: 'PENDING', 
        boostCoins: boostCoinsAmount,
        coverLetter: coverLetter || null,
        materialsList: Array.isArray(materialsList) ? materialsList : null
      }
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

    const acceptedCount = job.assignments.filter(a => a.status === 'ACCEPTED').length;
    if (job.status !== 'PENDING' || acceptedCount >= (job.providersNeeded || 1)) {
      return res.status(400).json({ success: false, message: 'All required providers have already been selected for this task' });
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

      // Deduct base task coin cost from selected provider
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

      // Find all unselected pending assignments for this task that spent boost coins
      const unselectedAssignments = await tx.jobAssignment.findMany({
        where: { jobId, status: 'PENDING', id: { not: assignmentId } },
        include: { provider: true }
      });

      const refundedProviders = [];

      const newAcceptedCount = acceptedCount + 1;
      const finalMaterials = assignment.materialsList || job.materialsList || [];
      const updatedJobStatus = newAcceptedCount >= (job.providersNeeded || 1) ? 'IN_PROGRESS' : job.status;

      await tx.job.update({
        where: { id: jobId },
        data: {
          status: updatedJobStatus,
          selectedAssignmentId: assignmentId,
          materialsList: finalMaterials,
          materialsStatus: job.requiresDiagnosis ? 'DIAGNOSIS_REQUIRED' : 'AGREED',
          materialsVersion: 1,
        }
      });

      if (!job.requiresDiagnosis && finalMaterials && finalMaterials.length > 0) {
        await tx.agreementAmendment.create({
          data: {
            jobId,
            type: 'MATERIALS',
            version: 1,
            status: 'AGREED',
            proposedByUserId: assignment.provider?.userId || req.user.id,
            acceptedByUserId: req.user.id,
            materials: finalMaterials,
            price: job.budget,
            notes: 'Final materials list agreed upon provider selection.'
          }
        });
      }

      // Auto-generate Task Service Agreement
      agreementService.createOrUpdateAgreement({
        sourceType: 'TASK',
        taskId: jobId,
        clientId: job.clientId,
        providerId: assignment.provider?.userId || req.user.id,
        title: job.title || 'Task Service',
        category: job.category || 'General',
        scopeOfWork: job.description || 'As described in job posting.',
        location: job.location || 'Client location',
        schedule: {
          date: job.scheduledTime ? new Date(job.scheduledTime).toLocaleDateString() : 'As scheduled',
          time: 'Scheduled Time',
          duration: 'Standard',
          urgency: job.priority || 'Normal'
        },
        price: job.budget,
        materialsList: finalMaterials
      }).catch(err => console.error('[Agreement Service Task] Error:', err.message));

        // Refund boost coins to all unselected providers
        for (const unselected of unselectedAssignments) {
          const unselectedBoost = Number(unselected.boostCoins || 0);
          const unselectedUserId = unselected.provider?.userId;
          if (unselectedBoost > 0 && unselectedUserId) {
            const uWallet = await tx.wallet.findUnique({ where: { userId: unselectedUserId } });
            if (uWallet) {
              await tx.wallet.update({
                where: { id: uWallet.id },
                data: { balance: { increment: unselectedBoost } }
              });
              await tx.transaction.create({
                data: {
                  walletId: uWallet.id,
                  amount: unselectedBoost,
                  type: 'REFUND',
                  status: 'SUCCESS',
                  jobId,
                  reference: `BID_BOOST_REFUND-${Date.now()}`,
                  description: `Refund for unselected boost bid: ${job.title}`
                }
              });
              refundedProviders.push({ userId: unselectedUserId, coins: unselectedBoost });
            }
          }
        }

        await tx.jobAssignment.updateMany({
          where: { jobId, status: 'PENDING' },
          data: { status: 'REJECTED' }
        });
      } else {
        await tx.job.update({
          where: { id: jobId },
          data: { selectedAssignmentId: assignmentId }
        });
      }

      const selectedJob = await tx.job.findUnique({
        where: { id: jobId },
        include: {
          client: true,
          assignments: { include: { provider: { include: { user: true } } } }
        }
      });

      return { assignment, job: selectedJob, refundedProviders };
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

    // Send notifications & update wallet balance for refunded unselected providers
    if (Array.isArray(updated.refundedProviders) && updated.refundedProviders.length > 0) {
      for (const item of updated.refundedProviders) {
        try {
          const refundNotif = await prisma.notification.create({
            data: {
              userId: item.userId,
              title: 'Boost Coins Refunded 🪙',
              body: `Your ${item.coins} boost coins have been refunded because another provider was selected for "${job.title}".`,
              data: { type: 'BOOST_REFUND', jobId, coins: item.coins }
            }
          });
          const { getIO } = require('../services/socket.service');
          const io = getIO();
          io.to(item.userId).emit('notification:new', refundNotif);
          const rWallet = await prisma.wallet.findUnique({ where: { userId: item.userId } });
          if (rWallet) io.to(item.userId).emit('wallet:update', { balance: rWallet.balance });

          const { sendPushNotification } = require('../services/notification.service');
          await sendPushNotification(
            item.userId,
            'Boost Coins Refunded 🪙',
            `Your ${item.coins} boost coins have been refunded because another provider was selected for "${job.title}".`,
            { type: 'BOOST_REFUND', jobId, coins: item.coins }
          );
        } catch (rErr) {
          console.error('[Refund Notification Error]:', rErr.message);
        }
      }
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

      const acceptedProviderUserId = existing.assignments.find(a => a.status === 'ACCEPTED')?.provider?.userId;
      if (acceptedProviderUserId) {
        const { checkAndAwardLevelUp } = require('../utils/levelUpReward');
        await checkAndAwardLevelUp(acceptedProviderUserId);
      }

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

    // Fast ETag check
    const [latestAssignment, total] = await Promise.all([
      prisma.jobAssignment.findFirst({
        where: { providerId },
        orderBy: { assignedAt: 'desc' },
        select: { assignedAt: true }
      }),
      prisma.jobAssignment.count({ where: { providerId } })
    ]);

    const lastUpdated = latestAssignment ? latestAssignment.assignedAt.getTime() : 0;
    const etag = `W/"${lastUpdated}-${total}-${page}-${limit}"`;

    if (req.headers['if-none-match'] === etag) {
      return res.status(304).end();
    }
    res.setHeader('ETag', etag);

    const assignments = await prisma.jobAssignment.findMany({
      where: { providerId },
      include: { 
        job: { 
          include: { 
            client: { select: { id: true, fullName: true, avatar: true, phone: true } },
            assignments: { 
              where: { status: 'ACCEPTED' },
              select: { id: true, providerId: true, status: true, selectedAt: true }
            },
            reviews: {
              where: { reviewerId: req.user.id },
              select: { id: true, reviewerId: true, targetUserId: true, rating: true, createdAt: true }
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
        total,
        pages: Math.ceil(total / limit),
        hasMore: page * limit < total
      }
    });
  } catch (error) {
    next(error);
  }
};

const getPopularCategories = async (req, res, next) => {
  try {
    const userCountry = req.user?.country || 'Cameroon';
    const categoryCounts = await prisma.job.groupBy({
      by: ['category'],
      where: { country: userCountry },
      _count: { category: true },
      orderBy: { _count: { category: 'desc' } },
    });
    
    res.json({
      success: true,
      data: categoryCounts
    });
  } catch (error) {
    next(error);
  }
};

const proposeDiagnosisMaterials = async (req, res, next) => {
  try {
    const { jobId } = req.params;
    const { materialsList, notes } = req.body;

    if (!Array.isArray(materialsList) || materialsList.length === 0) {
      return res.status(400).json({ success: false, message: 'Please provide at least one item in the materials list.' });
    }

    const job = await prisma.job.findUnique({
      where: { id: jobId },
      include: { assignments: { include: { provider: true } } }
    });

    if (!job) {
      return res.status(404).json({ success: false, message: 'Job not found.' });
    }

    const isAssignedProvider = job.assignments.some(a => a.status === 'ACCEPTED' && a.provider?.userId === req.user.id);
    if (!isAssignedProvider) {
      return res.status(403).json({ success: false, message: 'Only the assigned provider can propose materials for this job.' });
    }

    const updated = await prisma.job.update({
      where: { id: jobId },
      data: {
        materialsList: materialsList,
        materialsStatus: 'COUNTER_PROPOSED',
        diagnosisStatus: 'DIAGNOSED',
      }
    });

    await prisma.notification.create({
      data: {
        userId: job.clientId,
        title: 'Post-Diagnosis Materials Proposed 🧰',
        body: `The provider proposed a materials list for "${job.title}".`,
        data: { type: 'JOB_MATERIALS_PROPOSED', jobId: job.id }
      }
    });

    res.status(200).json({ success: true, data: updated, message: 'Job materials list proposed successfully.' });
  } catch (error) {
    next(error);
  }
};

const respondToMaterialsProposal = async (req, res, next) => {
  try {
    const { jobId } = req.params;
    const { action, notes } = req.body; // 'ACCEPT' | 'REJECT'

    const job = await prisma.job.findUnique({
      where: { id: jobId },
      include: { assignments: { where: { status: 'ACCEPTED' }, include: { provider: true } } }
    });

    if (!job) {
      return res.status(404).json({ success: false, message: 'Job not found.' });
    }

    if (job.clientId !== req.user.id) {
      return res.status(403).json({ success: false, message: 'Only the job client can respond to a materials proposal.' });
    }

    if (action === 'REJECT') {
      const updated = await prisma.job.update({
        where: { id: jobId },
        data: { materialsStatus: 'REJECTED' }
      });
      return res.status(200).json({ success: true, data: updated, message: 'Materials proposal rejected.' });
    }

    const existingAgreements = await prisma.agreementAmendment.count({ where: { jobId } });
    const nextVersion = existingAgreements + 1;
    const assignedProviderUserId = job.assignments[0]?.provider?.userId || req.user.id;

    await prisma.agreementAmendment.create({
      data: {
        jobId,
        type: 'MATERIALS',
        version: nextVersion,
        status: 'AGREED',
        proposedByUserId: assignedProviderUserId,
        acceptedByUserId: req.user.id,
        materials: job.materialsList || [],
        price: job.budget,
        notes: notes || 'Materials list accepted by client after diagnosis review.'
      }
    });

    const updated = await prisma.job.update({
      where: { id: jobId },
      data: {
        materialsStatus: 'AGREED',
        materialsVersion: nextVersion
      }
    });

    res.status(200).json({ success: true, data: updated, message: 'Materials list accepted and committed to agreement history.' });
  } catch (error) {
    next(error);
  }
};

const getAgreementHistory = async (req, res, next) => {
  try {
    const { jobId } = req.params;
    const job = await prisma.job.findUnique({
      where: { id: jobId },
      include: { agreements: { orderBy: { version: 'asc' } } }
    });

    if (!job) {
      return res.status(404).json({ success: false, message: 'Job not found.' });
    }

    res.status(200).json({
      success: true,
      data: {
        activeMaterialsList: job.materialsList,
        materialsStatus: job.materialsStatus,
        materialsVersion: job.materialsVersion,
        requiresDiagnosis: job.requiresDiagnosis,
        agreements: job.agreements
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
  getAllJobs,
  getPopularCategories,
  proposeDiagnosisMaterials,
  respondToMaterialsProposal,
  getAgreementHistory
};
