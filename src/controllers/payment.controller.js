const { requestToPayWithKora, getPaymentStatusFromKora } =
  require('../services/mobile-money.service')
const prisma = require('../config/prisma')
const { sendPushNotification } =
  require('../services/notification.service')

const topup = async (req, res) => {
  try {
    const { amount, phone, coins, provider } = req.body
    const userId = req.user.id

    // Validate inputs
    if (!amount || amount < 100) {
      return res.status(400).json({
        success: false,
        message: 'Minimum amount is 100 FCFA'
      })
    }
    if (!phone) {
      return res.status(400).json({
        success: false,
        message: 'Phone number is required'
      })
    }
    if (!coins || coins < 1) {
      return res.status(400).json({
        success: false,
        message: 'Must purchase at least 1 coin'
      })
    }

    // Get or create user wallet
    let wallet = await prisma.wallet.findUnique({
      where: { userId }
    })
    if (!wallet) {
      wallet = await prisma.wallet.create({
        data: { userId, balance: 0 }
      })
    }

    // Format phone — must be 237XXXXXXXXX no + sign
    const formatPhone = (p) => {
      const cleaned = String(p)
        .replace(/\s+/g, '')
        .replace(/-/g, '')
        .replace('+', '')
      if (cleaned.startsWith('237')) return cleaned
      return '237' + cleaned
    }
    const formattedPhone = formatPhone(phone)

    // Get user info
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { fullName: true, email: true }
    })

    // Create pending transaction record
    const transaction = await prisma.transaction.create({
      data: {
        walletId: wallet.id,
        amount: coins,
        type: 'PURCHASE',
        status: 'PENDING',
        description: `Purchase of ${coins} coins`,
        paidPrice: String(amount),
        payerPhone: formattedPhone,
        payerName: user?.fullName || 'Fixam User'
      }
    })

    // Call Kora with ALL required fields filled
    const koraResult = await requestToPayWithKora({
      amount: Number(amount),
      currency: 'XAF',
      description: `Fixam App - ${coins} coin purchase`,  
      redirectUrl: 'https://api.usefixam.com/api/payments/redirect',
      notificationUrl: 'https://api.usefixam.com/api/payments/webhook/kora',
      name: 'Fixam - ' + (user.fullName || 'User'),
      email: user.email || undefined,
      phone: formattedPhone,  // must be 237XXXXXXXXX
      provider: provider
    })

    // Check for validation errors
    if (koraResult.error) {
      console.error('[Payment] Kora validation error:', 
        koraResult.error)
      // Mark transaction as failed
      await prisma.transaction.update({
        where: { id: transaction.id },
        data: { status: 'FAILED' }
      })
      return res.status(400).json({
        success: false,
        message: koraResult.error[0] || 'Payment failed',
        fullError: koraResult.koraError || koraResult.error
      })
    }

    // Save the Kora reference to transaction
    const reference = koraResult.reference
    await prisma.transaction.update({
      where: { id: transaction.id },
      data: { reference }
    })

    // Return success with reference for status polling
    return res.json({
      success: true,
      message: 'Payment initiated. Please approve on your phone.',
      reference,
      transactionId: transaction.id,
      amount,
      coins
    })

  } catch (error) {
    console.error('[Payment] Topup error:', error)
    return res.status(500).json({
      success: false,
      message: 'Payment initiation failed'
    })
  }
}

