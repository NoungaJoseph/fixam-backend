const prisma = require('../config/prisma');
const path = require('path');
const fs = require('fs').promises;
const {
  normalizeProvider,
  parseAmount,
  requestCollection,
  verifySignature,
  isSuccessfulWebhook,
  isFailedWebhook,
} = require('../services/mobile-money.service');

const emitPaymentUpdate = async (userId, payment, wallet) => {
  try {
    const { getIO } = require('../services/socket.service');
    const io = getIO();
    io.to(userId).emit('payment:update', payment);
    io.to(userId).emit('wallet:update', { balance: wallet?.balance });
    io.emit('admin:payment:update', payment);
  } catch (err) {
    console.error('[Socket Error] Payment update failed:', err.message);
  }
};

const completePayment = async ({ providerReference, status, payload, failureReason }) => {
  const payment = await prisma.payment.findUnique({
    where: { providerReference },
    include: { transaction: true, user: { include: { wallet: true } } }
  });

  if (!payment) return null;
  if (payment.status === 'SUCCESS' || payment.status === 'FAILED') return payment;

  const result = await prisma.$transaction(async (tx) => {
    const claimed = await tx.payment.updateMany({
      where: { id: payment.id, status: { in: ['PENDING', 'PROCESSING'] } },
      data: { status, providerPayload: payload || payment.providerPayload, failureReason: failureReason || null }
    });
    if (!claimed.count) return tx.payment.findUnique({ where: { id: payment.id } });

    const transaction = await tx.transaction.update({
      where: { id: payment.transactionId },
      data: { status: status === 'SUCCESS' ? 'SUCCESS' : 'FAILED' }
    });

    await tx.coinPurchase.update({
      where: { paymentId: payment.id },
      data: { status, transactionId: transaction.id }
    });

    let wallet = payment.user.wallet;
    if (status === 'SUCCESS') {
      wallet = await tx.wallet.update({
        where: { id: transaction.walletId },
        data: { balance: { increment: payment.coins } }
      });
      await tx.notification.create({
        data: {
          userId: payment.userId,
          title: 'Coins added',
          body: `${payment.coins} coins were added to your Fixam wallet.`,
          data: { type: 'PAYMENT', paymentId: payment.id, transactionId: transaction.id, status }
        }
      });
    } else {
      await tx.notification.create({
        data: {
          userId: payment.userId,
          title: 'Payment failed',
          body: failureReason || 'Your mobile money payment was not completed.',
          data: { type: 'PAYMENT', paymentId: payment.id, transactionId: transaction.id, status }
        }
      });
    }

    return tx.payment.findUnique({
      where: { id: payment.id },
      include: { transaction: true, user: { include: { wallet: true } } }
    });
  });

  await emitPaymentUpdate(payment.userId, result, result?.user?.wallet);
  return result;
};

const getBalance = async (req, res, next) => {
  try {
    const wallet = await prisma.wallet.findUnique({
      where: { userId: req.user.id },
      include: { transactions: { orderBy: { createdAt: 'desc' }, take: 10 } }
    });

    if (!wallet) {
      return res.status(200).json({ 
        success: true, 
        data: { balance: 0, thisMonthTransactions: 0, thisMonthSpent: 0, completedTasks: 0, nextLevelTasks: 5, progressPercent: 0 } 
      });
    }

    const now = new Date();
    const firstDayOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const thisMonthTxStats = await prisma.transaction.aggregate({
      _count: { id: true },
      _sum: { amount: true },
      where: {
        walletId: wallet.id,
        status: 'SUCCESS',
        createdAt: { gte: firstDayOfMonth }
      }
    });

    const completedJobsCount = await prisma.job.count({
      where: {
        status: 'COMPLETED',
        updatedAt: { gte: firstDayOfMonth },
        OR: [
          { clientId: req.user.id },
          { assignments: { some: { provider: { userId: req.user.id } } } }
        ]
      }
    });

    const completedBookingsCount = await prisma.booking.count({
      where: {
        status: 'COMPLETED',
        updatedAt: { gte: firstDayOfMonth },
        OR: [
          { clientId: req.user.id },
          { providerId: req.user.id }
        ]
      }
    });

    const completedTasksCount = completedJobsCount + completedBookingsCount;

    const completedJobs = await prisma.job.count({
      where: {
        status: 'COMPLETED',
        OR: [
          { clientId: req.user.id },
          { assignments: { some: { provider: { userId: req.user.id } } } }
        ]
      }
    });

    const completedBookings = await prisma.booking.count({
      where: {
        status: 'COMPLETED',
        OR: [
          { clientId: req.user.id },
          { providerId: req.user.id }
        ]
      }
    });

    const completedTasks = completedJobs + completedBookings;

    let nextLevelTasks = 5;
    if (completedTasks >= 5) nextLevelTasks = 10;
    if (completedTasks >= 10) nextLevelTasks = 20;
    if (completedTasks >= 20) nextLevelTasks = 50;
    if (completedTasks >= 50) nextLevelTasks = Math.floor(completedTasks / 10) * 10 + 10;

    const progressPercent = Math.min(100, Math.round((completedTasks / nextLevelTasks) * 100));

    const enrichedWallet = {
      ...wallet,
      thisMonthTransactions: completedTasksCount,
      thisMonthSpent: Math.abs(thisMonthTxStats._sum.amount || 0),
      completedTasks,
      nextLevelTasks,
      progressPercent
    };

    res.status(200).json({ success: true, data: enrichedWallet });
  } catch (error) {
    next(error);
  }
};

