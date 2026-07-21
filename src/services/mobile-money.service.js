const axios = require('axios')
const crypto = require('crypto')
const { v4: uuidv4 } = require('uuid')

const KORA_MOBILE_MONEY_URL =
  process.env.KORA_MOBILE_MONEY_URL ||
  'https://api.korapay.com/merchant/api/v1/charges/mobile-money';

const KORA_PAYMENT_STATUS_URL =
  process.env.KORA_PAYMENT_STATUS_URL ||
  'https://api.korapay.com/merchant/api/v1/charges/:reference';

// Map Fixam internal provider keys → Kora provider strings
const PROVIDER_MAP = {
  MTN: 'mtn',
  ORANGE: 'orange',
};

const PAYMENT_METHOD_MAP = {
  MTN: 'MTN_MOMO',
  ORANGE: 'ORANGE_MONEY',
};

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Normalise frontend provider string to internal key (MTN | ORANGE).
 * Returns null for unknown providers.
 */
const normalizeProvider = (provider) => {
  const v = String(provider || '').trim().toUpperCase();
  if (['MTN', 'MTN_MOMO', 'MOMO', 'MTN MOMO'].includes(v)) return 'MTN';
  if (['ORANGE', 'ORANGE_MONEY', 'OM', 'ORANGE MONEY'].includes(v)) return 'ORANGE';
  return null;
};

/**
 * Validate and normalise a phone number.
 * Returns string like "237XXXXXXXX".
 */
const validatePhoneNumber = (phone) => {
  const formattedPhone = String(phone || '').replace(/\s+/g, '')
    .replace(/-/g, '').replace('+', '');

  const prefixes = ['237', '254', '233', '225', '255', '20', '234'];
  const hasPrefix = prefixes.some(p => formattedPhone.startsWith(p));
  const phoneNumber = hasPrefix ? formattedPhone : '237' + formattedPhone;

  if (!phoneNumber || !/^\d{8,15}$/.test(phoneNumber)) {
    const err = new Error('Enter a valid mobile money phone number.');
    err.statusCode = 400;
    throw err;
  }
  return phoneNumber;
};

/**
 * Parse FCFA amount — must be ≥ 100.
 */
const parseAmount = (value) => {
  const amount = Number(String(value || '').replace(/[^\d]/g, ''));
  if (!Number.isFinite(amount) || amount < 100) {
    const err = new Error('A valid FCFA amount is required (minimum 100 FCFA).');
    err.statusCode = 400;
    throw err;
  }
  return amount;
};

/**
 * Verify Kora webhook HMAC-SHA512 signature.
 */
const verifySignature = (rawBody, signature) => {
  const secret = process.env.KORA_WEBHOOK_SECRET;
  if (!secret) {
    console.warn('[Kora] KORA_WEBHOOK_SECRET not set — skipping signature check (dev mode)');
    return true;
  }
  if (!signature) return false;

  const bodyStr = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : String(rawBody);
  const expected = crypto
    .createHmac('sha512', secret)
    .update(bodyStr)
    .digest('hex');

  try {
    return crypto.timingSafeEqual(
      Buffer.from(expected, 'hex'),
      Buffer.from(signature, 'hex')
    );
  } catch {
    return false;
  }
};

/**
 * Determine if a Kora webhook payload signals payment success.
 */
const isSuccessfulWebhook = (payload) => {
  const event = String(payload?.event || '').toLowerCase();
  const status = String(
    payload?.data?.status || payload?.status || ''
  ).toLowerCase();
  return (
    event === 'charge.success' ||
    ['success', 'successful', 'completed', 'paid'].includes(status)
  );
};

/**
 * Determine if a Kora webhook payload signals payment failure.
 */
const isFailedWebhook = (payload) => {
  const event = String(payload?.event || '').toLowerCase();
  const status = String(
    payload?.data?.status || payload?.status || ''
  ).toLowerCase();
  return (
    event === 'charge.failed' ||
    ['failed', 'cancelled', 'canceled', 'expired', 'rejected'].includes(status)
  );
};

// ─── Core API Calls ──────────────────────────────────────────────────────────

/**
 * Initiate a Kora mobile money collection request (for wallet.controller).
 */
