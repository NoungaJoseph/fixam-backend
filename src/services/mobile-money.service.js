/**
 * Kora Pay Mobile Money Service
 * All payment processing happens server-side — secret key never exposed to frontend.
 */
const axios = require('axios');
const crypto = require('crypto');

const KORA_MOBILE_MONEY_URL =
  process.env.KORA_MOBILE_MONEY_URL ||
  'https://api.korapay.com/merchant/api/v1/charges/mobile-money';

const KORA_PAYMENT_STATUS_BASE =
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
 * Returns E.164-ish string like "+237XXXXXXXX".
 */
const validatePhoneNumber = (phone) => {
  const digits = String(phone || '').replace(/\D/g, '');
  if (digits.length < 8 || digits.length > 15) {
    const err = new Error('Enter a valid mobile money phone number.');
    err.statusCode = 400;
    throw err;
  }
  const raw = String(phone || '').trim();
  return raw.startsWith('+') ? raw : `+${digits}`;
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
 * Kora signs with SHA-512 HMAC of the raw JSON body.
 * Returns true if valid or if webhook secret is not configured (dev mode).
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
 * Initiate a Kora mobile money collection request.
 * Called server-side only — KORA_SECRET_KEY never leaves the backend.
 *
 * @param {object} options
 * @param {string} options.provider   — 'MTN' | 'ORANGE'
 * @param {number} options.amount     — FCFA amount
 * @param {string} options.phone      — customer phone number
 * @param {string} options.reference  — unique payment reference
 * @param {object} options.user       — Prisma user object
 * @returns {object} result with providerReference, paymentMethod, phoneNumber, checkoutStatus
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
      phone: phoneNumber,
      provider: koraProvider,
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

/**
 * Query the status of an existing Kora charge.
 * @param {string} reference — Fixam payment reference
 */
const checkPaymentStatus = async (reference) => {
  const secretKey = process.env.KORA_SECRET_KEY;
  if (!secretKey) return null;

  const url = KORA_PAYMENT_STATUS_BASE.replace(':reference', reference);

  const response = await axios.get(url, {
    headers: {
      Authorization: `Bearer ${secretKey}`,
    },
    timeout: 15000,
  });

  return response.data?.data || null;
};

// ─── Exports ─────────────────────────────────────────────────────────────────

module.exports = {
  normalizeProvider,
  validatePhoneNumber,
  parseAmount,
  requestCollection,
  checkPaymentStatus,
  verifySignature,
  isSuccessfulWebhook,
  isFailedWebhook,
};
