/**
 * Payment Controller — Kora Mobile Money
 * All secret keys and payment processing happen here — never in the frontend.
 */
const prisma = require('../config/prisma');
const koraService = require('../services/mobile-money.service');

// ─── Socket helper ────────────────────────────────────────────────────────────

const emitPaymentEvents = (userId, { payment, wallet, transaction }) => {
  try {
    const { getIO } = require('../services/socket.service');
    const io = getIO();

    // User-specific events
    io.to(userId).emit('paymentSuccess', {
      paymentId: payment.id,
      coins: payment.coins,
      amount: payment.amount,
      status: payment.status,
      reference: payment.providerReference,
    });
    io.to(userId).emit('walletUpdated', {
      balance: wallet?.balance,
    });
    io.to(userId).emit('transactionCreated', transaction);

    // Backward-compat events (older app versions)
    io.to(userId).emit('payment:update', payment);
    io.to(userId).emit('wallet:update', { balance: wallet?.balance });

    // Admin dashboard event
    io.emit('admin:payment:update', payment);
  } catch (err) {
    console.error('[Socket] Payment event emission failed:', err.message);
  }
};

// ─── Idempotent payment completion (used by webhook) ─────────────────────────

const completePayment = async ({ providerReference, status, payload, failureReason }) => {
  const payment = await prisma.payment.findUnique({
    where: { providerReference },
    include: {
      transaction: true,
      user: { include: { wallet: true } },
    },
  });

  if (!payment) {
    console.warn(`[Kora Webhook] No payment found for reference: ${providerReference}`);
    return null;
  }

  // Idempotency — skip if already finalised
  if (payment.status === 'SUCCESS' || payment.status === 'FAILED') {
    console.log(`[Kora Webhook] Already processed: ${providerReference} → ${payment.status}`);
    return payment;
  }

  const result = await prisma.$transaction(async (tx) => {
    // Atomic claim — prevents race conditions from duplicate webhooks
    const claimed = await tx.payment.updateMany({
      where: {
        id: payment.id,
        status: { in: ['PENDING', 'PROCESSING'] },
      },
      data: {
        status,
        providerPayload: payload || payment.providerPayload,
        failureReason: failureReason || null,
        updatedAt: new Date(),
      },
    });

    if (!claimed.count) {
      // Another process already claimed it — return current state
      return tx.payment.findUnique({
        where: { id: payment.id },
        include: { transaction: true, user: { include: { wallet: true } } },
      });
    }

    // Update linked transaction
    await tx.transaction.update({
      where: { id: payment.transactionId },
      data: { status: status === 'SUCCESS' ? 'SUCCESS' : 'FAILED' },
    });

    // Update coin purchase record
    await tx.coinPurchase.update({
      where: { paymentId: payment.id },
      data: {
        status,
        transactionId: payment.transactionId,
      },
    });

    let wallet = payment.user.wallet;

    if (status === 'SUCCESS') {
      // Credit the wallet
      wallet = await tx.wallet.update({
        where: { id: payment.user.wallet.id },
        data: { balance: { increment: payment.coins } },
      });

      await tx.notification.create({
        data: {
          userId: payment.userId,
          title: '🎉 Coins Added!',
          body: `${payment.coins} coins have been added to your Fixam wallet.`,
          data: {
            type: 'PAYMENT',
            paymentId: payment.id,
            transactionId: payment.transactionId,
            status: 'SUCCESS',
            coins: payment.coins,
          },
        },
      });
    } else {
      await tx.notification.create({
        data: {
          userId: payment.userId,
          title: 'Payment Failed',
          body:
            failureReason ||
            'Your mobile money payment was not completed. Please try again.',
          data: {
            type: 'PAYMENT',
            paymentId: payment.id,
            transactionId: payment.transactionId,
            status: 'FAILED',
          },
        },
      });
    }

    return tx.payment.findUnique({
      where: { id: payment.id },
      include: { transaction: true, user: { include: { wallet: true } } },
    });
  });

  // Emit real-time updates after successful DB transaction
  emitPaymentEvents(payment.userId, {
    payment: result,
    wallet: result?.user?.wallet,
    transaction: result?.transaction,
  });

  return result;
};

