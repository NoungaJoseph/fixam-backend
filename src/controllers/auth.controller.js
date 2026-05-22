const prisma = require('../config/prisma');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const { sendOTP } = require('../services/email.service');
const { registerSchema } = require('../validators/auth.validator');

const otpCache = new Map();

const generateToken = (id, role) => {
  return jwt.sign({ id, role }, process.env.JWT_SECRET, { expiresIn: '30d' });
};

const register = async (req, res, next) => {
  try {
    console.log('Registering user:', req.body);
    let { fullName, email, phone, password, role, referralCode, referral, providerProfile } = req.body;
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
      console.log('User already exists:', email, phone);
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
          wallet: { create: { balance: 0 } },
          ...(role === 'PROVIDER' ? { 
            providerProfile: { 
              create: {
                skills: providerProfile.skills || [],
                bio: providerProfile.bio || '',
                rate: parseFloat(providerProfile.rate) || 0,
                serviceArea: providerProfile.serviceArea || '',
                experienceLevel: providerProfile.experienceLevel || '',
                availability: providerProfile.availability || {},
                birthDay: String(providerProfile.birthDay || ''),
                birthMonth: String(providerProfile.birthMonth || ''),
                birthYear: String(providerProfile.birthYear || ''),
                age: String(providerProfile.age || '')
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

      return newUser;
    });

    const freshUser = await prisma.user.findUnique({
      where: { id: user.id },
      include: { wallet: true, providerProfile: true }
    });
    const token = generateToken(freshUser.id, freshUser.role);
    console.log('User registered successfully:', freshUser.id);
    res.status(201).json({ success: true, token, user: freshUser });
  } catch (error) {
    console.error('Registration error details:', error);
    next(error);
  }
};

const login = async (req, res, next) => {
  try {
    console.log('Login attempt:', req.body);
    let { email, phone, password } = req.body;
    
    if (email) email = email.trim().toLowerCase();
    if (phone) phone = phone.replace(/\D/g, '');
    
    const user = await prisma.user.findFirst({
      where: email ? { email } : { phone },
      include: { wallet: true, providerProfile: true }
    });

    if (!user) {
      console.log('User not found for:', email || phone);
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    if (user.isBlocked) {
      return res.status(403).json({ success: false, message: user.blockedReason || 'This account has been blocked.' });
    }

    if (!user.password) {
      console.log('User has no password set (OTP only account):', user.id);
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    console.log('Password match result:', isMatch);
    
    if (!isMatch) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    const token = generateToken(user.id, user.role);
    res.status(200).json({ success: true, token, user });
  } catch (error) {
    console.error('Login error details:', error);
    next(error);
  }
};

const requestOTP = async (req, res, next) => {
  try {
    const { email, phone } = req.body;
    const identifier = email || phone;
    
    if (!identifier) {
      return res.status(400).json({ success: false, message: 'Email or phone is required' });
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    otpCache.set(identifier, { otp, expires: Date.now() + 600000 });

    if (email) {
      await sendOTP(email, otp);
      return res.status(200).json({ success: true, message: 'OTP sent to email' });
    } else {
      console.log(`[SMS MOCK] OTP generated for ${phone}`);
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

module.exports = {
  register,
  login,
  requestOTP,
  verifyOTP
};
