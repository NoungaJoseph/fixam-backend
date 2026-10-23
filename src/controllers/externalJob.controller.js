const prisma = require('../config/prisma');
const { sendExternalJobApplication } = require('../services/email.service');
const { normalizeQuestions, validateAnswers, pairQuestionsAndAnswers } = require('../utils/screeningQuestions');
const { uploadFile } = require('../services/storage.service');
const axios = require('axios');

const normaliseDetails = (details) => {
  if (!Array.isArray(details)) return null;
  const allowedKeys = new Set(['description', 'responsibilities', 'requirements', 'skills', 'benefits', 'applicationNotes']);
  return details
    .filter((item) => item && allowedKeys.has(item.key) && typeof item.content === 'string' && item.content.trim())
    .map((item) => ({ key: item.key, label: String(item.label || item.key).trim().slice(0, 80), content: item.content.trim().slice(0, 5000) }));
};

/**
 * Helper to fetch configurable recheck days from Settings table
 */
const getRecheckThresholdDays = async () => {
  try {
    const settings = await prisma.settings.findUnique({
      where: { id: 'global' },
      select: { externalJobRecheckDays: true }
    });
    return settings?.externalJobRecheckDays || 14;
  } catch (err) {
    console.warn('[ExternalJobs] Could not load settings, fallback to 14 days:', err.message);
    return 14;
  }
};

/**
 * ==========================================
 * ADMIN CONTROLLERS
 * ==========================================
 */

// POST /api/admin/external-jobs
const createExternalJob = async (req, res, next) => {
  try {
    if (req.user?.role !== 'ADMIN') {
      return res.status(403).json({
        success: false,
        message: 'Forbidden. Only the Fixam admin team can post external job listings.'
      });
    }

    const {
      title,
      companyName,
      description,
      requirements,
      details,
      destinationEmail,
      source,
      expiryDate,
      category,
      location,
      isRemote,
      country,
      salary,
      currency
      , applicationQuestions
    } = req.body;

    if (!title || !companyName || !description || !destinationEmail || !expiryDate) {
      return res.status(400).json({
        success: false,
        message: 'Title, company name, description, destination application email, and expiry date are required.'
      });
    }

    const cleanDestinationEmail = destinationEmail.trim().toLowerCase();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(cleanDestinationEmail)) {
      return res.status(400).json({
        success: false,
        message: 'Please provide a valid destination application email address.'
      });
    }

    let parsedExpiry;
    if (typeof expiryDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(expiryDate.trim())) {
      parsedExpiry = new Date(`${expiryDate.trim()}T23:59:59.999Z`);
    } else {
      parsedExpiry = new Date(expiryDate);
    }

    if (isNaN(parsedExpiry.getTime())) {
      return res.status(400).json({
        success: false,
        message: 'Invalid expiry date format.'
      });
    }

    const recheckDays = await getRecheckThresholdDays();
    const now = new Date();
    const reverifyAt = new Date(now.getTime() + recheckDays * 24 * 60 * 60 * 1000);
    const verifierName = req.user?.fullName || req.user?.phone || req.user?.email || 'Admin Staff';
    const isExpired = parsedExpiry <= now;

    const jobDetails = normaliseDetails(details);
    const job = await prisma.externalJob.create({
      data: {
        title: title.trim(),
        companyName: companyName.trim(),
        description: description.trim(),
        requirements: requirements ? requirements.trim() : null,
        details: jobDetails,
        destinationEmail: cleanDestinationEmail,
        source: source ? source.trim() : null,
        verifiedBy: verifierName,
        verifiedAt: now,
        expiryDate: parsedExpiry,
        reverifyAt,
        status: isExpired ? 'EXPIRED' : 'ACTIVE',
        category: category?.trim() || 'General Service',
        location: location ? location.trim() : (isRemote ? 'Remote' : 'Cameroon'),
        isRemote: Boolean(isRemote),
        country: country?.trim() || 'Cameroon',
        salary: salary ? salary.trim() : null,
        currency: currency?.trim() || 'XAF'
        , applicationQuestions: normalizeQuestions(applicationQuestions || [])
      }
    });

    res.status(201).json({
      success: true,
      message: 'External job listing created successfully.',
      data: job
    });
  } catch (error) {
    next(error);
  }
};