// ─── POST /api/payments/topup ─────────────────────────────────────────────────

const topup = async (req, res, next) => {
  try {
    const { amount, phone, provider, coins } = req.body;

    // --- Input validation ---
    const coinAmount = Number(coins);
    if (!coinAmount || coinAmount < 1) {
      return res
        .status(400)
        .json({ success: false, message: 'A valid coin amount is required.' });
    }

    const providerKey = koraService.normalizeProvider(provider);
    if (!providerKey) {
      return res.status(400).json({
        success: false,
        message: 'Choose MTN Mobile Money or Orange Money.',
      });
    }

    if (!phone || String(phone).replace(/\D/g, '').length < 8) {
      return res.status(400).json({
        success: false,
        message: 'A valid mobile money phone number is required.',
      });
    }

    const fcfaAmount = koraService.parseAmount(amount);

    // --- Ensure wallet exists ---
    const wallet =
      req.user.wallet ||
      (await prisma.wallet.create({
        data: { userId: req.user.id, balance: 0 },
      }));

    // --- Generate unique reference ---
    const reference = `FIX-KORA-${providerKey}-${Date.now()}-${Math.floor(Math.random() * 10000)}`;

    // --- Call Kora API ---
    const koraResult = await koraService.requestCollection({
      provider: providerKey,
      amount: fcfaAmount,
      phone,
      reference,
      user: req.user,
    });

    // --- Persist payment records atomically ---
    const payment = await prisma.$transaction(async (tx) => {
      const transaction = await tx.transaction.create({
        data: {
          walletId: wallet.id,
          amount: coinAmount,
          type: 'PURCHASE',
          status: 'PENDING',
          reference,
          paidPrice: `${fcfaAmount} XAF`,
          payerName: req.user.fullName,
          payerPhone: koraResult.phoneNumber,
          payerEmail: req.user.email,
          paymentMethod: koraResult.paymentMethod,
          providerReference: reference,
          phoneNumber: koraResult.phoneNumber,
          description: `Kora ${providerKey} mobile money: ${coinAmount} coins`,
        },
      });

      const paymentRecord = await tx.payment.create({
        data: {
          userId: req.user.id,
          transactionId: transaction.id,
          amount: fcfaAmount,
          coins: coinAmount,
          paymentMethod: koraResult.paymentMethod,
          providerReference: reference,
          status: 'PROCESSING',
          phoneNumber: koraResult.phoneNumber,
          providerPayload: {
            checkoutStatus: koraResult.checkoutStatus,
            checkoutUrl: koraResult.checkoutUrl,
            koraReference: koraResult.koraReference,
            rawResponse: koraResult.rawResponse,
          },
        },
      });

      await tx.coinPurchase.create({
        data: {
          userId: req.user.id,
          paymentId: paymentRecord.id,
          transactionId: transaction.id,
          amount: fcfaAmount,
          coins: coinAmount,
          paymentMethod: koraResult.paymentMethod,
          providerReference: reference,
          status: 'PROCESSING',
          phoneNumber: koraResult.phoneNumber,
        },
      });

      return tx.payment.findUnique({
        where: { id: paymentRecord.id },
        include: { transaction: true },
      });
    });

    const providerLabel = providerKey === 'MTN' ? 'MTN MoMo' : 'Orange Money';

    return res.status(201).json({
      success: true,
      data: {
        paymentId: payment.id,
        reference,
        provider: providerKey,
        checkoutStatus: koraResult.checkoutStatus,
        checkoutUrl: koraResult.checkoutUrl,
        phoneNumber: koraResult.phoneNumber,
        amount: fcfaAmount,
        coins: coinAmount,
      },
      message: `Payment prompt sent to ${koraResult.phoneNumber}. Approve it on your ${providerLabel} phone.`,
    });
  } catch (error) {
    console.error('[Topup] Error:', error.message);
    if (error.statusCode) {
      return res.status(error.statusCode).json({ success: false, message: error.message });
    }
    if (error.response) {
      // Kora API error
      console.error('[Kora API] Error response:', error.response.data);
      return res.status(502).json({
        success: false,
        message:
          error.response.data?.message ||
          'Payment gateway error. Please try again.',
      });
    }
    next(error);
  }
};

