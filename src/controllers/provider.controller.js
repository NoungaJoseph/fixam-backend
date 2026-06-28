const prisma = require('../config/prisma');
const { setupProviderSchema } = require('../validators/provider.validator');
const { calculateProviderStats, enrichProvidersWithStats } = require('../utils/providerStats');
const { isRemoteSkill } = require('../utils/skillClassifier');

const updateProviderProfile = async (req, res, next) => {
  try {
    const validatedData = setupProviderSchema.parse(req.body);
    const score = [
      validatedData.bio,
      validatedData.skills?.length,
      validatedData.rate,
      validatedData.serviceArea,
      validatedData.experienceLevel,
      validatedData.portfolio?.length,
      validatedData.certificates?.length,
      validatedData.employmentHistory?.length,
      validatedData.socialLinks
    ].reduce((acc, value) => acc + (value ? 1 : 0), 0);

    const profile = await prisma.providerProfile.update({
      where: { userId: req.user.id },
      data: { ...validatedData, profileScore: score },
    });

    res.status(200).json({ success: true, data: profile });
  } catch (error) {
    next(error);
  }
};

const getProviders = async (req, res, next) => {
  try {
    const providers = await prisma.providerProfile.findMany({
      where: { 
        profileMode: 'WORK',
        user: { isOnline: true }
      },
      include: { 
        user: { 
          select: { 
            id: true,
            fullName: true, 
            avatar: true, 
            isOnline: true,
            phone: true
          } 
        } 
      },
      orderBy: { rating: 'desc' }
    });
    
    const enriched = await enrichProvidersWithStats(providers);
    const sorted = enriched.sort((a, b) => {
      const isBoostedA = a.boostExpiresAt && new Date(a.boostExpiresAt) > new Date() ? 100 : 0;
      const isBoostedB = b.boostExpiresAt && new Date(b.boostExpiresAt) > new Date() ? 100 : 0;
      const scoreA = (a.profileScore || 0) + (a.verification === 'VERIFIED' ? 5 : 0) + (a.user?.isOnline ? 2 : 0) + Number(a.rating || 0) + isBoostedA;
      const scoreB = (b.profileScore || 0) + (b.verification === 'VERIFIED' ? 5 : 0) + (b.user?.isOnline ? 2 : 0) + Number(b.rating || 0) + isBoostedB;
      return scoreB - scoreA;
    });

    res.status(200).json({ success: true, data: sorted });
  } catch (error) {
    next(error);
  }
};

const getProvidersOfTheMonth = async (req, res, next) => {
  try {
    const providers = await prisma.providerProfile.findMany({
      where: { 
        profileMode: 'WORK',
        user: { isOnline: true }
      },
      include: { 
        user: { 
          select: { 
            id: true,
            fullName: true, 
            avatar: true, 
            isOnline: true,
            phone: true
          } 
        } 
      } 
    });

    const enriched = await enrichProvidersWithStats(providers);
    const sorted = enriched.sort((a, b) => {
      const isBoostedA = a.boostExpiresAt && new Date(a.boostExpiresAt) > new Date() ? 100 : 0;
      const isBoostedB = b.boostExpiresAt && new Date(b.boostExpiresAt) > new Date() ? 100 : 0;
      const scoreA = (a.profileScore || 0) + (a.verification === 'VERIFIED' ? 5 : 0) + (a.user?.isOnline ? 2 : 0) + Number(a.rating || 0) + (a.jobsCompleted || 0) + isBoostedA;
      const scoreB = (b.profileScore || 0) + (b.verification === 'VERIFIED' ? 5 : 0) + (b.user?.isOnline ? 2 : 0) + Number(b.rating || 0) + (b.jobsCompleted || 0) + isBoostedB;
      return scoreB - scoreA;
    }).slice(0, 3).map(p => ({ ...p, isProviderOfMonth: true }));

    res.status(200).json({ success: true, data: sorted });
  } catch (error) {
    next(error);
  }
};

const getNearbyProviders = async (req, res, next) => {
  try {
    const { category, latitude, longitude, distance = 10 } = req.query;

    const providers = await prisma.providerProfile.findMany({
      where: {
        profileMode: 'WORK',
        skills: category ? { has: category } : undefined,
        user: { isOnline: true }
      },
      include: { 
        user: { 
          select: { 
            id: true,
            fullName: true, 
            avatar: true,
            isOnline: true
          } 
        } 
      }
    });

    const enriched = await enrichProvidersWithStats(providers);
    res.status(200).json({ success: true, data: enriched });
  } catch (error) {
    next(error);
  }
};