const requestCollection = async ({ provider, amount, phone, reference, user }) => {
  const providerKey = normalizeProvider(provider);
  if (!providerKey) {
    const err = new Error('Choose MTN Mobile Money or Orange Money.');
    err.statusCode = 400;
    throw err;
  }

  const secretKey = process.env.KORA_SECRET_KEY;
  if (!secretKey) {
    const err = new Error('Payment gateway is not configured. Please contact support.');
    err.statusCode = 503;
    throw err;
  }

  const phoneNumber = validatePhoneNumber(phone);
  const koraProvider = PROVIDER_MAP[providerKey];

  const payload = {
    reference,
    amount,
    currency: 'XAF',
    customer: {
      name: user?.fullName || user?.phone || 'Customer',
      email: user?.email || `${reference.toLowerCase()}@fixam.app`,
    },
    mobile_money: {
      number: phoneNumber,
    },
  };

  console.log(`[Kora] Initiating ${koraProvider} collection: ${reference} — ${amount} XAF`);

  const response = await axios.post(KORA_MOBILE_MONEY_URL, payload, {
    headers: {
      Authorization: `Bearer ${secretKey}`,
      'Content-Type': 'application/json',
    },
    timeout: 25000,
  });

  const koraData = response.data?.data || {};

  console.log(`[Kora] Collection initiated: ${reference}`, koraData.status);

  return {
    providerKey,
    paymentMethod: PAYMENT_METHOD_MAP[providerKey],
    phoneNumber,
    providerReference: reference,
    koraReference: koraData.payment_reference || koraData.reference || reference,
    checkoutStatus: koraData.status || 'pending',
    checkoutUrl: koraData.checkout_url || null,
    rawResponse: koraData,
  };
};

async function requestToPayWithKora({
  amount,
  currency = 'XAF',
  description,
  redirectUrl,
  notificationUrl,
  name = 'Fixam User',
  email,
  phone,
  provider
}) {
  // Validate required fields manually
  if (!amount || Number(amount) <= 0) {
    return { error: ['Amount must be positive'] }
  }
  
  if (!phone || !/^\d{8,15}$/.test(phone)) {
    return { 
      error: ['Phone must be 8-15 digits with country code. Example: 237682803006'] 
    }
  }
  
  if (!description || description.trim().length === 0) {
    return { error: ['Description is required'] }
  }
  
  if (!redirectUrl || !notificationUrl) {
    return { error: ['Redirect and notification URLs are required'] }
  }

  const transactionId = uuidv4()

  const structuredPayload = {
    reference: transactionId,
    amount: Number(amount),
    currency: currency || 'XAF',
    customer: {
      name: name || 'Fixam User',
      email: email || `${transactionId.toLowerCase()}@fixam.app`
    },
    mobile_money: {
      number: phone
    }
  }

  try {
    console.log('[Kora] Initiating payment:', {
      reference: transactionId,
      amount: Number(amount),
      currency: currency || 'XAF',
      phone: phone
    })

    const koraRequest = await axios.post(
      process.env.KORA_MOBILE_MONEY_URL,
      structuredPayload,
      {
        headers: {
          'Authorization': `Bearer ${process.env.KORA_SECRET_KEY}`,
          'Content-Type': 'application/json'
        },
        timeout: 30000
      }
    )

    const response = koraRequest.data
    console.log('[Kora] Payment initiated successfully:', transactionId)

    return {
      response: response.data,
      reference: transactionId,
      redirectUrl,
      notificationUrl
    }

  } catch (error) {
    console.error('[Kora] Payment initiation failed:')
    console.error('[Kora] Status:', error.response?.status)
    console.error('[Kora] Error data:', 
      JSON.stringify(error.response?.data, null, 2))
    console.error('[Kora] Message:', error.message)
    
    return {
      error: [
        error.response?.data?.message || 
        error.message || 
        'Payment initiation failed'
      ],
      koraError: error.response?.data
    }
  }
}

async function getPaymentStatusFromKora(transactionRef) {
  try {
    const url = process.env.KORA_PAYMENT_STATUS_URL
      ?.replace(':reference', transactionRef)

    console.log('[Kora] Checking status for:', transactionRef)

    const response = await axios.get(url, {
      headers: {
        'Authorization': `Bearer ${process.env.KORA_SECRET_KEY}`
      },
      timeout: 15000
    })

    const result = response.data
    console.log('[Kora] Status result:', {
      reference: transactionRef,
      status: result.data?.status
    })

    return {
      data: {
        status: result.data.status,
        transId: result.data.reference,
        reason: result.message
      }
    }

  } catch (error) {
    console.error('[Kora] Status check failed:', error.message)
    console.error('[Kora] Status error data:', 
      error.response?.data)
    
    return {
      data: {
        status: 'failed',
        transId: transactionRef,
        reason: error.response?.data?.message || 
          'Status check failed'
      }
    }
  }
}

module.exports = {
  requestToPayWithKora,
  getPaymentStatusFromKora,
  normalizeProvider,
  validatePhoneNumber,
  parseAmount,
  requestCollection,
  checkPaymentStatus: getPaymentStatusFromKora,
  verifySignature,
  isSuccessfulWebhook,
  isFailedWebhook,
}
