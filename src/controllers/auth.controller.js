const prisma = require('../config/prisma');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const { sendOTP, sendWelcomeEmail, sendSuspiciousLoginAlert } = require('../services/email.service');
const { registerSchema } = require('../validators/auth.validator');
const twilio = require('twilio');
const { sendPushNotification } = require('../services/notification.service');

// Normalize phone number to E.164 format for Cameroon
const countryDialCodes = {
  'Cameroon': '237',
  'Kenya': '254',
  'Ghana': '233',
  'Ivory Coast': '225',
  'Tanzania': '255',
  'Egypt': '20',
  'Nigeria': '234'
};

const normalizePhoneWithCountry = (phone, country = 'Cameroon') => {
  const cleaned = phone.replace(/\D/g, '');
  const prefix = countryDialCodes[country] || '237';
  if (cleaned.startsWith(prefix)) {
    return cleaned;
  }
  return prefix + cleaned;
};

const formatPhone = (phone, country = 'Cameroon') => {
  const cleaned = phone.replace(/\s+/g, '').replace(/-/g, '').replace('+', '');
  const prefix = countryDialCodes[country] || '237';
  if (cleaned.startsWith(prefix)) {
    return '+' + cleaned;
  }
  return '+' + prefix + cleaned;
};

const sendSMSOTP = async (phoneNumber, otp, country = 'Cameroon') => {
  try {
    const twilioClient = twilio(
      process.env.TWILIO_ACCOUNT_SID,
      process.env.TWILIO_AUTH_TOKEN
    );
    const formattedPhone = formatPhone(phoneNumber, country);
    await twilioClient.messages.create({
      body: `Your Fixam verification code is: ${otp}. Valid for 10 minutes. Do not share this code.`,
      from: process.env.TWILIO_PHONE_NUMBER.trim(),
      to: formattedPhone
    });
    console.log(`[SMS] OTP sent to ${formattedPhone}`);
  } catch (error) {
    console.error(`Twilio Error: ${error.message} (Code: ${error.code})`);
    throw new Error('Failed to send OTP. Please try again.');
  }
};

const otpCache = new Map(); // Legacy fallback — see otpDb helpers below
const debugLog = (...args) => {
  if (process.env.NODE_ENV !== 'production') console.log(...args);
};

// ─── DB-backed OTP helpers (replaces in-memory otpCache) ────────────────────
// OTPs are hashed with bcrypt before storage so plaintext is never persisted.

const otpDb = {
  /** Store a new OTP (hashed). Replaces any existing record for this identifier+type */
  async set(identifier, otp, type, payload = null) {
    const otpHash = await bcrypt.hash(otp, 10);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes
    // Upsert: delete existing then create fresh so we don't accumulate stale rows
    await prisma.pendingVerification.deleteMany({ where: { identifier, type } });
    return prisma.pendingVerification.create({
      data: { identifier, otpHash, type, payload, expiresAt, attempts: 0 }
    });
  },

  /** Verify an OTP. Returns the record if valid, null if invalid/expired/locked. */
  async verify(identifier, otp, type) {
    const record = await prisma.pendingVerification.findFirst({
      where: { identifier, type, expiresAt: { gt: new Date() } }
    });
    if (!record) return null;
    // Lock after 5 failed attempts
    if (record.attempts >= 5) return null;
    const isMatch = await bcrypt.compare(otp, record.otpHash);
    if (!isMatch) {
      await prisma.pendingVerification.update({
        where: { id: record.id },
        data: { attempts: { increment: 1 } }
      });
      return null;
    }
    return record;
  },

  /** Delete all OTP records for this identifier+type after successful use */
  async delete(identifier, type) {
    return prisma.pendingVerification.deleteMany({ where: { identifier, type } });
  },

  /** Purge all expired records (call periodically) */
  async purgeExpired() {
    return prisma.pendingVerification.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  }
};

// Run cleanup every hour to avoid stale rows accumulating
setInterval(() => otpDb.purgeExpired().catch(() => {}), 60 * 60 * 1000);
// ─────────────────────────────────────────────────────────────────────────────