// GET /api/admin/external-jobs
const getAdminExternalJobs = async (req, res, next) => {
  try {
    const {
      page = 1,
      limit = 20,
      status,
      search,
      needsRecheckOnly,
      sortBy = 'newest'
    } = req.query;

    const pageNum = Math.max(1, parseInt(page, 10));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10)));
    const skip = (pageNum - 1) * limitNum;
    const now = new Date();

    const where = {};

    if (needsRecheckOnly === 'true') {
      where.OR = [
        { status: 'NEEDS_RECHECK' },
        {
          status: 'ACTIVE',
          reverifyAt: { lte: now }
        }
      ];
    } else if (status && status !== 'ALL') {
      where.status = status;
    }

    if (search) {
      const term = search.trim();
      where.AND = [
        ...(where.AND || []),
        {
          OR: [
            { title: { contains: term, mode: 'insensitive' } },
            { companyName: { contains: term, mode: 'insensitive' } },
            { category: { contains: term, mode: 'insensitive' } },
            { location: { contains: term, mode: 'insensitive' } },
            { destinationEmail: { contains: term, mode: 'insensitive' } }
          ]
        }
      ];
    }

    let orderBy = { createdAt: 'desc' };
    if (sortBy === 'expiry_soon') orderBy = { expiryDate: 'asc' };
    if (sortBy === 'verified_recent') orderBy = { verifiedAt: 'desc' };
    if (sortBy === 'oldest') orderBy = { createdAt: 'asc' };

    const [jobs, total, activeCount, needsRecheckCount, expiredCount, totalApplicationsCount] = await Promise.all([
      prisma.externalJob.findMany({
        where,
        include: {
          _count: {
            select: { applications: true }
          }
        },
        orderBy,
        skip,
        take: limitNum
      }),
      prisma.externalJob.count({ where }),
      prisma.externalJob.count({
        where: {
          status: 'ACTIVE',
          expiryDate: { gt: now }
        }
      }),
      prisma.externalJob.count({
        where: {
          OR: [
            { status: 'NEEDS_RECHECK' },
            { status: 'ACTIVE', reverifyAt: { lte: now } }
          ]
        }
      }),
      prisma.externalJob.count({
        where: {
          OR: [
            { status: 'EXPIRED' },
            { expiryDate: { lte: now } }
          ]
        }
      }),
      prisma.externalJobApplication.count()
    ]);

    // Annotate jobs with dynamic status (e.g. if reverifyAt passed or expiry passed)
    const formatted = jobs.map(job => {
      const isPastExpiry = job.expiryDate <= now;
      const needsRecheck = (job.status === 'NEEDS_RECHECK') || (job.status === 'ACTIVE' && job.reverifyAt && job.reverifyAt <= now);
      let dynamicStatus = job.status;
      if (isPastExpiry) dynamicStatus = 'EXPIRED';
      else if (needsRecheck) dynamicStatus = 'NEEDS_RECHECK';

      return {
        ...job,
        dynamicStatus,
        isPastExpiry,
        needsRecheck,
        applicationsCount: job._count.applications
      };
    });

    res.status(200).json({
      success: true,
      data: formatted,
      stats: {
        totalAll: await prisma.externalJob.count(),
        activeCount,
        needsRecheckCount,
        expiredCount,
        totalApplicationsCount
      },
      pagination: {
        total,
        page: pageNum,
        limit: limitNum,
        pages: Math.ceil(total / limitNum)
      }
    });
  } catch (error) {
    next(error);
  }
};

// GET /api/admin/external-jobs/:id
const getAdminExternalJobById = async (req, res, next) => {
  try {
    const { id } = req.params;
    const job = await prisma.externalJob.findUnique({
      where: { id },
      include: {
        applications: {
          include: {
            user: {
              select: {
                id: true,
                fullName: true,
                email: true,
                phone: true,
                avatar: true
              }
            }
          },
          orderBy: { sentAt: 'desc' }
        }
      }
    });

    if (!job) {
      return res.status(404).json({ success: false, message: 'External job listing not found' });
    }

    const now = new Date();
    const needsRecheck = (job.status === 'NEEDS_RECHECK') || (job.status === 'ACTIVE' && job.reverifyAt && job.reverifyAt <= now);

    res.status(200).json({
      success: true,
      data: {
        ...job,
        needsRecheck,
        isPastExpiry: job.expiryDate <= now
      }
    });
  } catch (error) {
    next(error);
  }
};

