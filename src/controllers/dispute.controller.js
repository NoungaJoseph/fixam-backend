const prisma = require('../config/prisma');
const { sendDisputeNotification } = require('../services/notification.service');

const VALID_CATEGORIES = [
  'WORK_INCOMPLETE',
  'POOR_QUALITY',
  'WRONG_SERVICE',
  'PROPERTY_DAMAGE',
  'MISSING_MATERIAL',
  'BREACH_OF_AGREEMENT',
  'PRICE_DISAGREEMENT',
  'NO_SHOW',
  'OTHER'
];

/**
 * Client creates a dispute for a booking
 */
const createDispute = async (req, res, next) => {
  try {
    const { bookingId, category, description, clientEvidence } = req.body;
    const clientId = req.user.id;

    if (!bookingId || !category || !description) {
      return res.status(400).json({
        success: false,
        message: 'bookingId, category, and description are required.'
      });
    }

    if (!VALID_CATEGORIES.includes(category)) {
      return res.status(400).json({
        success: false,
        message: `Invalid category. Must be one of: ${VALID_CATEGORIES.join(', ')}`
      });
    }

    // Verify booking existence & ownership
    const booking = await prisma.booking.findUnique({
      where: { id: bookingId }
    });

    if (!booking) {
      return res.status(404).json({ success: false, message: 'Booking not found.' });
    }

    if (booking.clientId !== clientId) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized. You can only open a dispute for your own booking.'
      });
    }

    // Check for duplicate active disputes
    const existingDispute = await prisma.dispute.findFirst({
      where: {
        bookingId,
        status: { notIn: ['RESOLVED', 'CLOSED'] }
      }
    });

    if (existingDispute) {
      return res.status(400).json({
        success: false,
        message: 'An active dispute already exists for this booking.'
      });
    }

    const formattedEvidence = Array.isArray(clientEvidence) ? clientEvidence : [];

    // Create Dispute transaction with initial event
    const dispute = await prisma.$transaction(async (tx) => {
      const newDispute = await tx.dispute.create({
        data: {
          bookingId,
          clientId,
          providerId: booking.providerId,
          category,
          description: description.trim(),
          status: 'AWAITING_PROVIDER_RESPONSE',
          clientEvidence: formattedEvidence
        }
      });

      await tx.disputeEvent.create({
        data: {
          disputeId: newDispute.id,
          actorId: clientId,
          actorType: 'CLIENT',
          eventType: 'DISPUTE_CREATED',
          description: `Dispute created under category '${category}'.`,
          metadata: { category, evidenceCount: formattedEvidence.length }
        }
      });

      return newDispute;
    });

    // Notify provider asynchronously
    sendDisputeNotification(
      booking.providerId,
      'Dispute Opened on Booking',
      `A problem was reported for booking #${bookingId.substring(0, 8)}. Please review and respond.`,
      dispute.id,
      bookingId
    ).catch(err => console.error('[Dispute Notif Error]:', err.message));

    return res.status(201).json({
      success: true,
      message: 'Dispute submitted successfully.',
      data: dispute
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get single dispute details with authorization check
 */
const getDisputeDetails = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const userRole = req.user.role;

    const dispute = await prisma.dispute.findUnique({
      where: { id },
      include: {
        booking: {
          include: {
            agreements: { orderBy: { version: 'desc' } }
          }
        },
        client: {
          select: { id: true, fullName: true, phone: true, avatar: true, email: true }
        },
        provider: {
          select: { id: true, fullName: true, phone: true, avatar: true, email: true }
        },
        assignedAdmin: {
          select: { id: true, fullName: true }
        },
        events: {
          orderBy: { createdAt: 'asc' }
        }
      }
    });

    if (!dispute) {
      return res.status(404).json({ success: false, message: 'Dispute not found.' });
    }

    // Strict Authorization check
    const isClient = dispute.clientId === userId;
    const isProvider = dispute.providerId === userId;
    const isAdmin = userRole === 'ADMIN';

    if (!isClient && !isProvider && !isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. You are not authorized to view this dispute.'
      });
    }

    return res.status(200).json({
      success: true,
      data: dispute
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Respond to a dispute (Client or Provider)
 */
const respondToDispute = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { response, evidence } = req.body;
    const userId = req.user.id;

    if (!response || !response.trim()) {
      return res.status(400).json({ success: false, message: 'Response text is required.' });
    }

    const dispute = await prisma.dispute.findUnique({ where: { id } });
    if (!dispute) {
      return res.status(404).json({ success: false, message: 'Dispute not found.' });
    }

    if (dispute.status === 'RESOLVED' || dispute.status === 'CLOSED') {
      return res.status(400).json({ success: false, message: 'Cannot respond to a resolved or closed dispute.' });
    }

    const isClient = dispute.clientId === userId;
    const isProvider = dispute.providerId === userId;

    if (!isClient && !isProvider) {
      return res.status(403).json({ success: false, message: 'Access denied.' });
    }

    const newEvidenceItems = Array.isArray(evidence) ? evidence : [];

    const updatedDispute = await prisma.$transaction(async (tx) => {
      let updateData = {};
      let eventType = '';
      let eventDesc = '';
      let targetNotifyUserId = '';

      if (isProvider) {
        const existingEvidence = Array.isArray(dispute.providerEvidence) ? dispute.providerEvidence : [];
        updateData = {
          providerResponse: response.trim(),
          providerEvidence: [...existingEvidence, ...newEvidenceItems],
          status: 'AWAITING_CLIENT_RESPONSE'
        };
        eventType = 'PROVIDER_RESPONDED';
        eventDesc = 'Provider submitted a response to the dispute.';
        targetNotifyUserId = dispute.clientId;
      } else {
        const existingEvidence = Array.isArray(dispute.clientEvidence) ? dispute.clientEvidence : [];
        updateData = {
          clientResponse: response.trim(),
          clientEvidence: [...existingEvidence, ...newEvidenceItems],
          status: 'UNDER_REVIEW'
        };
        eventType = 'CLIENT_RESPONDED';
        eventDesc = 'Client submitted a response to the dispute.';
        targetNotifyUserId = dispute.providerId;
      }

      const resDispute = await tx.dispute.update({
        where: { id },
        data: updateData
      });

      await tx.disputeEvent.create({
        data: {
          disputeId: id,
          actorId: userId,
          actorType: isProvider ? 'PROVIDER' : 'CLIENT',
          eventType,
          description: eventDesc,
          metadata: { evidenceAdded: newEvidenceItems.length }
        }
      });

      // Send notification
      sendDisputeNotification(
        targetNotifyUserId,
        'Update on Dispute',
        isProvider ? 'The provider responded to your complaint.' : 'The client provided additional response for the dispute.',
        id,
        dispute.bookingId
      ).catch(() => {});

      return resDispute;
    });

    return res.status(200).json({
      success: true,
      message: 'Response recorded successfully.',
      data: updatedDispute
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Add evidence to a dispute
 */
const addEvidence = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { evidence } = req.body;
    const userId = req.user.id;

    if (!evidence || (!Array.isArray(evidence) && typeof evidence !== 'object')) {
      return res.status(400).json({ success: false, message: 'Valid evidence data is required.' });
    }

    const dispute = await prisma.dispute.findUnique({ where: { id } });
    if (!dispute) {
      return res.status(404).json({ success: false, message: 'Dispute not found.' });
    }

    const isClient = dispute.clientId === userId;
    const isProvider = dispute.providerId === userId;
    const isAdmin = req.user.role === 'ADMIN';

    if (!isClient && !isProvider && !isAdmin) {
      return res.status(403).json({ success: false, message: 'Access denied.' });
    }

    const itemsToAdd = Array.isArray(evidence) ? evidence : [evidence];

    const updatedDispute = await prisma.$transaction(async (tx) => {
      let updateField = isProvider ? 'providerEvidence' : 'clientEvidence';
      const currentEvidence = Array.isArray(dispute[updateField]) ? dispute[updateField] : [];
      const newEvidence = [...currentEvidence, ...itemsToAdd];

      const resDispute = await tx.dispute.update({
        where: { id },
        data: { [updateField]: newEvidence }
      });

      const actorType = isAdmin ? 'ADMIN' : (isProvider ? 'PROVIDER' : 'CLIENT');
      const eventType = isProvider ? 'PROVIDER_EVIDENCE_ADDED' : 'CLIENT_EVIDENCE_ADDED';

      await tx.disputeEvent.create({
        data: {
          disputeId: id,
          actorId: userId,
          actorType,
          eventType,
          description: `Added ${itemsToAdd.length} new evidence file(s).`,
          metadata: { addedCount: itemsToAdd.length }
        }
      });

      return resDispute;
    });

    return res.status(200).json({
      success: true,
      message: 'Evidence uploaded successfully.',
      data: updatedDispute
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Request correction
 */
const requestCorrection = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { details } = req.body;
    const userId = req.user.id;

    if (!details || !details.trim()) {
      return res.status(400).json({ success: false, message: 'Correction details are required.' });
    }

    const dispute = await prisma.dispute.findUnique({ where: { id } });
    if (!dispute) return res.status(404).json({ success: false, message: 'Dispute not found.' });

    const isClient = dispute.clientId === userId;
    const isProvider = dispute.providerId === userId;

    if (!isClient && !isProvider) {
      return res.status(403).json({ success: false, message: 'Access denied.' });
    }

    const updated = await prisma.$transaction(async (tx) => {
      const updatedDispute = await tx.dispute.update({
        where: { id },
        data: {
          status: 'CORRECTION_REQUESTED',
          correctionDetails: details.trim()
        }
      });

      const actorType = isClient ? 'CLIENT' : 'PROVIDER';
      await tx.disputeEvent.create({
        data: {
          disputeId: id,
          actorId: userId,
          actorType,
          eventType: 'CORRECTION_REQUESTED',
          description: `Correction requested: ${details.trim()}`
        }
      });

      const targetId = isClient ? dispute.providerId : dispute.clientId;
      sendDisputeNotification(
        targetId,
        'Correction Requested',
        'A correction has been requested for your booking dispute.',
        id,
        dispute.bookingId
      ).catch(() => {});

      return updatedDispute;
    });

    return res.status(200).json({ success: true, message: 'Correction request submitted.', data: updated });
  } catch (error) {
    next(error);
  }
};

/**
 * Complete correction
 */
const completeCorrection = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const dispute = await prisma.dispute.findUnique({ where: { id } });
    if (!dispute) return res.status(404).json({ success: false, message: 'Dispute not found.' });

    if (dispute.providerId !== userId) {
      return res.status(403).json({ success: false, message: 'Only the assigned provider can mark correction as completed.' });
    }

    const updated = await prisma.$transaction(async (tx) => {
      const updatedDispute = await tx.dispute.update({
        where: { id },
        data: { status: 'CORRECTION_COMPLETED' }
      });

      await tx.disputeEvent.create({
        data: {
          disputeId: id,
          actorId: userId,
          actorType: 'PROVIDER',
          eventType: 'CORRECTION_COMPLETED',
          description: 'Provider marked correction work as completed.'
        }
      });

      sendDisputeNotification(
        dispute.clientId,
        'Correction Completed',
        'The provider has marked the correction work as completed. Please inspect and review.',
        id,
        dispute.bookingId
      ).catch(() => {});

      return updatedDispute;
    });

    return res.status(200).json({ success: true, message: 'Correction marked as completed.', data: updated });
  } catch (error) {
    next(error);
  }
};

/**
 * Get user's disputes (Client or Provider)
 */
const getUserDisputes = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const page = parseInt(req.query.page) || 1;
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const skip = (page - 1) * limit;

    const where = {
      OR: [{ clientId: userId }, { providerId: userId }]
    };

    if (req.query.status) {
      where.status = req.query.status;
    }

    const [items, total] = await prisma.$transaction([
      prisma.dispute.findMany({
        where,
        include: {
          booking: { select: { id: true, notes: true, budget: true, status: true, bookingDate: true } },
          client: { select: { id: true, fullName: true, avatar: true } },
          provider: { select: { id: true, fullName: true, avatar: true } }
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit
      }),
      prisma.dispute.count({ where })
    ]);

    return res.status(200).json({
      success: true,
      data: items,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    next(error);
  }
};

// --- ADMIN DISPUTE OPERATIONS ---

/**
 * Admin list all disputes
 */
const getAdminDisputes = async (req, res, next) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const skip = (page - 1) * limit;

    const where = {};

    if (req.query.status) where.status = req.query.status;
    if (req.query.category) where.category = req.query.category;

    if (req.query.search) {
      const q = req.query.search.trim();
      where.OR = [
        { id: { contains: q, mode: 'insensitive' } },
        { bookingId: { contains: q, mode: 'insensitive' } },
        { description: { contains: q, mode: 'insensitive' } },
        { client: { fullName: { contains: q, mode: 'insensitive' } } },
        { provider: { fullName: { contains: q, mode: 'insensitive' } } }
      ];
    }

    const [items, total] = await prisma.$transaction([
      prisma.dispute.findMany({
        where,
        include: {
          booking: { select: { id: true, budget: true, status: true, bookingDate: true, location: true } },
          client: { select: { id: true, fullName: true, phone: true, avatar: true } },
          provider: { select: { id: true, fullName: true, phone: true, avatar: true } },
          assignedAdmin: { select: { id: true, fullName: true } }
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit
      }),
      prisma.dispute.count({ where })
    ]);

    return res.status(200).json({
      success: true,
      data: items,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Admin request evidence
 */
const adminRequestEvidence = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { targetRole, note } = req.body;
    const adminId = req.user.id;

    const dispute = await prisma.dispute.findUnique({ where: { id } });
    if (!dispute) return res.status(404).json({ success: false, message: 'Dispute not found.' });

    const targetUserId = targetRole === 'PROVIDER' ? dispute.providerId : dispute.clientId;
    const newStatus = targetRole === 'PROVIDER' ? 'AWAITING_PROVIDER_RESPONSE' : 'AWAITING_CLIENT_RESPONSE';

    const updated = await prisma.$transaction(async (tx) => {
      const updatedDispute = await tx.dispute.update({
        where: { id },
        data: {
          status: newStatus,
          assignedAdminId: adminId
        }
      });

      await tx.disputeEvent.create({
        data: {
          disputeId: id,
          actorId: adminId,
          actorType: 'ADMIN',
          eventType: 'ADMIN_REQUESTED_EVIDENCE',
          description: `Admin requested additional evidence from ${targetRole}. Note: ${note || 'None'}`
        }
      });

      sendDisputeNotification(
        targetUserId,
        'Evidence Requested by Support',
        `Support admin requested additional information/evidence for dispute #${id.substring(0, 8)}.`,
        id,
        dispute.bookingId
      ).catch(() => {});

      return updatedDispute;
    });

    return res.status(200).json({ success: true, message: 'Evidence requested.', data: updated });
  } catch (error) {
    next(error);
  }
};

/**
 * Admin resolve dispute
 */
const adminResolveDispute = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { resolution, resolutionReason } = req.body;
    const adminId = req.user.id;

    if (!resolution || !resolutionReason || !resolutionReason.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Resolution outcome and resolutionReason are strictly required.'
      });
    }

    const dispute = await prisma.dispute.findUnique({ where: { id } });
    if (!dispute) return res.status(404).json({ success: false, message: 'Dispute not found.' });

    const updated = await prisma.$transaction(async (tx) => {
      const updatedDispute = await tx.dispute.update({
        where: { id },
        data: {
          status: 'RESOLVED',
          resolution,
          resolutionReason: resolutionReason.trim(),
          assignedAdminId: adminId,
          resolvedAt: new Date()
        }
      });

      await tx.disputeEvent.create({
        data: {
          disputeId: id,
          actorId: adminId,
          actorType: 'ADMIN',
          eventType: 'DISPUTE_RESOLVED',
          description: `Dispute resolved with outcome '${resolution}': ${resolutionReason.trim()}`,
          metadata: { resolution }
        }
      });

      // Notify Client
      sendDisputeNotification(
        dispute.clientId,
        'Dispute Resolved',
        `Your dispute has been resolved by Support. Decision: ${resolutionReason.substring(0, 100)}`,
        id,
        dispute.bookingId
      ).catch(() => {});

      // Notify Provider
      sendDisputeNotification(
        dispute.providerId,
        'Dispute Resolved',
        `The dispute for booking #${dispute.bookingId.substring(0, 8)} has been resolved. Decision: ${resolutionReason.substring(0, 100)}`,
        id,
        dispute.bookingId
      ).catch(() => {});

      return updatedDispute;
    });

    return res.status(200).json({
      success: true,
      message: 'Dispute resolved successfully.',
      data: updated
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  createDispute,
  getDisputeDetails,
  respondToDispute,
  addEvidence,
  requestCorrection,
  completeCorrection,
  getUserDisputes,
  getAdminDisputes,
  adminRequestEvidence,
  adminResolveDispute
};