const generateToken = (id, role, tokenVersion = 0) => {
  return jwt.sign({ id, role, tokenVersion }, process.env.JWT_SECRET, { expiresIn: '7d' });
};

// Returns bilingual message based on the language parameter sent by the client
const getMsg = (lang, en, fr) => (lang === 'fr' ? fr : en);

const setTokenCookie = (res, token) => {
  res.cookie('jwt', token, {
    httpOnly: true,
    secure: true, // required for sameSite 'none'
    sameSite: 'none', // required for cross-origin requests from dashboard
    maxAge: 30 * 24 * 60 * 60 * 1000 // 30 days
  });
};

const register = async (req, res, next) => {
  try {
    debugLog('Registering user:', { email: req.body.email, phone: req.body.phone, role: req.body.role });
    let { fullName, email, phone, password, role, referralCode, referral, providerProfile, language, location, country } = req.body;
    referralCode = referralCode || referral;
    
    if (email) email = email.trim().toLowerCase();
    const selectedCountry = country || 'Cameroon';
    if (phone) phone = normalizePhoneWithCountry(phone, selectedCountry);
    const validation = registerSchema.safeParse({ fullName, email, phone, password, role });
    if (!validation.success) {
      return res.status(400).json({ success: false, message: 'Full name, valid email, valid phone number and password are required.' });
    }
    
    const existing = await prisma.user.findFirst({
      where: { OR: [{ email }, { phone }] }
    });

    if (existing) {
      debugLog('User already exists:', email, phone);
      return res.status(400).json({ success: false, message: 'User with this email or phone already exists' });
    }

    if (referralCode && referralCode.trim() !== '') {
      const validReferrer = await prisma.user.findFirst({
        where: { referralCode: referralCode.trim().toUpperCase() }
      });
      if (!validReferrer) {
        return res.status(400).json({ success: false, message: 'Invalid referral code provided.' });
      }
    }

    const generatedReferralCode = `FIXAM-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
    const hashedPassword = await bcrypt.hash(password, 10);

    let dob = null;
    if (providerProfile?.birthDay && providerProfile?.birthMonth && providerProfile?.birthYear) {
      const months = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
      dob = new Date(parseInt(providerProfile.birthYear), months[providerProfile.birthMonth] || 0, parseInt(providerProfile.birthDay));
    }

    const payload = {
      fullName,
      email,
      phone,
      password: hashedPassword,
      dob,
      role: role || 'CLIENT',
      referralCode: generatedReferralCode,
      language: language || 'en',
      providerProfile,
      originalReferral: referralCode,
      location,
      country: selectedCountry
    };

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    await otpDb.set(email, otp, 'registration', payload);
    await sendOTP(email, otp, language || 'en');

    debugLog('User registration payload cached, pending email verification for:', email);
    res.status(201).json({ success: true, requiresEmailVerification: true, email });
  } catch (error) {
    console.error('Registration error details:', error);
    next(error);
  }
};

const login = async (req, res, next) => {
  try {
    debugLog('Login attempt:', { email: req.body.email, phone: req.body.phone, country: req.body.country });
    let { email, phone, password, country } = req.body;
    
    if (email) email = email.trim().toLowerCase();
    if (phone) phone = normalizePhoneWithCountry(phone, country || 'Cameroon');
    
    const cleaned = phone ? phone.replace(/\D/g, '') : '';
    const user = await prisma.user.findFirst({
      where: email 
        ? { email } 
        : {
            OR: [
              { phone },
              { phone: cleaned },
              { phone: { endsWith: cleaned.slice(-8) } }
            ]
          },
      include: { wallet: true, providerProfile: true }
    });

    if (!user) {
      debugLog('User not found for:', email || phone);
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    if (user.isBlocked) {
      return res.status(403).json({ success: false, message: user.blockedReason || 'This account has been blocked.' });
    }

    if (!user.password) {
      debugLog('User has no password set (OTP only account):', user.id);
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    debugLog('Password match result:', isMatch);
    
    if (!isMatch) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    if (!user.isEmailVerified && user.email) {
      const otp = Math.floor(100000 + Math.random() * 900000).toString();
      await otpDb.set(user.email, otp, 'registration');
      await sendOTP(user.email, otp, user.preferredLanguage);
      return res.status(403).json({ success: false, requiresEmailVerification: true, email: user.email, message: 'Please verify your email to continue.' });
    }

    if (user.twoFactorEnabled) {
      const otp = Math.floor(100000 + Math.random() * 900000).toString();
      const hashedOTP = await bcrypt.hash(otp, 10);
      
      await prisma.user.update({
        where: { id: user.id },
        data: {
          twoFactorCode: hashedOTP,
          twoFactorExpiry: new Date(Date.now() + 10 * 60 * 1000)
        }
      });

      if (user.email) {
        await sendOTP(user.email, otp, user.preferredLanguage);
      } else {
        // SMS disabled: await sendSMSOTP(user.phone, otp);
      }

      const tempToken = jwt.sign({ id: user.id, role: user.role, type: '2fa' }, process.env.JWT_SECRET, { expiresIn: '10m' });
      return res.status(200).json({ success: true, requiresTwoFactor: true, tempToken });
    }

    const token = generateToken(user.id, user.role, user.tokenVersion ?? 0);

    // IP Tracking & Alert Logic
    const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    if (clientIp && user.lastIpAddress && user.lastIpAddress !== clientIp && user.email) {
      (async () => {
        try {
          const axios = require('axios');
          const ipToCheck = clientIp.split(',')[0].trim();
          // Only call geo-API for valid public IPv4 addresses (SSRF prevention)
          const isPublicIPv4 = /^(\d{1,3}\.){3}\d{1,3}$/.test(ipToCheck) &&
            !ipToCheck.startsWith('10.') &&
            !ipToCheck.startsWith('127.') &&
            !ipToCheck.startsWith('192.168.') &&
            !(/^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(ipToCheck));
          if (!isPublicIPv4) throw new Error('Private IP, skipping geo lookup');
          const geoRes = await axios.get(`https://ip-api.com/json/${ipToCheck}?fields=city,country,status`);
          const location = geoRes.data.status === 'success' ? `${geoRes.data.city}, ${geoRes.data.country}` : clientIp;
          
          await sendSuspiciousLoginAlert(user.email, {
            location,
            time: new Date().toLocaleString()
          }, user.preferredLanguage);
        } catch (err) {
          console.error('[LoginAlert] API/Geo failed:', err.message);
          sendSuspiciousLoginAlert(user.email, {
            location: clientIp,
            time: new Date().toLocaleString()
          }, user.preferredLanguage).catch(e => console.error('[LoginAlert] fallback failed:', e.message));
        }
      })();
    }

    if (clientIp && user.lastIpAddress !== clientIp) {
      await prisma.user.update({
        where: { id: user.id },
        data: { lastIpAddress: clientIp }
      });
    }

    setTokenCookie(res, token);
    // Strip sensitive internal fields before sending to client
    const { password: _pw, twoFactorCode: _tfc, twoFactorExpiry: _tfe, lastIpAddress: _lip, ...safeUser } = user;
    res.status(200).json({ success: true, token, user: safeUser });
  } catch (error) {
    console.error('Login error details:', error);
    next(error);
  }
};