// PUT /api/admin/external-jobs/:id
const updateExternalJob = async (req, res, next) => {
  try {
    const { id } = req.params;
    const {
      title,
      companyName,
      description,
      requirements,
      details,
      destinationEmail,
      source,
      expiryDate,
      status,
      category,
      location,
      isRemote,
      country,
      salary,
      currency
      , applicationQuestions
    } = req.body;

    const existing = await prisma.externalJob.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Listing not found' });
    }

    const updateData = {};
    if (title) updateData.title = title.trim();
    if (companyName) updateData.companyName = companyName.trim();
    if (description) updateData.description = description.trim();
    if (requirements !== undefined) updateData.requirements = requirements ? requirements.trim() : null;
    if (details !== undefined) updateData.details = normaliseDetails(details);
    if (destinationEmail) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(destinationEmail.trim())) {
        return res.status(400).json({ success: false, message: 'Invalid destination application email.' });
      }
      updateData.destinationEmail = destinationEmail.trim().toLowerCase();
    }
    if (source !== undefined) updateData.source = source ? source.trim() : null;
    if (expiryDate) {
      let parsed;
      if (typeof expiryDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(expiryDate.trim())) {
        parsed = new Date(`${expiryDate.trim()}T23:59:59.999Z`);
      } else {
        parsed = new Date(expiryDate);
      }

      if (isNaN(parsed.getTime())) {
        return res.status(400).json({ success: false, message: 'Invalid expiry date.' });
      }
      updateData.expiryDate = parsed;
      if (parsed > new Date()) {
        updateData.status = 'ACTIVE';
      }
    }
    if (status) updateData.status = status;
    if (category) updateData.category = category.trim();
    if (location !== undefined) updateData.location = location ? location.trim() : null;
    if (isRemote !== undefined) updateData.isRemote = Boolean(isRemote);
    if (country) updateData.country = country.trim();
    if (salary !== undefined) updateData.salary = salary ? salary.trim() : null;
    if (currency) updateData.currency = currency.trim();
    if (applicationQuestions !== undefined) updateData.applicationQuestions = normalizeQuestions(applicationQuestions);

    const updated = await prisma.externalJob.update({
      where: { id },
      data: updateData
    });

    res.status(200).json({
      success: true,
      message: 'External job listing updated successfully',
      data: updated
    });
  } catch (error) {
    next(error);
  }
};

// DELETE /api/admin/external-jobs/:id
const deleteExternalJob = async (req, res, next) => {
  try {
    const { id } = req.params;
    await prisma.externalJob.delete({ where: { id } });
    res.status(200).json({ success: true, message: 'External job listing deleted.' });
  } catch (error) {
    next(error);
  }
};

// POST /api/admin/external-jobs/:id/reverify
const reverifyExternalJob = async (req, res, next) => {
  try {
    const { id } = req.params;
    const recheckDays = await getRecheckThresholdDays();
    const now = new Date();
    const reverifyAt = new Date(now.getTime() + recheckDays * 24 * 60 * 60 * 1000);
    const verifierName = req.user?.fullName || req.user?.phone || req.user?.email || 'Admin Staff';

    const job = await prisma.externalJob.findUnique({ where: { id } });
    if (!job) {
      return res.status(404).json({ success: false, message: 'Listing not found.' });
    }

    const updated = await prisma.externalJob.update({
      where: { id },
      data: {
        verifiedBy: verifierName,
        verifiedAt: now,
        reverifyAt,
        status: job.expiryDate <= now ? 'EXPIRED' : 'ACTIVE'
      }
    });

    res.status(200).json({
      success: true,
      message: `Listing verified! Next re-check scheduled in ${recheckDays} days.`,
      data: updated
    });
  } catch (error) {
    next(error);
  }
};