// ─── POST /api/payments/webhook/kora ─────────────────────────────────────────

const koraWebhook = async (req, res, next) => {
  try {
    // req.body is raw Buffer when mounted with express.raw()
    const rawBody = req.body;
    const signature =
      req.headers['x-korapay-signature'] ||
      req.headers['x-kora-signature'] ||
      req.headers['x-signature'];

    // 1. Validate signature
    if (!koraService.verifySignature(rawBody, signature)) {
      console.warn('[Kora Webhook] Invalid signature — rejecting');
      return res.status(401).json({ success: false, message: 'Invalid webhook signature' });
    }

    // 2. Parse body
    let payload;
    try {
      const bodyStr = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : String(rawBody);
      payload = JSON.parse(bodyStr);
    } catch {
      return res.status(400).json({ success: false, message: 'Invalid JSON payload' });
    }

    // 3. Acknowledge Kora immediately (must respond within seconds)
    res.status(200).json({ success: true });

    // 4. Extract reference — Kora puts it at data.reference
    const reference =
      payload?.data?.reference ||
      payload?.data?.payment_reference ||
      payload?.reference;

    if (!reference) {
      console.warn('[Kora Webhook] Missing reference in payload');
      return;
    }

    console.log(`[Kora Webhook] Event: ${payload.event} | Reference: ${reference}`);

    // 5. Determine final status
    if (koraService.isSuccessfulWebhook(payload)) {
      await completePayment({
        providerReference: reference,
        status: 'SUCCESS',
        payload,
        failureReason: null,
      });
    } else if (koraService.isFailedWebhook(payload)) {
      await completePayment({
        providerReference: reference,
        status: 'FAILED',
        payload,
        failureReason:
          payload?.data?.message ||
          payload?.data?.reason ||
          payload?.message ||
          'Payment failed',
      });
    } else {
      console.log(`[Kora Webhook] Intermediate event: ${payload.event} — no action`);
    }
  } catch (error) {
    console.error('[Kora Webhook] Unhandled error:', error.message);
    // Do not call next(error) — response already sent
  }
};

// ─── GET /api/payments/:paymentId/status ─────────────────────────────────────

const getStatus = async (req, res, next) => {
  try {
    const payment = await prisma.payment.findFirst({
      where: { id: req.params.paymentId, userId: req.user.id },
      include: { transaction: true },
    });

    if (!payment) {
      return res
        .status(404)
        .json({ success: false, message: 'Payment not found' });
    }

    // Optionally refresh from Kora if still processing
    if (payment.status === 'PROCESSING' || payment.status === 'PENDING') {
      try {
        const koraStatus = await koraService.checkPaymentStatus(
          payment.providerReference
        );
        if (koraStatus) {
          if (koraService.isSuccessfulWebhook(koraStatus)) {
            await completePayment({
              providerReference: payment.providerReference,
              status: 'SUCCESS',
              payload: koraStatus,
            });
          } else if (koraService.isFailedWebhook(koraStatus)) {
            await completePayment({
              providerReference: payment.providerReference,
              status: 'FAILED',
              payload: koraStatus,
              failureReason: koraStatus.message,
            });
          }
          // Re-fetch updated record
          const updated = await prisma.payment.findUnique({
            where: { id: payment.id },
            include: { transaction: true },
          });
          return res.status(200).json({ success: true, data: updated });
        }
      } catch (pollErr) {
        console.warn('[Status Poll] Kora status check failed:', pollErr.message);
        // Fall through and return cached DB status
      }
    }

    return res.status(200).json({ success: true, data: payment });
  } catch (error) {
    next(error);
  }
};

// ─── GET /api/payments/history ────────────────────────────────────────────────

const getHistory = async (req, res, next) => {
  try {
    const payments = await prisma.payment.findMany({
      where: { userId: req.user.id },
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: { transaction: true },
    });

    return res.status(200).json({ success: true, data: payments });
  } catch (error) {
    next(error);
  }
};

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  topup,
  koraWebhook,
  getStatus,
  getHistory,
};
