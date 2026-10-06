const prisma = require('../config/prisma');
const { sendExternalJobApplication } = require('../services/email.service');
const { uploadFile } = require('../services/storage.service');
const axios = require('axios');

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
      destinationEmail,
      source,
      expiryDate,
      category,
      location,
      isRemote,
      country,
      salary,
      currency
    } = req.body;

    if (!title || !companyName || !description || !destinationEmail || !expiryDate) {
      return res.status(400).json({
        success: false,
        message: 'Title, company name, description, destination application email, and expiry date are required.'
      });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(destinationEmail.trim())) {
      return res.status(400).json({
        success: false,
        message: 'Please provide a valid destination application email address.'
      });
    }

    const parsedExpiry = new Date(expiryDate);
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

    const job = await prisma.externalJob.create({
      data: {
        title: title.trim(),
        companyName: companyName.trim(),
        description: description.trim(),
        requirements: requirements ? requirements.trim() : null,
        destinationEmail: destinationEmail.trim().toLowerCase(),
        source: source ? source.trim() : null,
        verifiedBy: verifierName,
        verifiedAt: now,
        expiryDate: parsedExpiry,
        reverifyAt,
        status: parsedExpiry <= now ? 'EXPIRED' : 'ACTIVE',
        category: category?.trim() || 'General Service',
        location: location ? location.trim() : (isRemote ? 'Remote' : 'Cameroon'),
        isRemote: Boolean(isRemote),
        country: country?.trim() || 'Cameroon',
        salary: salary ? salary.trim() : null,
        currency: currency?.trim() || 'XAF'
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
    if (destinationEmail) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(destinationEmail.trim())) {
        return res.status(400).json({ success: false, message: 'Invalid destination application email.' });
      }
      updateData.destinationEmail = destinationEmail.trim().toLowerCase();
    }
    if (source !== undefined) updateData.source = source ? source.trim() : null;
    if (expiryDate) {
      const parsed = new Date(expiryDate);
      if (isNaN(parsed.getTime())) {
        return res.status(400).json({ success: false, message: 'Invalid expiry date.' });
      }
      updateData.expiryDate = parsed;
      if (parsed > new Date() && existing.status === 'EXPIRED') {
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
              category: true
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
      status: 'ACTIVE',
      expiryDate: { gt: now }
    };

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
          source: true,
          category: true,
          location: true,
          isRemote: true,
          country: true,
          salary: true,
          currency: true,
          expiryDate: true,
          verifiedAt: true,
          createdAt: true
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limitNum
      }),
      prisma.externalJob.count({ where })
    ]);

    // Map each item with isExternal marker and formatting
    const formatted = jobs.map(j => ({
      ...j,
      isExternal: true,
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
        status: true
      }
    });

    if (!job || job.status !== 'ACTIVE' || job.expiryDate <= now) {
      return res.status(404).json({
        success: false,
        message: 'This job opportunity is expired or no longer available.'
      });
    }

    res.status(200).json({
      success: true,
      data: {
        ...job,
        isExternal: true
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

    const applicantName = user.fullName || 'Candidate';
    const applicantEmail = user.email || req.body.applicantEmail;
    const applicantPhone = user.phone || req.body.applicantPhone || '';

    if (!applicantEmail) {
      return res.status(400).json({
        success: false,
        message: 'Your account does not have an email address configured. Please add an email address in profile settings to apply.'
      });
    }

    // 3. Handle CV (uploaded photo/PDF file, Google Sheets/Drive link, or saved profile CV)
    let cvBuffer = null;
    let cvFileName = user.cvName || 'Resume';
    let cvUrl = req.body.cvLink || req.body.cvUrl || user.cvUrl;
    let isWebLink = false;

    if (req.file) {
      // User uploaded a new CV file (PDF or photo)
      cvFileName = req.file.originalname;
      cvBuffer = req.file.buffer;

      try {
        cvUrl = await uploadFile(req.file, 'cv-resumes');
        // Update user profile so they have this CV saved permanently
        await prisma.user.update({
          where: { id: userId },
          data: {
            cvUrl,
            cvName: cvFileName
          }
        });
      } catch (uploadErr) {
        console.warn('[ApplyExternalJob] Cloud upload failed, using in-memory buffer:', uploadErr.message);
      }
    } else if (req.body.cvLink || req.body.cvUrl) {
      // User supplied a Google Sheets link, Google Drive link, or online document
      cvUrl = (req.body.cvLink || req.body.cvUrl).trim();
      cvFileName = req.body.cvName || (cvUrl.includes('docs.google.com/spreadsheets') ? 'Google Sheets Document' : 'Online Document / Link');
      isWebLink = true;
      await prisma.user.update({
        where: { id: userId },
        data: {
          cvUrl,
          cvName: cvFileName
        }
      }).catch(() => {});
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

    const attachments = [];
    if (cvBuffer) {
      attachments.push({
        filename: cvFileName,
        content: cvBuffer
      });
    }

    // 4. Send email via Resend (sent from submit@fixam.net, reply-to applicant)
    const emailResult = await sendExternalJobApplication({
      to: job.destinationEmail,
      applicantName,
      applicantEmail,
      applicantPhone,
      jobTitle: job.title,
      companyName: job.companyName,
      coverLetter,
      cvLink: cvUrl,
      attachments
    });

    // 5. Log application in ExternalJobApplication table
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
        status: emailResult.success ? 'SENT' : 'FAILED',
        resendEmailId: emailResult.data?.id || null,
        errorMessage: emailResult.error || null,
        sentAt: new Date()
      }
    });

    if (!emailResult.success) {
      return res.status(502).json({
        success: false,
        message: `Failed to deliver application to ${job.companyName}: ${emailResult.error || 'Email service error'}. Please check your connection and try again.`,
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
        sentAt: applicationLog.sentAt
      }
    });
  } catch (error) {
    next(error);
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
  uploadUserCV
};