const getProviderById = async (req, res, next) => {
  try {
    const provider = await prisma.providerProfile.findUnique({
      where: { id: req.params.providerId },
      include: {
        user: {
          select: {
            id: true,
            fullName: true,
            avatar: true,
            isOnline: true,
            phone: true,
            createdAt: true,
          }
        }
      }
    });

    if (!provider) {
      return res.status(404).json({ success: false, message: 'Provider not found' });
    }

    // Check if client has unlocked this provider
    let phoneUnlocked = false;
    if (req.user) {
      if (req.user.role === 'ADMIN' || req.user.id === provider.userId) {
        phoneUnlocked = true;
      } else {
        const unlock = await prisma.unlockedProvider.findFirst({
          where: {
            clientId: req.user.id,
            providerId: provider.id
          }
        });
        if (unlock) phoneUnlocked = true;
      }
    }

    const rawPhone = provider.user?.phone || '';
    const maskedPhone = rawPhone ? rawPhone.substring(0, Math.max(0, rawPhone.length - 4)) + 'XXXX' : '';
    const finalPhone = phoneUnlocked ? rawPhone : maskedPhone;

    const stats = await calculateProviderStats(provider.id).catch(() => null);
    
    const enrichedData = {
      ...provider,
      phoneUnlocked,
      user: provider.user ? {
        ...provider.user,
        phone: finalPhone
      } : null,
      rating: stats ? stats.trustScore : provider.rating,
      skillRank: stats ? stats.skillRank : provider.skillRank,
      jobsCompleted: stats ? stats.completedJobs : 0,
      completionRate: stats ? stats.completionRate : 0,
      profileCompleteness: stats ? stats.profileCompleteness : 0
    };

    res.status(200).json({
      success: true,
      data: enrichedData
    });
  } catch (error) {
    next(error);
  }
};

