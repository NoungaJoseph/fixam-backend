const { requestToPayWithKora, getPaymentStatusFromKora } =
  require('../services/mobile-money.service')
const prisma = require('../config/prisma')
const { sendPushNotification } =
  require('../services/notification.service')

const topup = async (req, res) => {
  try {
    const { amount, phone, coins } = req.body
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

    // Format phone - ensure it has country code
    const formatPhone = (p) => {
      const cleaned = String(p).replace(/\s+/g, '')
        .replace(/-/g, '').replace('+', '')
      if (cleaned.startsWith('237')) return cleaned
      return '237' + cleaned
    }
    const formattedPhone = formatPhone(phone)

    // Get or create user wallet
    let wallet = await prisma.wallet.findUnique({
      where: { userId }
    })
    if (!wallet) {
      wallet = await prisma.wallet.create({
        data: { userId, balance: 0 }
      })
    }

    // Get user info for Kora
    const user = await prisma.user.findUnique({
      where: { id: userId },
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

    // Call Kora API
    const koraResult = await requestToPayWithKora({
      amount: Number(amount),
      currency: 'XAF',
      description: `Fixam - ${coins} coins purchase`,
      redirectUrl: 'https://fixam-backend-production.up.railway.app/api/payments/redirect',
      notificationUrl: 'https://fixam-backend-production.up.railway.app/api/payments/webhook/kora',
      name: user?.fullName || 'Fixam User',
      email: user?.email || 'user@fixam.com',
      phone: formattedPhone
    })

    if (koraResult.error) {
      // Mark transaction as failed
      await prisma.transaction.update({
        where: { id: transaction.id },
        data: { status: 'FAILED' }
      })
      return res.status(400).json({
        success: false,
        message: koraResult.error[0] ||
          'Payment initiation failed'
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

    if (koraStatus === 'success') {
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

    if (koraStatus === 'failed') {
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

module.exports = { topup, checkPaymentStatus, handleRedirect }