const requestOTP = async (req, res, next) => {
  try {
    const { email, phone, language, country } = req.body;
    
    let formattedEmail = email ? email.trim().toLowerCase() : null;
    let formattedPhone = phone ? normalizePhoneWithCountry(phone, country || 'Cameroon') : null;
    const identifier = formattedEmail || formattedPhone;
    
    if (!identifier) {
      return res.status(400).json({ success: false, message: 'Email or phone is required' });
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString();

    // Preserve registration payload if this is a resend for pending registration
    const existingRecord = await prisma.pendingVerification.findFirst({
      where: { identifier, type: 'registration' }
    });
    const payload = existingRecord?.payload ?? null;
    await otpDb.set(identifier, otp, 'registration', payload);

    if (formattedEmail) {
      await sendOTP(formattedEmail, otp, language || 'en');
      return res.status(200).json({ success: true, message: 'OTP sent to email' });
    } else {
      await sendSMSOTP(formattedPhone, otp, country || 'Cameroon');
      return res.status(200).json({ success: true, message: 'OTP sent via SMS' });
    }
  } catch (error) {
    next(error);
  }
};

const verifyOTP = async (req, res, next) => {
  try {
    const { email, phone, otp, country } = req.body;
    const normalizedPhone = phone ? normalizePhoneWithCountry(phone, country || 'Cameroon') : null;
    const identifier = email || normalizedPhone;

    const isTestOTP = process.env.NODE_ENV !== 'production' &&
      otp === '123456' &&
      (email?.startsWith('test') || normalizedPhone?.startsWith('+23760000'));

    let record = null;
    if (!isTestOTP) {
      record = await otpDb.verify(identifier, otp, 'registration');
      if (!record) {
        return res.status(401).json({ success: false, message: 'Invalid or expired OTP. Too many wrong attempts will lock your account.' });
      }
      await otpDb.delete(identifier, 'registration');
    }

    let user = await prisma.user.findFirst({
      where: email
        ? { email }
        : {
            OR: [
              { phone: normalizedPhone },
              { phone: cleaned },
              { phone: { endsWith: cleaned.slice(-8) } }
            ]
          },
      include: { wallet: true, providerProfile: true }
    });

    // Use DB payload if found (DB-backed OTP path)
    const registrationPayload = record?.payload ?? null;

    if (!user && isTestOTP) {
      const testRole = (email?.includes('provider') || normalizedPhone?.endsWith('2')) ? 'PROVIDER' : 'CLIENT';
      const testPhone = normalizedPhone || `+23760000000${testRole === 'PROVIDER' ? '2' : '1'}`;
      const testEmail = email || `test${testRole.toLowerCase()}@fixam.app`;
      
      user = await prisma.user.create({
        data: {
          phone: testPhone,
          email: testEmail,
          fullName: `Test ${testRole === 'PROVIDER' ? 'Provider' : 'Client'}`,
          role: testRole,
          isEmailVerified: true,
          wallet: {
            create: {
              balance: 15000
            }
          },
          ...(testRole === 'PROVIDER' ? {
            providerProfile: {
              create: {
                skills: ['Plumbing', 'Electrical'],
                bio: 'Professional test service provider for Fixam App.',
                rate: 1500,
                rating: 5.0,
                verification: 'VERIFIED'
              }
            }
          } : {})
        },
        include: { wallet: true, providerProfile: true }
      });
    }

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found. Please register first.' });
    }

    if (user.isBlocked) {
      return res.status(403).json({ success: false, message: user.blockedReason || 'This account has been blocked.' });
    }

    const token = generateToken(user.id, user.role, user.tokenVersion ?? 0);
    setTokenCookie(res, token);
    // Strip sensitive internal fields before sending to client
    const { password: _pw2, twoFactorCode: _tfc2, twoFactorExpiry: _tfe2, lastIpAddress: _lip2, ...safeUser2 } = user;
    res.status(200).json({ success: true, token, user: safeUser2 });
  } catch (error) {
    next(error);
  }
};

