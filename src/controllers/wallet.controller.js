const prisma = require('../config/prisma');
const path = require('path');
const fs = require('fs').promises;

const getBalance = async (req, res, next) => {
  try {
    const wallet = await prisma.wallet.findUnique({
      where: { userId: req.user.id },
      include: { transactions: { orderBy: { createdAt: 'desc' }, take: 10 } }
    });
    res.status(200).json({ success: true, data: wallet });
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

    const transaction = await prisma.transaction.create({
      data: {
        walletId: req.user.wallet.id,
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
    const transactions = await prisma.transaction.findMany({
      where: {
        wallet: { userId: req.user.id }
      },
      orderBy: { createdAt: 'desc' },
      take: 50
    });

    res.status(200).json({ success: true, data: transactions });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getBalance,
  topUpRequest,
  requestCoinsWithReceipt,
  getCoinTransactions
};
