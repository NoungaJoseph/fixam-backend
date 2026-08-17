const prisma = require('../config/prisma');
const { generateAgreementPdf } = require('./agreementPdf.service');
const { sendPushNotification } = require('./notification.service');
const { getIO } = require('./socket.service');

/**
 * Generates a public agreement number: FSA-YYYY-XXXXXX-v1
 */
function generateAgreementNumber(sequenceNumber, version = 1) {
  const year = new Date().getFullYear();
  const seqStr = String(sequenceNumber).padStart(6, '0');
  return `FSA-${year}-${seqStr}-v${version}`;
}

/**
 * Creates or updates a ServiceAgreement when booking or task is accepted.
 */
async function createOrUpdateAgreement({
  sourceType = 'BOOKING',
  bookingId = null,
  taskId = null,
  clientId,
  providerId,
  title,
  category,
  scopeOfWork,
  location,
  schedule,
  price,
  currency = 'XAF',
  materialsList = []
}) {
  try {
    // Check if an active/pending agreement already exists for this booking/task
    const existing = await prisma.serviceAgreement.findFirst({
      where: {
        OR: [
          bookingId ? { bookingId } : null,
          taskId ? { taskId } : null
        ].filter(Boolean),
        status: { in: ['PENDING_ACCEPTANCE', 'ACTIVE', 'PARTIALLY_ACCEPTED', 'AMENDMENT_PENDING'] }
      },
      orderBy: { version: 'desc' }
    });

    if (existing) {
      return existing;
    }

    const count = await prisma.serviceAgreement.count();
    const publicAgreementNumber = generateAgreementNumber(count + 1, 1);

    const clientUser = await prisma.user.findUnique({ where: { id: clientId }, select: { id: true, fullName: true, phone: true, email: true } });
    const providerUser = await prisma.user.findUnique({ where: { id: providerId }, select: { id: true, fullName: true, phone: true, email: true } });

    const terms = {
      title: title || 'Fixam Professional Service',
      category: category || 'General Service',
      scopeOfWork: scopeOfWork || 'As specified in booking details.',
      location: location || 'Client specified address',
      schedule: {
        date: schedule?.date || 'As scheduled',
        time: schedule?.time || 'As scheduled',
        duration: schedule?.duration || 'Standard',
        urgency: schedule?.urgency || 'Normal'
      },
      price: Number(price || 0),
      currency: currency || 'XAF',
      materialsList: Array.isArray(materialsList) ? materialsList : [],
      client: {
        id: clientUser?.id,
        name: clientUser?.fullName || 'Client',
        phone: clientUser?.phone
      },
      provider: {
        id: providerUser?.id,
        name: providerUser?.fullName || 'Provider',
        phone: providerUser?.phone
      }
    };

    // Automatically record mutual acceptance upon booking/task confirmation
    const nowIso = new Date().toISOString();
    const initialClientAcc = { status: 'ACCEPTED', acceptedAt: nowIso, disclaimerAccepted: true };
    const initialProviderAcc = { status: 'ACCEPTED', acceptedAt: nowIso, disclaimerAccepted: true };

    const agreement = await prisma.serviceAgreement.create({
      data: {
        publicAgreementNumber,
        sourceType,
        bookingId,
        taskId,
        clientId,
        providerId,
        version: 1,
        status: 'ACTIVE',
        activatedAt: new Date(),
        terms,
        clientAcceptance: initialClientAcc,
        providerAcceptance: initialProviderAcc
      }
    });

    // Generate both English and French PDF contracts in background
    Promise.all([
      generateAgreementPdf(agreement, 'en'),
      generateAgreementPdf(agreement, 'fr')
    ]).then(async ([enPdf, frPdf]) => {
      await prisma.serviceAgreement.update({
        where: { id: agreement.id },
        data: { pdfReference: enPdf.publicUrl }
      });
    }).catch(err => console.error('[Agreement PDF] Error generating dual PDFs:', err.message));

    // Send notifications to both parties
    const notifBody = `Fixam Service Agreement (${publicAgreementNumber}) has been generated and is ready for review.`;
    await sendPushNotification(clientId, 'Service Agreement Ready', notifBody, {
      type: 'AGREEMENT',
      agreementId: agreement.id,
      bookingId,
      taskId
    });
    await sendPushNotification(providerId, 'Service Agreement Ready', notifBody, {
      type: 'AGREEMENT',
      agreementId: agreement.id,
      bookingId,
      taskId
    });

    return agreement;
  } catch (err) {
    console.error('[Agreement Service] Error creating agreement:', err.message);
    throw err;
  }
}