// Status polling endpoint
const checkPaymentStatus = async (req, res) => {
  try {
    const { reference } = req.params
    const userId = req.user.id

    // Get transaction
    const transaction = await prisma.transaction.findUnique({
      where: { reference },
      include: { wallet: true }
    })

    if (!transaction || transaction.wallet.userId !== userId) {
      return res.status(404).json({
        success: false,
        message: 'Transaction not found'
      })
    }

    // If already processed, return current status
    if (transaction.status === 'SUCCESS') {
      return res.json({
        success: true,
        status: 'success',
        message: 'Payment already completed',
        coins: transaction.amount
      })
    }

    if (transaction.status === 'FAILED') {
      return res.json({
        success: false,
        status: 'failed',
        message: 'Payment failed'
      })
    }

    // Check status with Kora
    const statusResult = await getPaymentStatusFromKora(reference)
    const koraStatus = String(statusResult.data.status || '').toLowerCase()

    console.log('[Payment] Kora status:', reference, koraStatus)

    if (['success', 'successful', 'completed', 'paid'].includes(koraStatus)) {
      // Add coins to wallet
      await prisma.wallet.update({
        where: { id: transaction.walletId },
        data: { balance: { increment: transaction.amount } }
      })

      // Mark transaction as success
      await prisma.transaction.update({
        where: { reference },
        data: { status: 'SUCCESS' }
      })

      // Send push notification
      await sendPushNotification(
        userId,
        'Coins Added! 🎉',
        `${transaction.amount} coins have been added to your wallet`,
        { type: 'COINS_ADDED' }
      ).catch(() => {})

      return res.json({
        success: true,
        status: 'success',
        message: `${transaction.amount} coins added to your wallet`,
        coins: transaction.amount
      })
    }

    if (['failed', 'cancelled', 'canceled', 'expired', 'rejected', 'declined', 'error'].includes(koraStatus)) {
      await prisma.transaction.update({
        where: { reference },
        data: { status: 'FAILED' }
      })

      return res.json({
        success: false,
        status: 'failed',
        message: statusResult.data.reason || 'Payment failed'
      })
    }

    // Still pending
    return res.json({
      success: true,
      status: 'pending',
      message: 'Payment is being processed. Please approve on your phone.'
    })

  } catch (error) {
    console.error('[Payment] Status check error:', error)
    return res.status(500).json({
      success: false,
      message: 'Status check failed'
    })
  }
}

// Simple redirect handler
const handleRedirect = async (req, res) => {
  res.send('Payment processed. Please return to the Fixam app.')
}

const koraWebhook = async (req, res) => {
  try {
    console.log('[Kora Webhook] Received payload:', JSON.stringify(req.body));
    
    // Kora webhook payload typically contains the reference in data.reference
    const reference = req.body?.data?.reference || req.body?.reference;
    
    if (!reference) {
      return res.status(400).json({ success: false, message: 'Missing reference' });
    }

    // Always verify with Kora directly to prevent spoofing
    const statusResult = await getPaymentStatusFromKora(reference);
    const koraStatus = String(statusResult.data.status || '').toLowerCase();

    console.log('[Kora Webhook] Verified status for', reference, ':', koraStatus);

    const transaction = await prisma.transaction.findUnique({
      where: { reference },
      include: { wallet: true }
    });

    if (!transaction) {
      return res.status(404).json({ success: false, message: 'Transaction not found' });
    }

    if (transaction.status === 'SUCCESS' || transaction.status === 'FAILED') {
      return res.status(200).json({ success: true, message: 'Already processed' });
    }

    if (koraStatus === 'success') {
      await prisma.$transaction(async (tx) => {
        await tx.wallet.update({
          where: { id: transaction.walletId },
          data: { balance: { increment: transaction.amount } }
        });

        await tx.transaction.update({
          where: { reference },
          data: { status: 'SUCCESS' }
        });
      });

      await sendPushNotification(
        transaction.wallet.userId,
        'Coins Added! 🎉',
        `${transaction.amount} coins have been added to your wallet`,
        { type: 'COINS_ADDED' }
      ).catch(() => {});
      
      try {
        const { getIO } = require('../services/socket.service');
        const io = getIO();
        const updatedWallet = await prisma.wallet.findUnique({ where: { id: transaction.walletId } });
        io.to(transaction.wallet.userId).emit('wallet:update', { balance: updatedWallet.balance });
      } catch (e) {
        console.error('[Socket Error] Could not emit wallet update:', e.message);
      }
    } else if (koraStatus === 'failed') {
      await prisma.transaction.update({
        where: { reference },
        data: { status: 'FAILED' }
      });
    }

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error('[Kora Webhook] Error:', error);
    return res.status(500).json({ success: false });
  }
};

module.exports = { topup, checkPaymentStatus, handleRedirect, koraWebhook };