// GET /api/admin/external-jobs/applications
const getApplicationsLog = async (req, res, next) => {
  try {
    const { page = 1, limit = 20, externalJobId, status, search } = req.query;
    const pageNum = Math.max(1, parseInt(page, 10));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10)));
    const skip = (pageNum - 1) * limitNum;

    const where = {};
    if (externalJobId) where.externalJobId = externalJobId;
    if (status) where.status = status;
    if (search) {
      const term = search.trim();
      where.OR = [
        { applicantName: { contains: term, mode: 'insensitive' } },
        { applicantEmail: { contains: term, mode: 'insensitive' } },
        { destinationEmail: { contains: term, mode: 'insensitive' } },
        { job: { title: { contains: term, mode: 'insensitive' } } },
        { job: { companyName: { contains: term, mode: 'insensitive' } } }
      ];
    }

    const [items, total] = await Promise.all([
      prisma.externalJobApplication.findMany({
        where,
        include: {
          job: {
            select: {
              id: true,
              title: true,
              companyName: true,
              destinationEmail: true,
              category: true,
              applicationQuestions: true
            }
          },
          user: {
            select: {
              id: true,
              fullName: true,
              avatar: true,
              phone: true
            }
          }
        },
        orderBy: { sentAt: 'desc' },
        skip,
        take: limitNum
      }),
      prisma.externalJobApplication.count({ where })
    ]);

    res.status(200).json({
      success: true,
      data: items,
      pagination: {
        total,
        page: pageNum,
        limit: limitNum,
        pages: Math.ceil(total / limitNum)
      }
    });
  } catch (error) {
    next(error);
  }
};

// GET /api/admin/external-jobs/settings
const getExternalJobSettings = async (req, res, next) => {
  try {
    const days = await getRecheckThresholdDays();
    res.status(200).json({
      success: true,
      data: {
        externalJobRecheckDays: days
      }
    });
  } catch (error) {
    next(error);
  }
};