const topUpRequest = async (req, res, next) => {
  try {
    const { amount, coins, reference, paymentMethod, phone } = req.body;
    const coinAmount = Number(coins || amount);

    if (!coinAmount || coinAmount < 1) {
      return res.status(400).json({ success: false, message: 'A valid coin amount is required' });
    }

    const wallet = req.user.wallet || await prisma.wallet.create({
      data: { userId: req.user.id, balance: 0 }
    });

    const transaction = await prisma.transaction.create({
      data: {
        walletId: wallet.id,
        amount: coinAmount,
        type: 'PURCHASE',
        status: 'PENDING',
        reference: reference || `FIX-${Date.now()}`,
        description: `Top-up request for ${coinAmount} coins${paymentMethod ? ` via ${paymentMethod}` : ''}${phone ? ` (${phone})` : ''}`
      }
    });

    res.status(201).json({ success: true, data: transaction, message: 'Top-up request submitted for approval' });
  } catch (error) {
    next(error);
  }
};

const initiateMobileMoneyPurchase = async (req, res, next) => {
  try {
    const { coins, price, amount, provider, phone, fullName, email } = req.body;
    const coinAmount = Number(coins);
    const paymentProvider = normalizeProvider(provider);
    const fcfaAmount = parseAmount(amount || price);

    if (!coinAmount || coinAmount < 1) {
      return res.status(400).json({ success: false, message: 'A valid coin amount is required' });
    }

    if (!paymentProvider) {
      return res.status(400).json({ success: false, message: 'Choose MTN Mobile Money or Orange Money' });
    }

    if (!phone || String(phone).replace(/\D/g, '').length < 8) {
      return res.status(400).json({ success: false, message: 'A valid mobile money phone number is required' });
    }

    const wallet = req.user.wallet || await prisma.wallet.create({
      data: { userId: req.user.id, balance: 0 }
    });
    const reference = `FIX-${paymentProvider}-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    const callbackUrl = `${process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`}/api/wallet/mobile-money/webhook/${paymentProvider.toLowerCase()}`;

    const providerResult = await requestCollection({
      provider: paymentProvider,
      amount: fcfaAmount,
      phone,
      reference,
      callbackUrl,
      user: req.user,
    });

    const payment = await prisma.$transaction(async (tx) => {
      const transaction = await tx.transaction.create({
        data: {
          walletId: wallet.id,
          amount: coinAmount,
          type: 'PURCHASE',
          status: 'PENDING',
          reference,
          paidPrice: `${fcfaAmount} FCFA`,
          payerName: fullName || req.user.fullName,
          payerPhone: providerResult.phoneNumber,
          payerEmail: email || req.user.email,
          paymentMethod: providerResult.paymentMethod,
          providerReference: providerResult.providerReference,
          phoneNumber: providerResult.phoneNumber,
          description: `${paymentProvider} automatic mobile money coin purchase: ${coinAmount} coins`
        }
      });

      const paymentRecord = await tx.payment.create({
        data: {
          userId: req.user.id,
          transactionId: transaction.id,
          amount: fcfaAmount,
          coins: coinAmount,
          paymentMethod: providerResult.paymentMethod,
          providerReference: providerResult.providerReference,
          status: 'PROCESSING',
          phoneNumber: providerResult.phoneNumber,
          providerPayload: { checkoutStatus: providerResult.checkoutStatus }
        }
      });

      await tx.coinPurchase.create({
        data: {
          userId: req.user.id,
          paymentId: paymentRecord.id,
          transactionId: transaction.id,
          amount: fcfaAmount,
          coins: coinAmount,
          paymentMethod: providerResult.paymentMethod,
          providerReference: providerResult.providerReference,
          status: 'PROCESSING',
          phoneNumber: providerResult.phoneNumber
        }
      });

      return tx.payment.findUnique({
        where: { id: paymentRecord.id },
        include: { transaction: true }
      });
    });

    res.status(201).json({
      success: true,
      data: {
        ...payment,
        provider: paymentProvider,
        checkoutStatus: providerResult.checkoutStatus
      },
      message: `Payment prompt sent to ${providerResult.phoneNumber}. Confirm it on your ${paymentProvider === 'MTN' ? 'MTN MoMo' : 'Orange Money'} phone.`
    });
  } catch (error) {
    next(error);
  }
};

const getPaymentStatus = async (req, res, next) => {
  try {
    const payment = await prisma.payment.findFirst({
      where: { id: req.params.paymentId, userId: req.user.id },
      include: { transaction: true }
    });
    if (!payment) return res.status(404).json({ success: false, message: 'Payment not found' });
    res.status(200).json({ success: true, data: payment });
  } catch (error) {
    next(error);
  }
};

const mobileMoneyWebhook = async (req, res, next) => {
  try {
    const providerKey = normalizeProvider(req.params.provider);
    if (!providerKey) return res.status(400).json({ success: false, message: 'Unknown provider' });

    const signature = req.get('x-fixam-signature') || req.get('x-signature');
    if (!verifySignature(providerKey, req.body, signature)) {
      return res.status(401).json({ success: false, message: 'Invalid webhook signature' });
    }

    const providerReference = req.body.externalId || req.body.reference || req.body.order_id || req.body.transactionId || req.body.financialTransactionId;
    if (!providerReference) return res.status(400).json({ success: false, message: 'Missing provider reference' });

    let status = 'PROCESSING';
    if (isSuccessfulWebhook(req.body)) status = 'SUCCESS';
    if (isFailedWebhook(req.body)) status = 'FAILED';

    const payment = status === 'PROCESSING'
      ? await prisma.payment.update({
          where: { providerReference },
          data: { providerPayload: req.body },
          include: { transaction: true }
        }).catch(() => null)
      : await completePayment({
          providerReference,
          status,
          payload: req.body,
          failureReason: req.body.reason || req.body.message
        });

    if (!payment) return res.status(404).json({ success: false, message: 'Payment not found' });
    res.status(200).json({ success: true });
  } catch (error) {
    next(error);
  }
};

const requestCoinsWithReceipt = async (req, res, next) => {
  try {
    const { amount, price, paymentId, fullName, phone, email } = req.body;
    const coinAmount = parseInt(amount, 10);

    if (!coinAmount || coinAmount < 1) {
      return res.status(400).json({ success: false, message: 'Valid coin amount is required' });
    }

    if (!req.file) {
      return res.status(400).json({ success: false, message: 'Receipt image is required' });
    }

    const wallet = req.user.wallet || await prisma.wallet.create({
      data: { userId: req.user.id, balance: 0 }
    });
    const receiptUrl = req.file.path
      ? `/${req.file.path.replace(/\\/g, '/')}`
      : `/uploads/receipts/${req.file.filename}`;
    
    const transaction = await prisma.transaction.create({
      data: {
        walletId: wallet.id,
        amount: coinAmount,
        type: 'PURCHASE',
        status: 'PENDING',
        reference: paymentId,
        paidPrice: price,
        receiptUrl,
        payerName: fullName,
        payerPhone: phone,
        payerEmail: email,
        description: `Manual coin purchase: ${coinAmount} coins | Receipt uploaded | Phone: ${phone}`
      }
    });

    const userNotification = await prisma.notification.create({
      data: {
        userId: req.user.id,
        title: 'Coin purchase pending',
        body: `Your request for ${coinAmount} coins is pending admin approval.`,
        data: { type: 'TRANSACTION', transactionId: transaction.id, status: 'PENDING' }
      }
    });

    const admins = await prisma.user.findMany({
      where: { role: 'ADMIN' },
      select: { id: true }
    });
    await prisma.notification.createMany({
      data: admins.map((admin) => ({
        userId: admin.id,
        title: 'New Coin Purchase Request',
        body: `${fullName} (${phone}) submitted a payment request for ${coinAmount} coins`,
        data: { 
          type: 'TRANSACTION', 
          transactionId: transaction.id,
          userId: req.user.id,
          receiptUrl,
          userInfo: { fullName, phone, email }
        }
      }))
    });

    try {
      const { getIO } = require('../services/socket.service');
      const io = getIO();
      io.to(req.user.id).emit('notification:new', userNotification);
      io.emit('transaction:pending-approval', {
        transactionId: transaction.id,
        userId: req.user.id,
        userName: fullName,
        amount: coinAmount,
        receiptUrl
      });
    } catch (err) {
      console.error('[Socket Error] Coin purchase notification failed:', err.message);
    }

    res.status(201).json({
      success: true,
      data: transaction,
      message: 'Payment request submitted for admin approval'
    });
  } catch (error) {
    // Clean up uploaded file if transaction creation fails
    if (req.file) {
      await fs.unlink(req.file.path).catch(() => {});
    }
    next(error);
  }
};

const getCoinTransactions = async (req, res, next) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const skip = (page - 1) * limit;

    const [items, total] = await prisma.$transaction([
      prisma.transaction.findMany({
        where: {
          wallet: { userId: req.user.id },
          isSystemTransaction: false
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit
      }),
      prisma.transaction.count({
        where: {
          wallet: { userId: req.user.id },
          isSystemTransaction: false
        }
      })
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

module.exports = {
  getBalance,
  topUpRequest,
  initiateMobileMoneyPurchase,
  getPaymentStatus,
  mobileMoneyWebhook,
  requestCoinsWithReceipt,
  getCoinTransactions
};