/**
 * Records digital acceptance for Client or Provider.
 */
async function recordAcceptance({ agreementId, userId, userRole, ipAddress = null, userAgent = null }) {
  try {
    const agreement = await prisma.serviceAgreement.findUnique({
      where: { id: agreementId },
      include: { client: true, provider: true }
    });

    if (!agreement) {
      throw new Error('Agreement not found.');
    }

    const isClient = userId === agreement.clientId;
    const isProvider = userId === agreement.providerId;

    if (!isClient && !isProvider) {
      throw new Error('Not authorized to accept this agreement.');
    }

    const currentClientAcc = agreement.clientAcceptance || { status: 'PENDING' };
    const currentProviderAcc = agreement.providerAcceptance || { status: 'PENDING' };

    const acceptanceRecord = {
      status: 'ACCEPTED',
      acceptedAt: new Date().toISOString(),
      ipAddress: ipAddress || '127.0.0.1',
      userAgent: userAgent || 'Fixam Platform',
      disclaimerAccepted: true
    };

    let updatedClientAcc = currentClientAcc;
    let updatedProviderAcc = currentProviderAcc;

    if (isClient) updatedClientAcc = acceptanceRecord;
    if (isProvider) updatedProviderAcc = acceptanceRecord;

    const bothAccepted = updatedClientAcc.status === 'ACCEPTED' && updatedProviderAcc.status === 'ACCEPTED';
    const nextStatus = bothAccepted ? 'ACTIVE' : 'PARTIALLY_ACCEPTED';

    const updatedAgreement = await prisma.serviceAgreement.update({
      where: { id: agreementId },
      data: {
        clientAcceptance: updatedClientAcc,
        providerAcceptance: updatedProviderAcc,
        status: nextStatus,
        activatedAt: bothAccepted ? new Date() : agreement.activatedAt
      }
    });

    // Regenerate PDF with updated acceptance timestamps
    generateAgreementPdf(updatedAgreement)
      .then(async ({ publicUrl }) => {
        await prisma.serviceAgreement.update({
          where: { id: agreementId },
          data: { pdfReference: publicUrl }
        });
      })
      .catch(err => console.error('[Agreement PDF] Error updating PDF on acceptance:', err.message));

    // Emit Socket Update
    try {
      const io = getIO();
      io.to(agreement.clientId).emit('agreement:update', updatedAgreement);
      io.to(agreement.providerId).emit('agreement:update', updatedAgreement);
    } catch (_) {}

    // Dispatch Push Notification to the other party
    const targetUserId = isClient ? agreement.providerId : agreement.clientId;
    const signerName = isClient ? agreement.client?.fullName : agreement.provider?.fullName;
    const notifMsg = `${signerName} accepted the Fixam Service Agreement (${agreement.publicAgreementNumber}).`;

    await sendPushNotification(targetUserId, 'Agreement Accepted', notifMsg, {
      type: 'AGREEMENT',
      agreementId: agreement.id
    });

    return updatedAgreement;
  } catch (err) {
    console.error('[Agreement Service] Error recording acceptance:', err.message);
    throw err;
  }
}

module.exports = {
  createOrUpdateAgreement,
  recordAcceptance,
  generateAgreementNumber
};