// PUT /api/admin/external-jobs/settings
const updateExternalJobSettings = async (req, res, next) => {
  try {
    const { externalJobRecheckDays } = req.body;
    const days = parseInt(externalJobRecheckDays, 10);
    if (isNaN(days) || days < 1 || days > 365) {
      return res.status(400).json({
        success: false,
        message: 'Re-verification reminder threshold must be between 1 and 365 days.'
      });
    }

    const settings = await prisma.settings.upsert({
      where: { id: 'global' },
      update: { externalJobRecheckDays: days },
      create: { id: 'global', externalJobRecheckDays: days }
    });

    res.status(200).json({
      success: true,
      message: `Re-verification reminder threshold updated to ${days} days.`,
      data: { externalJobRecheckDays: settings.externalJobRecheckDays }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * ==========================================
 * USER-FACING CONTROLLERS
 * ==========================================
 */

// GET /api/external-jobs
const getActiveExternalJobs = async (req, res, next) => {
  try {
    const {
      page = 1,
      limit = 20,
      search,
      category,
      location,
      isRemote
    } = req.query;

    const pageNum = Math.max(1, parseInt(page, 10));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10)));
    const skip = (pageNum - 1) * limitNum;
    const now = new Date();

    const where = {
      status: { in: ['ACTIVE', 'NEEDS_RECHECK'] },
      expiryDate: { gt: now }
    };

    const viewerCountry = req.user?.country;
    if (viewerCountry && isRemote !== 'true') {
      where.AND = [
        ...(where.AND || []),
        { OR: [{ isRemote: true }, { country: viewerCountry }, { country: null }, { country: '' }] }
      ];
    }

    if (category && category !== 'All' && category !== 'all') {
      where.category = { contains: category, mode: 'insensitive' };
    }

    if (isRemote === 'true') {
      where.isRemote = true;
    } else if (isRemote === 'false') {
      where.isRemote = false;
    }

    if (location) {
      where.location = { contains: location, mode: 'insensitive' };
    }

    if (search) {
      const term = search.trim();
      where.AND = [
        ...(where.AND || []),
        {
          OR: [
            { title: { contains: term, mode: 'insensitive' } },
            { companyName: { contains: term, mode: 'insensitive' } },
            { description: { contains: term, mode: 'insensitive' } },
            { category: { contains: term, mode: 'insensitive' } },
            { location: { contains: term, mode: 'insensitive' } }
          ]
        }
      ];
    }

    const [jobs, total] = await Promise.all([
      prisma.externalJob.findMany({
        where,
        select: {
          id: true,
          title: true,
          companyName: true,
          description: true,
          requirements: true,
          details: true,
          source: true,
          category: true,
          location: true,
          isRemote: true,
          country: true,
          salary: true,
          currency: true,
          expiryDate: true,
          verifiedAt: true,
          createdAt: true,
          applicationQuestions: true
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limitNum
      }),
      prisma.externalJob.count({ where })
    ]);

    let userAppliedIds = new Set();
    if (req.user?.id && jobs.length > 0) {
      const jobIds = jobs.map(j => j.id);
      const applied = await prisma.externalJobApplication.findMany({
        where: { externalJobId: { in: jobIds }, userId: req.user.id },
        select: { externalJobId: true }
      });
      userAppliedIds = new Set(applied.map(a => a.externalJobId));
    }

    // Map each item with isExternal marker and formatting
    const formatted = jobs.map(j => ({
      ...j,
      isExternal: true,
      hasApplied: userAppliedIds.has(j.id),
      budget: j.salary,
      type: 'EXTERNAL_OPPORTUNITY'
    }));

    res.status(200).json({
      success: true,
      data: formatted,
      pagination: {
        total,
        page: pageNum,
        limit: limitNum,
        pages: Math.ceil(total / limitNum)
      }
    });
  } catch (error) {
    next(error);
  }
};

// GET /api/external-jobs/:id
const getExternalJobById = async (req, res, next) => {
  try {
    const { id } = req.params;
    const now = new Date();

    const job = await prisma.externalJob.findUnique({
      where: { id },
      select: {
        id: true,
        title: true,
        companyName: true,
        description: true,
        requirements: true,
        details: true,
        source: true,
        category: true,
        location: true,
        isRemote: true,
        country: true,
        salary: true,
        currency: true,
        expiryDate: true,
        verifiedAt: true,
        createdAt: true,
        status: true,
        applicationQuestions: true
      }
    });

    if (!job || job.status === 'EXPIRED' || job.status === 'ARCHIVED' || job.expiryDate <= now) {
      return res.status(404).json({
        success: false,
        message: 'This job opportunity is expired or no longer available.'
      });
    }

    if (!job.isRemote && req.user?.country && job.country && job.country !== req.user.country) {
      return res.status(403).json({ success: false, message: 'This local opportunity is not available in your country.' });
    }

    let hasApplied = false;
    if (req.user?.id) {
      const existingApplication = await prisma.externalJobApplication.findFirst({
        where: { externalJobId: id, userId: req.user.id },
        select: { id: true }
      });
      hasApplied = Boolean(existingApplication);
    }

    res.status(200).json({
      success: true,
      data: {
        ...job,
        isExternal: true,
        hasApplied
      }
    });
  } catch (error) {
    next(error);
  }
};

// POST /api/external-jobs/:id/apply (ONE-TAP APPLY)
const applyForExternalJob = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const { coverLetter } = req.body;

    // 1. Fetch external job
    const job = await prisma.externalJob.findUnique({ where: { id } });
    if (!job) {
      return res.status(404).json({ success: false, message: 'Job listing not found.' });
    }

    const now = new Date();
    if (job.status === 'EXPIRED' || job.expiryDate <= now) {
      return res.status(400).json({
        success: false,
        message: 'This job listing has expired and is no longer accepting applications.'
      });
    }

    if (!job.destinationEmail) {
      return res.status(400).json({
        success: false,
        message: 'Destination recruiter email is missing for this listing.'
      });
    }

    const existingApplication = await prisma.externalJobApplication.findFirst({
      where: { externalJobId: id, userId }
    });
    if (existingApplication) {
      return res.status(400).json({
        success: false,
        message: 'You have already submitted an application for this position.',
        code: 'ALREADY_APPLIED'
      });
    }

    // 2. Fetch user profile + details
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        providerProfile: true
      }
    });

    if (!user) {
      return res.status(404).json({ success: false, message: 'User profile not found.' });
    }

    const applicantName = (req.body.applicantName && req.body.applicantName.trim()) || user.fullName || 'Candidate';
    const applicantEmail = (req.body.applicantEmail && req.body.applicantEmail.trim().toLowerCase()) || user.email;
    const applicantPhone = (req.body.applicantPhone && req.body.applicantPhone.trim()) || user.phone || '';
    const screeningAnswers = validateAnswers(job.applicationQuestions || [], req.body.screeningAnswers);

    if (!applicantEmail) {
      return res.status(400).json({
        success: false,
        message: 'Please provide your email address so recruiters can reply directly to your application.'
      });
    }

    // If user account had no email yet, save it
    if (!user.email && applicantEmail) {
      await prisma.user.update({
        where: { id: userId },
        data: { email: applicantEmail }
      }).catch(() => {});
    }

    // 3. Handle a CV only when the candidate explicitly chooses one for this application.
    // A profile CV must never be silently attached to an employer application.
    let cvBuffer = null;
    let cvFileName = req.body.cvName || null;
    let cvUrl = req.body.cvLink || req.body.cvUrl || null;
    let isWebLink = false;

    if (req.file) {
      // User uploaded a new CV file (PDF or photo)
      cvFileName = req.file.originalname;
      cvBuffer = req.file.buffer;

      try {
        cvUrl = await uploadFile(req.file, 'cv-resumes');
      } catch (uploadErr) {
        console.warn('[ApplyExternalJob] Cloud upload failed, using in-memory buffer:', uploadErr.message);
      }
    } else if (req.body.cvLink || req.body.cvUrl) {
      // User supplied a Google Sheets link, Google Drive link, or online document
      cvUrl = (req.body.cvLink || req.body.cvUrl).trim();
      cvFileName = req.body.cvName || (cvUrl.includes('docs.google.com/spreadsheets') ? 'Google Sheets Document' : 'Online Document / Link');
      isWebLink = true;
    } else if (cvUrl) {
      const lower = cvUrl.toLowerCase();
      if (lower.includes('docs.google.com') || lower.includes('drive.google.com') || lower.includes('sheet') || (!lower.match(/\.(pdf|png|jpg|jpeg|webp)$/) && !cvUrl.includes('/uploads/'))) {
        isWebLink = true;
      }

      // If it's a direct downloadable binary file (e.g. S3/Cloud storage PDF or photo)
      if (!isWebLink && (cvUrl.startsWith('http://') || cvUrl.startsWith('https://'))) {
        try {
          const resp = await axios.get(cvUrl, { responseType: 'arraybuffer', timeout: 15000 });
          cvBuffer = Buffer.from(resp.data);
        } catch (downloadErr) {
          console.warn('[ApplyExternalJob] Could not fetch remote CV file buffer:', downloadErr.message);
        }
      }
    }

    const isPriorityBoost = Boolean(req.body.isPriority === true || req.body.isPriority === 'true');
    let userWallet = null;

    if (isPriorityBoost) {
      userWallet = await prisma.wallet.findUnique({ where: { userId } });
      if (!userWallet || userWallet.balance < 2) {
        return res.status(400).json({
          success: false,
          message: `Insufficient Fixam Coins. Priority application boost requires 2 coins, but your current balance is ${userWallet ? userWallet.balance : 0} coins.`,
          code: 'INSUFFICIENT_COINS',
          requiredCoins: 2,
          currentBalance: userWallet ? userWallet.balance : 0
        });
      }

      await prisma.wallet.update({
        where: { id: userWallet.id },
        data: { balance: { decrement: 2 } }
      });

      await prisma.transaction.create({
        data: {
          walletId: userWallet.id,
          amount: -2,
          type: 'DEDUCTION',
          status: 'SUCCESS',
          description: `Priority Application Boost: ${job.title} at ${job.companyName}`
        }
      });
    }

    const attachments = [];
    if (cvBuffer) {
      attachments.push({
        filename: cvFileName,
        content: cvBuffer
      });
    }

    // 4. Create application log first to get ID for tracked CV link
    const viewToken = require('crypto').randomBytes(16).toString('hex');
    const applicationLog = await prisma.externalJobApplication.create({
      data: {
        externalJobId: job.id,
        userId: user.id,
        applicantName,
        applicantEmail,
        applicantPhone,
        destinationEmail: job.destinationEmail,
        coverLetter: coverLetter ? coverLetter.trim() : null,
        cvUrl: cvUrl || null,
        cvName: cvFileName || null,
        status: 'PENDING',
        isPriority: isPriorityBoost,
        coinsSpent: isPriorityBoost ? 2 : 0,
        viewToken,
        sentAt: new Date()
        , screeningAnswers
      }
    });

    const apiBase = process.env.API_URL || (process.env.NODE_ENV === 'production' ? 'https://api.usefixam.com' : 'http://localhost:5000');
    const trackedCvLink = cvUrl
      ? `${apiBase}/api/external-jobs/track/cv-view?appId=${applicationLog.id}`
      : null;

    // 5. Send email via Resend (sent from applications@mail.usefixam.com, reply-to applicant)
    const emailResult = await sendExternalJobApplication({
      to: job.destinationEmail,
      applicantName,
      applicantEmail,
      applicantPhone,
      jobTitle: job.title,
      companyName: job.companyName,
      coverLetter,
      cvLink: trackedCvLink || cvUrl,
      isPriority: isPriorityBoost,
      attachments
      , screeningResponses: pairQuestionsAndAnswers(job.applicationQuestions || [], screeningAnswers)
    });

    await prisma.externalJobApplication.update({
      where: { id: applicationLog.id },
      data: {
        status: emailResult.success ? 'SENT' : 'FAILED',
        resendEmailId: emailResult.data?.id || null,
        errorMessage: emailResult.error || null
      }
    });

    if (!emailResult.success) {
      if (isPriorityBoost && userWallet) {
        await prisma.wallet.update({
          where: { id: userWallet.id },
          data: { balance: { increment: 2 } }
        }).catch(() => {});
        await prisma.transaction.create({
          data: {
            walletId: userWallet.id,
            amount: 2,
            type: 'REFUND',
            status: 'SUCCESS',
            description: `Refund priority boost: delivery failed for ${job.title}`
          }
        }).catch(() => {});
      }

      return res.status(400).json({
        success: false,
        message: `Failed to deliver application to ${job.companyName}: ${emailResult.error || 'Email service error'}. Please try again.`,
        applicationId: applicationLog.id
      });
    }

    res.status(200).json({
      success: true,
      message: `Your application has been successfully delivered to ${job.companyName}! Recruiters will reply directly to ${applicantEmail}.`,
      data: {
        applicationId: applicationLog.id,
        companyName: job.companyName,
        jobTitle: job.title,
        destinationEmail: job.destinationEmail,
        isPriority: isPriorityBoost,
        sentAt: applicationLog.sentAt
      }
    });
  } catch (error) {
    next(error);
  }
};