const enableTwoFactorOTP = async (req, res, next) => {
  try {
    const user = req.user;
    const identifier = user.email || user.phone;
    
    if (!identifier) {
      return res.status(400).json({ success: false, message: 'Email or phone is required' });
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const hashedOTP = await bcrypt.hash(otp, 10);
    
    await prisma.user.update({
      where: { id: user.id },
      data: {
        twoFactorCode: hashedOTP,
        twoFactorExpiry: new Date(Date.now() + 10 * 60 * 1000)
      }
    });

    if (user.email) {
      await sendOTP(user.email, otp, user.preferredLanguage);
      return res.status(200).json({ success: true, message: 'OTP sent to your email' });
    } else {
      // SMS disabled
      return res.status(400).json({ success: false, message: 'No email found to send OTP' });
    }
  } catch (error) {
    next(error);
  }
};

const enableTwoFactor = async (req, res, next) => {
  try {
    const { otp } = req.body;
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    
    if (!user.twoFactorCode || !user.twoFactorExpiry || user.twoFactorExpiry < new Date()) {
      return res.status(400).json({ success: false, message: 'Invalid or expired OTP' });
    }

    const isMatch = await bcrypt.compare(otp, user.twoFactorCode);
    if (!isMatch) {
      return res.status(400).json({ success: false, message: 'Invalid or expired OTP' });
    }

    await prisma.user.update({
      where: { id: user.id },
      data: {
        twoFactorEnabled: true,
        twoFactorCode: null,
        twoFactorExpiry: null
      }
    });

    res.status(200).json({ success: true, message: 'Two-step verification enabled' });
  } catch (error) {
    next(error);
  }
};

const disableTwoFactor = async (req, res, next) => {
  try {
    const { password } = req.body;
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    
    const isMatch = await bcrypt.compare(password, user.password || '');
    if (!isMatch) {
      return res.status(401).json({ success: false, message: 'Incorrect password' });
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { twoFactorEnabled: false }
    });

    res.status(200).json({ success: true, message: 'Two-step verification disabled' });
  } catch (error) {
    next(error);
  }
};

