const prisma = require('../config/prisma');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const { sendOTP, sendWelcomeEmail, sendSuspiciousLoginAlert } = require('../services/email.service');
const { registerSchema } = require('../validators/auth.validator');
const twilio = require('twilio');
const { sendPushNotification } = require('../services/notification.service');

// Normalize phone number to E.164 format for Cameroon
const formatPhone = (phone) => {
  const cleaned = phone.replace(/\s+/g, '').replace(/-/g, '');
  if (cleaned.startsWith('+')) return cleaned;
  if (cleaned.startsWith('00')) return '+' + cleaned.slice(2);
  if (cleaned.startsWith('237')) return '+' + cleaned;
  return '+237' + cleaned;
};

const sendSMSOTP = async (phoneNumber, otp) => {
  try {
    const twilioClient = twilio(
      process.env.TWILIO_ACCOUNT_SID,
      process.env.TWILIO_AUTH_TOKEN
    );
    const formattedPhone = formatPhone(phoneNumber);
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

const otpCache = new Map();
const debugLog = (...args) => {
  if (process.env.NODE_ENV !== 'production') console.log(...args);
};

const generateToken = (id, role) => {
  return jwt.sign({ id, role }, process.env.JWT_SECRET, { expiresIn: '30d' });
};

const register = async (req, res, next) => {
  try {
    debugLog('Registering user:', { email: req.body.email, phone: req.body.phone, role: req.body.role });
    let { fullName, email, phone, password, role, referralCode, referral, providerProfile, language } = req.body;
    referralCode = referralCode || referral;
    
    if (email) email = email.trim().toLowerCase();
    if (phone) phone = phone.replace(/\D/g, '');
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

    const generatedReferralCode = `FIXAM-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
    const hashedPassword = await bcrypt.hash(password, 10);

    // Prepare Date of Birth
    let dob = null;
    if (providerProfile?.birthDay && providerProfile?.birthMonth && providerProfile?.birthYear) {
      const months = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
      dob = new Date(parseInt(providerProfile.birthYear), months[providerProfile.birthMonth] || 0, parseInt(providerProfile.birthDay));
    }

    const user = await prisma.$transaction(async (tx) => {
      const newUser = await tx.user.create({
        data: {
          fullName,
          email,
          phone,
          password: hashedPassword,
          dob,
          role: role || 'CLIENT',
          referralCode: generatedReferralCode,
          preferredLanguage: language || 'en',
          wallet: { create: { balance: 0 } },
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

      if (referralCode) {
        const referrer = await tx.user.findFirst({
           where: { referralCode: referralCode.trim().toUpperCase() },
           include: { wallet: true }
        });

        if (referrer && referrer.id !== newUser.id) {
          await tx.wallet.update({
            where: { userId: referrer.id },
            data: { balance: { increment: 1 } }
          });
          await tx.wallet.update({
            where: { userId: newUser.id },
            data: { balance: { increment: 3 } }
          });
          await tx.transaction.createMany({
            data: [
              {
                walletId: referrer.wallet.id,
                amount: 1,
                type: 'REFUND',
                status: 'SUCCESS',
                description: `Referral bonus for inviting ${fullName || phone}`
              },
              {
                walletId: newUser.wallet.id,
                amount: 3,
                type: 'REFUND',
                status: 'SUCCESS',
                description: 'Welcome referral bonus'
              }
            ]
          });
          await tx.notification.create({
            data: {
              userId: referrer.id,
              title: 'Referral bonus earned',
              body: 'You earned 1 coin because someone joined with your referral code.',
              data: { type: 'TRANSACTION', status: 'SUCCESS' }
            }
          });
        }
      }

      // --- Welcome coins logic will run after transaction ---

      return newUser;
    });

    // Welcome coins logic removed from here, moved to verifyEmailOTP

    const freshUser = await prisma.user.findUnique({
      where: { id: user.id },
      include: { wallet: true, providerProfile: true }
    });

    if (freshUser.email) {
      sendWelcomeEmail(freshUser.email, freshUser.fullName, freshUser.preferredLanguage).catch(e => console.error('[WelcomeEmail] error:', e.message));
      
      const otp = Math.floor(100000 + Math.random() * 900000).toString();
      otpCache.set(freshUser.email, { otp, expires: Date.now() + 600000, type: 'registration' });
      await sendOTP(freshUser.email, otp, freshUser.preferredLanguage);
    }

    debugLog('User registered successfully, pending email verification:', freshUser.id);
    res.status(201).json({ success: true, requiresEmailVerification: true, email: freshUser.email, user: freshUser });
  } catch (error) {
    console.error('Registration error details:', error);
    next(error);
  }
};

const login = async (req, res, next) => {
  try {
    debugLog('Login attempt:', { email: req.body.email, phone: req.body.phone });
    let { email, phone, password } = req.body;
    
    if (email) email = email.trim().toLowerCase();
    if (phone) phone = phone.replace(/\D/g, '');
    
    const user = await prisma.user.findFirst({
      where: email ? { email } : { phone },
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

    if (!user.isEmailVerified && user.email) {
      const otp = Math.floor(100000 + Math.random() * 900000).toString();
      otpCache.set(user.email, { otp, expires: Date.now() + 600000, type: 'registration' });
      await sendOTP(user.email, otp, user.preferredLanguage);
      return res.status(403).json({ success: false, requiresEmailVerification: true, email: user.email, message: 'Please verify your email to continue.' });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    debugLog('Password match result:', isMatch);
    
    if (!isMatch) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
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

    const token = generateToken(user.id, user.role);

    // IP Tracking & Alert Logic
    const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    if (clientIp && user.lastIpAddress && user.lastIpAddress !== clientIp && user.email) {
      sendSuspiciousLoginAlert(user.email, {
        ip: clientIp,
        time: new Date().toLocaleString()
      }, user.preferredLanguage).catch(err => console.error('[LoginAlert] failed:', err.message));
    }

    if (clientIp && user.lastIpAddress !== clientIp) {
      await prisma.user.update({
        where: { id: user.id },
        data: { lastIpAddress: clientIp }
      });
    }

    res.status(200).json({ success: true, token, user });
  } catch (error) {
    console.error('Login error details:', error);
    next(error);
  }
};

const requestOTP = async (req, res, next) => {
  try {
    const { email, phone, language } = req.body;
    const identifier = email || phone;
    
    if (!identifier) {
      return res.status(400).json({ success: false, message: 'Email or phone is required' });
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    otpCache.set(identifier, { otp, expires: Date.now() + 600000, language: language || 'en' });

    if (email) {
      await sendOTP(email, otp, language || 'en');
      return res.status(200).json({ success: true, message: 'OTP sent to email' });
    } else {
      await sendSMSOTP(phone, otp);
      return res.status(200).json({ success: true, message: 'OTP sent via SMS' });
    }
  } catch (error) {
    next(error);
  }
};

const verifyOTP = async (req, res, next) => {
  try {
    const { email, phone, otp } = req.body;
    const identifier = email || phone;
    
    const cached = otpCache.get(identifier);
    if (!cached || cached.otp !== otp || Date.now() > cached.expires) {
      return res.status(401).json({ success: false, message: 'Invalid or expired OTP' });
    }

    otpCache.delete(identifier);

    const user = await prisma.user.findFirst({
      where: email ? { email } : { phone },
      include: { wallet: true, providerProfile: true }
    });

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found. Please register first.' });
    }

    if (user.isBlocked) {
      return res.status(403).json({ success: false, message: user.blockedReason || 'This account has been blocked.' });
    }

    const token = generateToken(user.id, user.role);
    res.status(200).json({ success: true, token, user });
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
    if (!email) {
      return res.status(400).json({ success: false, message: 'Email is required' });
    }
    
    const user = await prisma.user.findFirst({ where: { email: email.trim().toLowerCase() } });
    if (!user) {
      return res.status(200).json({ success: true, message: 'If an account exists, an OTP has been sent to that email' });
    }

    if (user.isBlocked) {
      return res.status(403).json({ success: false, message: user.blockedReason || 'This account has been blocked.' });
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    otpCache.set(email, { otp, expires: Date.now() + 600000 });

    sendOTP(email, otp, language || user.preferredLanguage || 'en').catch(err => {
      console.error('[ForgotPassword] Email failed:', err.message);
    });

    return res.json({
      success: true,
      message: 'If an account exists with this information, you will receive a reset code shortly.'
    });
  } catch (error) {
    console.error('[ForgotPassword] Error:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Something went wrong. Please try again.'
    });
  }
};

const verifyResetOtp = async (req, res, next) => {
  try {
    const { email, otp } = req.body;
    if (!email || !otp) {
      return res.status(400).json({ success: false, message: 'Email and OTP are required' });
    }

    const cached = otpCache.get(email);
    if (!cached || cached.otp !== otp || Date.now() > cached.expires) {
      return res.status(401).json({ success: false, message: 'Invalid or expired OTP' });
    }

    // Delete OTP after successful verification
    otpCache.delete(email);

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

    const cached = otpCache.get(email);
    if (!cached || cached.otp !== otp || Date.now() > cached.expires) {
      return res.status(401).json({ success: false, message: 'Invalid or expired OTP' });
    }

    otpCache.delete(email);

    const user = await prisma.user.findUnique({
      where: { email },
      include: { wallet: true, providerProfile: true }
    });

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { isEmailVerified: true }
    });

    // Give welcome coins upon successful email verification
    try {
      const freshWallet = await prisma.wallet.findUnique({ where: { userId: user.id } });
      if (freshWallet && !user.welcomeCoinsGiven) {
        await prisma.wallet.update({
          where: { id: freshWallet.id },
          data: { balance: { increment: 1 } }
        });
        await prisma.transaction.create({
          data: {
            walletId: freshWallet.id,
            amount: 1,
            type: 'PURCHASE',
            status: 'SUCCESS',
            description: 'Welcome bonus — thank you for joining Fixam!',
            reference: 'WELCOME_' + user.id + '_' + Date.now()
          }
        });
        await prisma.user.update({
          where: { id: user.id },
          data: { welcomeCoinsGiven: true }
        });
        sendPushNotification(
          user.id,
          '🎉 Welcome to Fixam!',
          'You received 1 free coin for joining Fixam!',
          { type: 'COINS_ADDED', coins: '1' }
        ).catch(() => {});
      }
    } catch (welcomeErr) {
      console.error('[Welcome Coins] Error (non-fatal):', welcomeErr.message);
    }

    const updatedUser = await prisma.user.findUnique({
      where: { email },
      include: { wallet: true, providerProfile: true }
    });

    const token = generateToken(updatedUser.id, updatedUser.role);
    res.status(200).json({ success: true, token, user: updatedUser });
  } catch (error) {
    next(error);
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
  verifyEmailOTP
};