// GET /api/external-jobs/track/cv-view?appId=...
const trackCvView = async (req, res, next) => {
  try {
    const { appId } = req.query;
    if (!appId) {
      return res.redirect('https://usefixam.com');
    }

    const application = await prisma.externalJobApplication.findUnique({
      where: { id: String(appId) },
      include: {
        job: true,
        user: true
      }
    });

    if (!application) {
      return res.redirect('https://usefixam.com');
    }

    const isFirstView = !application.cvViewedAt;
    const now = new Date();

    await prisma.externalJobApplication.update({
      where: { id: application.id },
      data: {
        cvViewedAt: application.cvViewedAt || now,
        cvViewCount: { increment: 1 },
        status: 'VIEWED'
      }
    }).catch(err => console.warn('[TrackCV] DB update error:', err.message));

    if (isFirstView) {
      const jobTitle = application.job?.title || 'Job listing';
      const companyName = application.job?.companyName || 'The hiring employer';
      const candidateUserId = application.userId;
      const candidateEmail = application.applicantEmail;
      const candidateName = application.applicantName || 'Candidate';

      const notifTitle = `CV Consulté ! / CV Viewed!`;
      const notifBody = `Bonne nouvelle ! Votre CV pour "${jobTitle}" chez ${companyName} vient d'être ouvert et consulté par le recruteur.`;

      // 1. In-app notification in database
      await prisma.notification.create({
        data: {
          userId: candidateUserId,
          title: 'Votre CV a été ouvert par le recruteur !',
          body: `L'équipe de recrutement de ${companyName} vient d'ouvrir et de consulter votre CV pour le poste "${jobTitle}".`,
          data: {
            type: 'CV_VIEWED',
            applicationId: application.id,
            jobTitle,
            companyName
          }
        }
      }).catch(err => console.warn('[TrackCV] In-app notif failed:', err.message));

      // 2. Push Notification via Firebase
      try {
        const { sendPushNotification } = require('../services/notification.service');
        await sendPushNotification(candidateUserId, notifTitle, notifBody, {
          type: 'CV_VIEWED',
          applicationId: application.id,
          jobTitle,
          companyName
        });
      } catch (pushErr) {
        console.warn('[TrackCV] Push notification failed:', pushErr.message);
      }

      // 3. Email Notification to candidate
      if (candidateEmail) {
        const { sendEmail } = require('../services/email.service');
        const emailHtml = `
          <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 600px; color: #111827; line-height: 1.6; font-size: 15px;">
            <div style="background-color: #eff6ff; border: 1.5px solid #3b82f6; border-radius: 8px; padding: 14px 18px; margin-bottom: 24px;">
              <p style="margin: 0; color: #1d4ed8; font-weight: 750; font-size: 13px; text-transform: uppercase; letter-spacing: 0.5px;">
                CV Ouvert par le Recruteur / CV Viewed by Employer
              </p>
              <p style="margin: 4px 0 0 0; color: #1e40af; font-size: 13px;">
                L'employeur examine actuellement votre dossier de candidature.
              </p>
            </div>

            <h2 style="color: #0f172a; font-size: 20px; font-weight: 700; margin: 0 0 12px 0;">
              Bonne nouvelle, ${candidateName} !
            </h2>

            <p style="margin: 0 0 16px 0;">
              Votre CV pour le poste de <strong>${jobTitle}</strong> chez <strong>${companyName}</strong> vient d'être ouvert et examiné par l'équipe de recrutement.
            </p>

            <div style="margin: 20px 0; padding: 16px 20px; background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px;">
              <p style="margin: 4px 0;"><strong>Entreprise :</strong> ${companyName}</p>
              <p style="margin: 4px 0;"><strong>Poste :</strong> ${jobTitle}</p>
              <p style="margin: 4px 0;"><strong>Date d'examen :</strong> ${now.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}</p>
            </div>

            <p style="margin: 20px 0 0 0;">
              Restez attentif à votre boîte mail et votre téléphone : le recruteur vous contactera directement en cas d'intérêt pour un entretien.
            </p>

            <p style="margin: 28px 0 0 0; padding-top: 16px; border-top: 1px solid #e5e7eb; font-size: 12px; color: #9ca3af;">
              Fixam Careers &bull; <a href="https://usefixam.com" style="color: #2563eb;">usefixam.com</a>
            </p>
          </div>
        `;

        await sendEmail({
          from: process.env.EMAIL_JOBS_FROM || 'Fixam Jobs <jobs@mail.usefixam.com>',
          to: candidateEmail,
          subject: `Votre CV pour "${jobTitle}" a été ouvert par ${companyName} !`,
          html: emailHtml
        }).catch(err => console.warn('[TrackCV] Candidate email notif failed:', err.message));
      }
    }

    if (application.cvUrl) {
      return res.redirect(application.cvUrl);
    }

    return res.redirect('https://usefixam.com');
  } catch (error) {
    console.error('[TrackCV] Error:', error.message);
    return res.redirect('https://usefixam.com');
  }
};

