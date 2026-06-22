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
    let { fullName, email, phone, password, role, referralCode, referral, providerProfile, language, location } = req.body;
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

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    
    // Cache the entire registration payload
    const payload = {
      fullName, email, phone, password: hashedPassword, dob, role: role || 'CLIENT', location: location || '',
      referralCode: generatedReferralCode, language: language || 'en', providerProfile,
      originalReferral: referralCode
    };

    otpCache.set(email, { otp, expires: Date.now() + 600000, type: 'registration', payload });
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

    const isMatch = await bcrypt.compare(password, user.password);
    debugLog('Password match result:', isMatch);
    
    if (!isMatch) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    if (!user.isEmailVerified && user.email) {
      const otp = Math.floor(100000 + Math.random() * 900000).toString();
      otpCache.set(user.email, { otp, expires: Date.now() + 600000, type: 'registration' });
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

    const token = generateToken(user.id, user.role);

    // IP Tracking & Alert Logic
    const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    if (clientIp && user.lastIpAddress && user.lastIpAddress !== clientIp && user.email) {
      (async () => {
        try {
          const axios = require('axios');
          const ipToCheck = clientIp.split(',')[0].trim();
          // We can fetch IP location if valid. Avoid local IPs or IPv6 if the free API doesn't support them well.
          const geoRes = await axios.get(`http://ip-api.com/json/${ipToCheck}?fields=city,country,status`);
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

    res.status(200).json({ success: true, token, user });
  } catch (error) {
    console.error('Login error details:', error);
    next(error);
  }
};

const requestOTP = async (req, res, next) => {
  try {
    const { email, phone, language } = req.body;
    
    let identifier;
    let formattedEmail = email ? email.trim().toLowerCase() : null;
    let formattedPhone = phone ? phone.replace(/\D/g, '') : null;
    identifier = formattedEmail || formattedPhone;
    
    if (!identifier) {
      return res.status(400).json({ success: false, message: 'Email or phone is required' });
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const existingCache = otpCache.get(identifier);
    
    let cachePayload = { otp, expires: Date.now() + 600000, language: language || 'en' };
    if (existingCache && existingCache.type === 'registration') {
      cachePayload = { ...existingCache, otp, expires: Date.now() + 600000 };
    }

    otpCache.set(identifier, cachePayload);

    if (formattedEmail) {
      await sendOTP(formattedEmail, otp, language || 'en');
      return res.status(200).json({ success: true, message: 'OTP sent to email' });
    } else {
      await sendSMSOTP(formattedPhone, otp);
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
      return res.status(404).json({ success: false, message: 'User not found' });
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

    const cached = otpCache.get(email.trim().toLowerCase());
    if (!cached || cached.otp !== otp.trim() || Date.now() > cached.expires) {
      return res.status(401).json({ success: false, message: 'Invalid or expired OTP' });
    }

    if (cached.type === 'registration' && cached.payload) {
      // Execute the database creation since OTP is valid
      const { fullName, email: plEmail, phone, password, dob, role, referralCode, language, providerProfile, originalReferral, location } = cached.payload;

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
            fullName, email: plEmail, phone, password, dob, role, referralCode, location,
            referredBy: referrerId,
            preferredLanguage: language, isEmailVerified: true, welcomeCoinsGiven: true,
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

        if (referrerId) {
          const alreadyRewarded = await tx.transaction.findFirst({
            where: {
              description: {
                contains: `Referral: ${user.id}`
              }
            }
          });

          if (alreadyRewarded || referrerId === user.id) {
            return { newUser: user, referrerReward: null };
          }

          let referrerWallet = await tx.wallet.findUnique({
            where: { userId: referrerId }
          });

          if (!referrerWallet) {
            referrerWallet = await tx.wallet.create({
              data: { userId: referrerId, balance: 0 }
            });
          }

          const updatedUserWallet = await tx.wallet.update({
            where: { id: user.wallet.id },
            data: { balance: { increment: 1 } }
          });

          const updatedUser = { ...user, wallet: updatedUserWallet };

          await tx.transaction.create({
            data: {
              walletId: user.wallet.id,
              amount: 1,
              type: 'PURCHASE',
              status: 'SUCCESS',
              description: `Referral signup bonus for using ${originalReferral.trim().toUpperCase()}`,
              reference: 'REFERRAL_SIGNUP_' + user.id + '_' + Date.now(),
              isSystemTransaction: true
            }
          });

          await tx.wallet.update({
            where: { id: referrerWallet.id },
            data: { balance: { increment: 1 } }
          });
            
          await tx.transaction.create({
            data: {
              walletId: referrerWallet.id, amount: 1, type: 'PURCHASE', status: 'SUCCESS',
              description: `Referral: ${user.id} - ${user.fullName || 'New user'} joined using your code`,
              isSystemTransaction: true
            }
          });
            
          await tx.notification.create({
            data: {
              userId: referrerId, title: 'Referral bonus earned',
              body: `${user.fullName || 'Someone'} joined Fixam using your referral code. You earned 1 coin!`,
              data: { type: 'COINS_ADDED', coins: '1', referredUserId: user.id }
            }
          });

          return {
            newUser: updatedUser,
            referrerReward: {
              userId: referrerId,
              referredUserName: user.fullName || 'Someone'
            }
          };
        }
        return { newUser: user, referrerReward: null };
      });

      otpCache.delete(email.trim().toLowerCase());
      
      sendWelcomeEmail(newUser.email, newUser.fullName, newUser.preferredLanguage).catch(e => console.error('[WelcomeEmail] error:', e.message));

      sendPushNotification(
        newUser.id,
        'Welcome to Fixam!',
        referrerReward ? 'You received 2 coins: 1 welcome coin and 1 referral coin.' : 'You received 1 free coin for joining Fixam!',
        { type: 'COINS_ADDED', coins: referrerReward ? '2' : '1' }
      ).catch(() => {});

      if (referrerReward) {
        sendPushNotification(
          referrerReward.userId,
          'Referral Reward!',
          `${referrerReward.referredUserName} joined Fixam using your referral code. You earned 1 coin!`,
          { type: 'COINS_ADDED', coins: '1' }
        ).catch(() => {});
      }

      const token = generateToken(newUser.id, newUser.role);
      return res.status(200).json({ success: true, message: 'Email verified and account created successfully', user: newUser, token });
    }

    // Handle standard verification
    otpCache.delete(email.trim().toLowerCase());
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
    res.status(200).json({ success: true, token, user });
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