const getFavoriteProviders = async (req, res, next) => {
  try {
    // Fast ETag check
    const [latestFavorite, total] = await Promise.all([
      prisma.clientFavoriteProvider.findFirst({
        where: { clientId: req.user.id },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true }
      }),
      prisma.clientFavoriteProvider.count({ where: { clientId: req.user.id } })
    ]);

    const lastUpdated = latestFavorite ? latestFavorite.createdAt.getTime() : 0;
    const etag = `W/"${lastUpdated}-${total}"`;

    if (req.headers['if-none-match'] === etag) {
      return res.status(304).end();
    }
    res.setHeader('ETag', etag);

    const favorites = await prisma.clientFavoriteProvider.findMany({
      where: { clientId: req.user.id },
      include: {
        provider: {
          include: {
            user: {
              select: {
                id: true,
                fullName: true,
                avatar: true,
                isOnline: true,
                phone: true
              }
            }
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    res.status(200).json({ success: true, data: favorites.map((favorite) => favorite.provider) });
  } catch (error) {
    next(error);
  }
};

const addFavoriteProvider = async (req, res, next) => {
  try {
    const { providerId } = req.params;

    const provider = await prisma.providerProfile.findUnique({ where: { id: providerId } });
    if (!provider) {
      return res.status(404).json({ success: false, message: 'Provider not found' });
    }

    await prisma.clientFavoriteProvider.upsert({
      where: { clientId_providerId: { clientId: req.user.id, providerId } },
      update: {},
      create: { clientId: req.user.id, providerId }
    });

    res.status(200).json({ success: true, message: 'Provider added to favorites' });
  } catch (error) {
    next(error);
  }
};

const removeFavoriteProvider = async (req, res, next) => {
  try {
    const { providerId } = req.params;

    await prisma.clientFavoriteProvider.deleteMany({
      where: { clientId: req.user.id, providerId }
    });

    res.status(200).json({ success: true, message: 'Provider removed from favorites' });
  } catch (error) {
    next(error);
  }
};

const uploadVerificationDocs = async (req, res, next) => {
  try {
    const { type, url } = req.body;

    let profile = req.user.providerProfile;
    if (!profile) {
      profile = await prisma.providerProfile.create({
        data: {
          userId: req.user.id,
          skills: [],
          profileMode: req.user.role === 'CLIENT' ? 'CLIENT' : 'WORK'
        }
      });
    }

    const doc = await prisma.verificationDocument.create({
      data: {
        providerId: profile.id,
        type,
        url,
        status: 'PENDING'
      }
    });

    // Update profile status to PENDING
    await prisma.providerProfile.update({
      where: { id: profile.id },
      data: { verification: 'PENDING' }
    });

    res.status(201).json({ success: true, data: doc });
  } catch (error) {
    next(error);
  }
};

const updateProviderStatus = async (req, res, next) => {
  try {
    const { isOnline } = req.body;
    const user = await prisma.user.update({
      where: { id: req.user.id },
      data: { isOnline: Boolean(isOnline) },
      include: { providerProfile: true, wallet: true }
    });

    res.status(200).json({ success: true, data: user });
  } catch (error) {
    next(error);
  }
};

const boostProviderProfile = async (req, res, next) => {
  try {
    const { duration } = req.body; // '1_WEEK' or '1_MONTH'
    if (duration !== '1_WEEK' && duration !== '1_MONTH') {
      return res.status(400).json({ success: false, message: 'Invalid boost duration' });
    }

    const cost = duration === '1_WEEK' ? 3 : 10;
    const durationMs = duration === '1_WEEK' ? 7 * 24 * 60 * 60 * 1000 : 30 * 24 * 60 * 60 * 1000;

    const profile = await prisma.providerProfile.findUnique({
      where: { userId: req.user.id }
    });

    if (!profile) {
      return res.status(404).json({ success: false, message: 'Provider profile not found' });
    }

    const wallet = await prisma.wallet.findUnique({
      where: { userId: req.user.id }
    });

    if (!wallet || wallet.balance < cost) {
      return res.status(400).json({ success: false, message: 'Insufficient coins in wallet' });
    }

    await prisma.$transaction([
      prisma.wallet.update({
        where: { id: wallet.id },
        data: { balance: { decrement: cost } }
      }),
      prisma.transaction.create({
        data: {
          walletId: wallet.id,
          amount: cost,
          type: 'DEDUCTION',
          status: 'SUCCESS',
          reference: `BOOST-${Date.now()}`,
          description: `Provider profile boost for ${duration === '1_WEEK' ? '1 Week' : '1 Month'}`
        }
      })
    ]);

    const currentExpiry = profile.boostExpiresAt ? new Date(profile.boostExpiresAt) : new Date();
    const baseDate = currentExpiry > new Date() ? currentExpiry : new Date();
    const newExpiry = new Date(baseDate.getTime() + durationMs);

    const updatedProfile = await prisma.providerProfile.update({
      where: { id: profile.id },
      data: { boostExpiresAt: newExpiry }
    });

    res.status(200).json({
      success: true,
      message: 'Profile boosted successfully',
      data: updatedProfile
    });
  } catch (error) {
    next(error);
  }
};

const unlockProviderProfile = async (req, res, next) => {
  try {
    const { providerId } = req.params;
    const cost = 2;

    const provider = await prisma.providerProfile.findUnique({
      where: { id: providerId },
      include: { user: true }
    });

    if (!provider) {
      return res.status(404).json({ success: false, message: 'Provider not found' });
    }

    if (provider.userId === req.user.id) {
      return res.status(400).json({ success: false, message: 'You cannot unlock your own profile' });
    }

    const existingUnlock = await prisma.unlockedProvider.findFirst({
      where: {
        clientId: req.user.id,
        providerId: providerId
      }
    });

    if (existingUnlock) {
      return res.status(200).json({ success: true, message: 'Profile already unlocked', data: existingUnlock });
    }

    const wallet = await prisma.wallet.findUnique({
      where: { userId: req.user.id }
    });

    if (!wallet || wallet.balance < cost) {
      return res.status(400).json({ success: false, message: 'Insufficient coins in wallet' });
    }

    const [_, __, unlockRecord] = await prisma.$transaction([
      prisma.wallet.update({
        where: { id: wallet.id },
        data: { balance: { decrement: cost } }
      }),
      prisma.transaction.create({
        data: {
          walletId: wallet.id,
          amount: cost,
          type: 'DEDUCTION',
          status: 'SUCCESS',
          reference: `UNLOCK-${Date.now()}`,
          description: `Unlocked provider contact for ${provider.user?.fullName || 'Provider'}`
        }
      }),
      prisma.unlockedProvider.create({
        data: {
          clientId: req.user.id,
          providerId: providerId
        }
      })
    ]);

    res.status(200).json({
      success: true,
      message: 'Provider contact unlocked successfully',
      data: {
        ...unlockRecord,
        phone: provider.user?.phone
      }
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  updateProviderProfile,
  updateProviderStatus,
  getProviderById,
  getProviders,
  getProvidersOfTheMonth,
  getNearbyProviders,
  getFavoriteProviders,
  addFavoriteProvider,
  removeFavoriteProvider,
  uploadVerificationDocs,
  boostProviderProfile,
  unlockProviderProfile,
};