// POST /api/users/cv (Upload user permanent CV or save Google Sheets / Drive link)
const uploadUserCV = async (req, res, next) => {
  try {
    const { cvLink, cvName } = req.body;
    let finalUrl = null;
    let finalName = cvName || 'CV Document';

    if (req.file) {
      finalUrl = await uploadFile(req.file, 'cv-resumes');
      finalName = req.file.originalname;
    } else if (cvLink && cvLink.trim()) {
      finalUrl = cvLink.trim();
      finalName = cvName || (cvLink.includes('docs.google.com/spreadsheets') ? 'Google Sheets Document' : 'Online Document / Link');
    } else {
      return res.status(400).json({
        success: false,
        message: 'Please provide a CV document/photo or a Google Sheets / Drive link.'
      });
    }

    const updatedUser = await prisma.user.update({
      where: { id: req.user.id },
      data: {
        cvUrl: finalUrl,
        cvName: finalName
      },
      select: {
        id: true,
        cvUrl: true,
        cvName: true
      }
    });

    res.status(200).json({
      success: true,
      message: 'CV updated successfully',
      data: updatedUser
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  createExternalJob,
  getAdminExternalJobs,
  getAdminExternalJobById,
  updateExternalJob,
  deleteExternalJob,
  reverifyExternalJob,
  getApplicationsLog,
  getExternalJobSettings,
  updateExternalJobSettings,
  getActiveExternalJobs,
  getExternalJobById,
  applyForExternalJob,
  trackCvView,
  uploadUserCV
};
