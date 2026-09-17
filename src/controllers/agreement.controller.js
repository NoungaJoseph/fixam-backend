const prisma = require('../config/prisma');
const agreementService = require('../services/agreement.service');
const path = require('path');
const fs = require('fs');

/**
 * GET /api/agreements/:id
 * Fetches single agreement by ID with authorization checks.
 */
const getAgreementById = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const userRole = req.user.role;

    const agreement = await prisma.serviceAgreement.findUnique({
      where: { id },
      include: {
        client: { select: { id: true, fullName: true, avatar: true, phone: true, email: true } },
        provider: { select: { id: true, fullName: true, avatar: true, phone: true, email: true } },
        booking: true,
        task: true
      }
    });

    if (!agreement) {
      return res.status(404).json({ success: false, message: 'Agreement not found.' });
    }

    if (userRole !== 'ADMIN' && userId !== agreement.clientId && userId !== agreement.providerId) {
      return res.status(403).json({ success: false, message: 'Not authorized to view this agreement.' });
    }

    res.status(200).json({ success: true, data: agreement });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/agreements/:id/accept
 * Records user's digital acceptance ("Agreement accepted through Fixam").
 */
const acceptAgreement = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const userRole = req.user.role;
    const ipAddress = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    const userAgent = req.headers['user-agent'];

    const updated = await agreementService.recordAcceptance({
      agreementId: id,
      userId,
      userRole,
      ipAddress,
      userAgent
    });

    res.status(200).json({
      success: true,
      data: updated,
      message: 'Agreement accepted successfully through Fixam.'
    });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/agreements/:id/pdf
 * Serves / downloads the generated immutable PDF file.
 */
const downloadAgreementPdf = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const userRole = req.user.role;

    const agreement = await prisma.serviceAgreement.findUnique({ where: { id } });

    if (!agreement) {
      return res.status(404).json({ success: false, message: 'Agreement not found.' });
    }

    if (userRole !== 'ADMIN' && userId !== agreement.clientId && userId !== agreement.providerId) {
      return res.status(403).json({ success: false, message: 'Not authorized to download this PDF.' });
    }

    const lang = req.query.lang === 'fr' ? 'fr' : (req.user?.preferredLanguage === 'fr' ? 'fr' : 'en');
    const fileName = `${agreement.publicAgreementNumber}-${lang}.pdf`;
    const filePath = path.join(process.cwd(), 'uploads', 'agreements', fileName);

    if (!fs.existsSync(filePath)) {
      // Regenerate if file missing
      const { generateAgreementPdf } = require('../services/agreementPdf.service');
      await generateAgreementPdf(agreement, lang);
    }

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${fileName}"`);
    res.sendFile(filePath);
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/agreements/history
 * Query agreement version history for a booking or task.
 */
const getAgreementHistory = async (req, res, next) => {
  try {
    const { bookingId, taskId } = req.query;
    const userId = req.user.id;
    const userRole = req.user.role;

    if (!bookingId && !taskId) {
      return res.status(400).json({ success: false, message: 'bookingId or taskId is required.' });
    }

    const agreements = await prisma.serviceAgreement.findMany({
      where: {
        OR: [
          bookingId ? { bookingId } : null,
          taskId ? { taskId } : null
        ].filter(Boolean)
      },
      orderBy: { version: 'desc' }
    });

    if (agreements.length > 0 && userRole !== 'ADMIN') {
      const first = agreements[0];
      if (userId !== first.clientId && userId !== first.providerId) {
        return res.status(403).json({ success: false, message: 'Not authorized.' });
      }
    }

    res.status(200).json({ success: true, data: agreements });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/admin/agreements
 * Admin search & pagination for agreements.
 */
const getAdminAgreements = async (req, res, next) => {
  try {
    const { search, status, page = 1, limit = 15 } = req.query;
    const skip = (Number(page) - 1) * Number(limit);

    const where = {};
    if (status && status !== 'ALL') where.status = status;
    if (search) {
      where.OR = [
        { publicAgreementNumber: { contains: search, mode: 'insensitive' } },
        { bookingId: { contains: search, mode: 'insensitive' } },
        { taskId: { contains: search, mode: 'insensitive' } }
      ];
    }

    const [agreements, total] = await Promise.all([
      prisma.serviceAgreement.findMany({
        where,
        skip,
        take: Number(limit),
        orderBy: { createdAt: 'desc' },
        include: {
          client: { select: { id: true, fullName: true, phone: true } },
          provider: { select: { id: true, fullName: true, phone: true } }
        }
      }),
      prisma.serviceAgreement.count({ where })
    ]);

    res.status(200).json({
      success: true,
      data: agreements,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        pages: Math.ceil(total / Number(limit))
      }
    });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  getAgreementById,
  acceptAgreement,
  downloadAgreementPdf,
  getAgreementHistory,
  getAdminAgreements
};
