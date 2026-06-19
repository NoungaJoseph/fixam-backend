const prisma = require('../config/prisma');
const { updateProfileSchema } = require('../validators/user.validator');
const bcrypt = require('bcrypt');
const { calculateProviderStats } = require('../utils/providerStats');

const getMe = async (req, res, next) => {
  try {
    if (req.user.providerProfile?.id) {
      const providerId = req.user.providerProfile.id;
      
      // Run heavy background recalculation asynchronously - DO NOT await to keep /me instantly fast
      calculateProviderStats(providerId).catch(err => console.error('Stats calc error:', err));
    }
    res.status(200).json({ success: true, data: req.user });
  } catch (error) {
    next(error);
  }
};

const updateProfile = async (req, res, next) => {
  try {
    const validatedData = updateProfileSchema.parse(req.body);
    const { bio, skills, rate, serviceArea, experienceLevel, portfolio, certificates, employmentHistory, socialLinks, profileMode, fullName, password, currentPassword, dob, location, ...userData } = validatedData;
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const updateData = { ...userData };
    if (location !== undefined) updateData.location = location;

    // Handle Full Name Change (once a month, goes to pending)
    if (fullName && fullName !== req.user.fullName) {
      if (req.user.lastNameChange && req.user.lastNameChange > thirtyDaysAgo) {
        return res.status(400).json({ 
          success: false, 
          message: 'You can only change your name once every 30 days.' 
        });
      }
      updateData.pendingName = fullName;
      updateData.lastNameChange = now;
      // Note: In a real app, an admin would then approve the pendingName
    }

    // Handle Password Change (once a month)
    if (password) {
      if (!currentPassword) {
        return res.status(400).json({ success: false, message: 'Current password is required.' });
      }
      const isCurrentPasswordValid = await bcrypt.compare(currentPassword, req.user.password || '');
      if (!isCurrentPasswordValid) {
        return res.status(401).json({ success: false, message: 'Current password is incorrect.' });
      }
      if (req.user.lastPasswordChange && req.user.lastPasswordChange > thirtyDaysAgo) {
        return res.status(400).json({ 
          success: false, 
          message: 'You can only change your password once every 30 days.' 
        });
      }
      updateData.password = await bcrypt.hash(password, 10);
      updateData.lastPasswordChange = now;
    }

    // Handle Date of Birth
    if (dob) {
      updateData.dob = new Date(dob);
    }

    const providerUpdates = { bio, skills, rate, serviceArea, experienceLevel, portfolio, certificates, employmentHistory, socialLinks, profileMode };
    const hasProviderUpdates = Object.values(providerUpdates).some((value) => value !== undefined);
    const profileScore = hasProviderUpdates
      ? [
          bio ?? req.user.providerProfile?.bio,
          (skills ?? req.user.providerProfile?.skills)?.length,
          rate ?? req.user.providerProfile?.rate,
          serviceArea ?? req.user.providerProfile?.serviceArea,
          experienceLevel ?? req.user.providerProfile?.experienceLevel,
          (portfolio ?? req.user.providerProfile?.portfolio)?.length,
          (certificates ?? req.user.providerProfile?.certificates)?.length,
          (employmentHistory ?? req.user.providerProfile?.employmentHistory)?.length,
          socialLinks ?? req.user.providerProfile?.socialLinks
        ].reduce((acc, value) => acc + (value ? 1 : 0), 0)
      : undefined;

    if (profileMode === 'WORK' && req.user.role !== 'PROVIDER') {
      updateData.role = 'PROVIDER';
    }

    const user = await prisma.user.update({
      where: { id: req.user.id },
      data: {
        ...updateData,
        ...(hasProviderUpdates ? {
          providerProfile: {
            upsert: {
              create: {
                bio: bio || '',
                skills: skills || [],
                rate: rate || 0,
                serviceArea: serviceArea || '',
                experienceLevel: experienceLevel || '',
                portfolio: portfolio || [],
                certificates: certificates || [],
                employmentHistory: employmentHistory || [],
                socialLinks: socialLinks || {},
                profileMode: profileMode || 'WORK',
                profileScore: profileScore || 0
              },
              update: {
                ...(bio !== undefined && { bio }),
                ...(skills !== undefined && { skills }),
                ...(rate !== undefined && { rate }),
                ...(serviceArea !== undefined && { serviceArea }),
                ...(experienceLevel !== undefined && { experienceLevel }),
                ...(portfolio !== undefined && { portfolio }),
                ...(certificates !== undefined && { certificates }),
                ...(employmentHistory !== undefined && { employmentHistory }),
                ...(socialLinks !== undefined && { socialLinks }),
                ...(profileMode !== undefined && { profileMode }),
                profileScore
              }
            }
          }
        } : {})
      },
      include: { wallet: true, providerProfile: true }
    });

    res.status(200).json({ success: true, data: user });
  } catch (error) {
    next(error);
  }
};