const verifyLoginTwoFactor = async (req, res, next) => {
  try {
    const { tempToken, otp } = req.body;
    
    let decoded;
    try {
      decoded = jwt.verify(tempToken, process.env.JWT_SECRET);
      if (decoded.type !== '2fa') throw new Error('Invalid token type');
    } catch (err) {
      return res.status(401).json({ success: false, message: 'Invalid or expired token' });
    }

    const user = await prisma.user.findUnique({
      where: { id: decoded.id },
      include: { wallet: true, providerProfile: true }
    });

    if (!user || !user.twoFactorCode || !user.twoFactorExpiry || user.twoFactorExpiry < new Date()) {
      return res.status(401).json({ success: false, message: 'Invalid or expired OTP' });
    }

    const isMatch = await bcrypt.compare(otp, user.twoFactorCode);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: 'Invalid or expired OTP' });
    }

    await prisma.user.update({
      where: { id: user.id },
      data: {
        twoFactorCode: null,
        twoFactorExpiry: null
      }
    });

    const token = generateToken(user.id, user.role);
    setTokenCookie(res, token);
    res.status(200).json({ success: true, token, user });
  } catch (error) {
    next(error);
  }
};

const resendLoginOTP = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, message: 'No token provided' });
    }
    const tempToken = authHeader.split(' ')[1];
    
    let decoded;
    try {
      decoded = jwt.verify(tempToken, process.env.JWT_SECRET);
      if (decoded.type !== '2fa') throw new Error('Invalid token type');
    } catch (err) {
      return res.status(401).json({ success: false, message: 'Invalid or expired token' });
    }

    const user = await prisma.user.findUnique({ where: { id: decoded.id } });
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const hashedOTP = await bcrypt.hash(otp, 10);
    
    await prisma.user.update({
      where: { id: user.id },
      data: {
        twoFactorCode: hashedOTP,
        twoFactorExpiry: new Date(Date.now() + 10 * 60 * 1000)
      }
    });

    if (user.email) {
      await sendOTP(user.email, otp, user.preferredLanguage);
      return res.status(200).json({ success: true, message: 'OTP sent to your email' });
    } else {
      await sendSMSOTP(user.phone, otp);
      return res.status(200).json({ success: true, message: 'OTP sent to your phone' });
    }
  } catch (error) {
    next(error);
  }
};

const forgotPassword = async (req, res, next) => {
  try {
    const { email, language } = req.body;
    const lang = language || 'en';

    if (!email) {
      return res.status(400).json({
        success: false,
        message: getMsg(lang, 'Email is required', "L'adresse e-mail est requise"),
        errorCode: 'EMAIL_REQUIRED'
      });
    }
    
    const user = await prisma.user.findFirst({ where: { email: email.trim().toLowerCase() } });
    if (!user) {
      return res.status(404).json({
        success: false,
        message: getMsg(lang, 'No account found with this email address.', 'Aucun compte trouvé avec cette adresse e-mail.'),
        errorCode: 'USER_NOT_FOUND'
      });
    }

    if (user.isBlocked) {
      return res.status(403).json({
        success: false,
        message: user.blockedReason || getMsg(lang, 'This account has been suspended.', 'Ce compte a été suspendu.'),
        errorCode: 'ACCOUNT_BLOCKED'
      });
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    await otpDb.set(email.trim().toLowerCase(), otp, 'reset');

    sendOTP(email, otp, lang || user.preferredLanguage || 'en').catch(err => {
      console.error('[ForgotPassword] Email failed:', err.message);
    });

    return res.json({
      success: true,
      message: getMsg(lang,
        'A verification code has been sent to your email.',
        'Un code de vérification a été envoyé à votre adresse e-mail.'
      )
    });
  } catch (error) {
    console.error('[ForgotPassword] Error:', error.message);
    return res.status(500).json({
      success: false,
      message: getMsg(req.body?.language, 'Something went wrong. Please try again.', "Une erreur est survenue. Veuillez réessayer."),
      errorCode: 'SERVER_ERROR'
    });
  }
};

const verifyResetOtp = async (req, res, next) => {
  try {
    const { email, otp } = req.body;
    if (!email || !otp) {
      return res.status(400).json({ success: false, message: 'Email and OTP are required' });
    }

    const record = await otpDb.verify(email.trim().toLowerCase(), otp, 'reset');
    if (!record) {
      return res.status(401).json({ success: false, message: 'Invalid or expired OTP. Max 5 attempts allowed.' });
    }
    await otpDb.delete(email.trim().toLowerCase(), 'reset');

    const user = await prisma.user.findFirst({ where: { email: email.trim().toLowerCase() } });
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    // Generate a temporary token that allows password reset for 15 mins
    const resetToken = jwt.sign({ id: user.id, purpose: 'password_reset' }, process.env.JWT_SECRET, { expiresIn: '15m' });
    
    res.status(200).json({ success: true, resetToken });
  } catch (error) {
    next(error);
  }
};

const resetPassword = async (req, res, next) => {
  try {
    const { resetToken, newPassword } = req.body;
    
    if (!resetToken || !newPassword) {
      return res.status(400).json({ success: false, message: 'Reset token and new password are required' });
    }

    if (newPassword.length < 8) {
      return res.status(400).json({ success: false, message: 'New password must be at least 8 characters' });
    }

    let decoded;
    try {
      decoded = jwt.verify(resetToken, process.env.JWT_SECRET);
      if (decoded.purpose !== 'password_reset') throw new Error('Invalid token purpose');
    } catch (err) {
      return res.status(401).json({ success: false, message: 'Invalid or expired reset token' });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);

    await prisma.user.update({
      where: { id: decoded.id },
      data: {
        password: hashedPassword,
        lastPasswordChange: new Date()
      }
    });

    res.status(200).json({ success: true, message: 'Password has been successfully updated' });
  } catch (error) {
    next(error);
  }
};

const verifyEmailOTP = async (req, res, next) => {
  try {
    const { email, otp } = req.body;
    
    if (!email || !otp) {
      return res.status(400).json({ success: false, message: 'Email and OTP are required' });
    }

    const record = await otpDb.verify(email.trim().toLowerCase(), otp.trim(), 'registration');
    if (!record) {
      return res.status(401).json({ success: false, message: 'Invalid or expired OTP' });
    }

    const cached = record; // alias for readability below
    if (cached.type === 'registration' && cached.payload) {
      // Execute the database creation since OTP is valid
      const { fullName, email: plEmail, phone, password, dob, role, referralCode, language, providerProfile, originalReferral, location, country } = cached.payload;

      const { newUser, referrerReward } = await prisma.$transaction(async (tx) => {
        let referrerId = null;
        if (originalReferral) {
          const referrer = await tx.user.findFirst({
            where: { referralCode: originalReferral.trim().toUpperCase() }
          });
          if (referrer) referrerId = referrer.id;
        }

        const user = await tx.user.create({
          data: {
            fullName, email: plEmail, phone, password, dob, role, referralCode, location, country,
            referredBy: referrerId,
            preferredLanguage: language, isEmailVerified: true, welcomeCoinsGiven: true,
            isOnline: role === 'PROVIDER',
            wallet: { create: { balance: 1 } },
            ...(role === 'PROVIDER' ? {
              providerProfile: {
                create: {
                  skills: providerProfile?.skills || [],
                  bio: providerProfile?.bio || '',
                  rate: parseFloat(providerProfile?.rate) || 0,
                  serviceArea: providerProfile?.serviceArea || '',
                  experienceLevel: providerProfile?.experienceLevel || '',
                  availability: providerProfile?.availability || {},
                  birthDay: String(providerProfile?.birthDay || ''),
                  birthMonth: String(providerProfile?.birthMonth || ''),
                  birthYear: String(providerProfile?.birthYear || ''),
                  age: String(providerProfile?.age || '')
                }
              }
            } : {})
          },
          include: { wallet: true, providerProfile: true }
        });

        await tx.transaction.create({
          data: {
            walletId: user.wallet.id, amount: 1, type: 'PURCHASE', status: 'SUCCESS',
            description: 'Welcome bonus — thank you for joining Fixam!',
            reference: 'WELCOME_' + user.id + '_' + Date.now(),
            isSystemTransaction: true
          }
        });

        return { newUser: user, referrerReward: null };
      });

      await otpDb.delete(email.trim().toLowerCase(), 'registration');
      
      sendWelcomeEmail(newUser.email, newUser.fullName, newUser.preferredLanguage).catch(e => console.error('[WelcomeEmail] error:', e.message));

      sendPushNotification(
        newUser.id,
        'Welcome to Fixam!',
        'You received 1 free coin for joining Fixam!',
        { type: 'COINS_ADDED', coins: '1' }
      ).catch(() => {});

      const token = generateToken(newUser.id, newUser.role);
      setTokenCookie(res, token);
      return res.status(200).json({ success: true, message: 'Email verified and account created successfully', user: newUser, token });
    }

    // Handle standard verification
    await otpDb.delete(email.trim().toLowerCase(), 'registration');
    const user = await prisma.user.findUnique({
      where: { email: email.trim().toLowerCase() },
      include: { wallet: true, providerProfile: true }
    });

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { isEmailVerified: true }
    });

    const token = generateToken(user.id, user.role);
    setTokenCookie(res, token);
    res.status(200).json({ success: true, token, user });
  } catch (error) {
    next(error);
  }
};

const logout = async (req, res) => {
  // Increment tokenVersion to revoke all existing JWT tokens for this user
  if (req.user?.id) {
    try {
      await prisma.user.update({
        where: { id: req.user.id },
        data: { tokenVersion: { increment: 1 } }
      });
    } catch (e) {
      console.error('[Logout] Failed to revoke token version:', e.message);
    }
  }
  res.cookie('jwt', '', {
    httpOnly: true,
    expires: new Date(0),
    secure: true,
    sameSite: 'none'
  });
  res.status(200).json({ success: true, message: 'Logged out successfully' });
};

const me = async (req, res) => {
  try {
    const freshUser = await prisma.user.findUnique({
      where: { id: req.user.id },
      include: { wallet: true, providerProfile: true }
    });
    res.status(200).json({ success: true, user: freshUser || req.user });
  } catch (_) {
    res.status(200).json({ success: true, user: req.user });
  }
};

module.exports = {
  register,
  login,
  requestOTP,
  verifyOTP,
  enableTwoFactorOTP,
  enableTwoFactor,
  disableTwoFactor,
  verifyLoginTwoFactor,
  resendLoginOTP,
  forgotPassword,
  verifyResetOtp,
  resetPassword,
  verifyEmailOTP,
  logout,
  me
};