const submitFeedback = async (req, res, next) => {
  try {
    const { title, message, type = 'GENERAL' } = req.body;
    if (!title || !message) {
      return res.status(400).json({ success: false, message: 'Topic and message are required' });
    }

    const feedback = await prisma.feedback.create({
      data: {
        userId: req.user.id,
        title,
        message,
        type
      }
    });

    res.status(201).json({ success: true, data: feedback, message: 'Feedback submitted' });
  } catch (error) {
    next(error);
  }
};

const reportUser = async (req, res, next) => {
  try {
    const { targetUserId, reason, description } = req.body;
    if (!targetUserId || !reason) {
      return res.status(400).json({ success: false, message: 'Target user and reason are required' });
    }

    const report = await prisma.report.create({
      data: {
        reporterId: req.user.id,
        targetUserId,
        reason,
        description
      }
    });

    res.status(201).json({ success: true, data: report, message: 'Report submitted' });
  } catch (error) {
    next(error);
  }
};

const changePassword = async (req, res, next) => {
  try {
    const { currentPassword, newPassword, confirmNewPassword } = req.body;

    if (!currentPassword || !newPassword || !confirmNewPassword) {
      return res.status(400).json({ success: false, message: 'All password fields are required' });
    }

    if (newPassword !== confirmNewPassword) {
      return res.status(400).json({ success: false, message: 'New passwords do not match' });
    }

    if (newPassword.length < 8) {
      return res.status(400).json({ success: false, message: 'New password must be at least 8 characters' });
    }

    const isCurrentPasswordValid = await bcrypt.compare(currentPassword, req.user.password || '');
    if (!isCurrentPasswordValid) {
      return res.status(401).json({ success: false, message: 'Current password is incorrect' });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await prisma.user.update({
      where: { id: req.user.id },
      data: {
        password: hashedPassword,
        lastPasswordChange: new Date()
      }
    });

    res.status(200).json({ success: true, message: 'Password updated successfully' });
  } catch (error) {
    next(error);
  }
};

const updateFcmToken = async (req, res, next) => {
  try {
    const { fcmToken } = req.body;
    
    if (!fcmToken) {
      return res.status(400).json({ success: false, message: 'FCM Token is required' });
    }

    await prisma.user.update({
      where: { id: req.user.id },
      data: { fcmToken }
    });

    res.status(200).json({ success: true, message: 'FCM Token updated successfully' });
  } catch (error) {
    next(error);
  }
};

const deleteAccount = async (req, res, next) => {
  try {
    const { password } = req.body;
    if (!password) {
      return res.status(400).json({ success: false, message: 'Password is required to delete account' });
    }

    const isCurrentPasswordValid = await bcrypt.compare(password, req.user.password || '');
    if (!isCurrentPasswordValid) {
      return res.status(401).json({ success: false, message: 'Incorrect password' });
    }

    await prisma.user.delete({
      where: { id: req.user.id }
    });

    res.status(200).json({ success: true, message: 'Account deleted successfully' });
  } catch (error) {
    next(error);
  }
};

const getReferralStats = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { referralCode: true }
    });
    
    // Fast ETag Check
    const [latestReferredUser, totalReferred] = await Promise.all([
      prisma.user.findFirst({
        where: { referredBy: userId },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true }
      }),
      prisma.user.count({ where: { referredBy: userId } })
    ]);

    const lastUpdated = latestReferredUser ? latestReferredUser.createdAt.getTime() : 0;
    const etag = `W/"${lastUpdated}-${totalReferred}"`;

    if (req.headers['if-none-match'] === etag) {
      return res.status(304).end();
    }
    res.setHeader('ETag', etag);

    const referredUsers = await prisma.user.findMany({
      where: { referredBy: userId },
      select: {
        id: true,
        fullName: true,
        avatar: true,
        createdAt: true
      },
      orderBy: { createdAt: 'desc' }
    });
    
    const coinsEarned = totalReferred * 1;
    
    return res.status(200).json({
      success: true,
      referralCode: user?.referralCode,
      friendsInvited: referredUsers.length,
      coinsEarned,
      referredUsers: referredUsers.map(u => ({
        id: u.id,
        name: u.fullName || 'Fixam User',
        avatar: u.avatar,
        joinedAt: u.createdAt
      }))
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getMe,
  updateProfile,
  submitFeedback,
  reportUser,
  changePassword,
  updateFcmToken,
  deleteAccount,
  getReferralStats,
};
