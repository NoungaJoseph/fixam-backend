const prisma = require('../config/prisma');
const { setupProviderSchema } = require('../validators/provider.validator');
const { calculateProviderStats, enrichProvidersWithStats } = require('../utils/providerStats');
const { isRemoteSkill } = require('../utils/skillClassifier');

const maskProvidersPhone = (providers) => providers.map(p => {
  if (!p.user || !p.user.phone) return p;
  const rawPhone = p.user.phone;
  const maskedPhone = rawPhone.length > 4 ? rawPhone.substring(0, rawPhone.length - 4) + 'XXXX' : 'XXXX';
  return { ...p, phoneUnlocked: false, user: { ...p.user, phone: maskedPhone } };
});

const trackMonthlySearches = (providerIds) => {
  if (!providerIds || providerIds.length === 0) return;
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;

  Promise.all(providerIds.map(providerId => 
    prisma.providerMonthlyStats.upsert({
      where: {
        providerId_year_month: {
          providerId,
          year,
          month
        }
      },
      update: {
        searchAppearances: { increment: 1 }
      },
      create: {
        providerId,
        year,
        month,
        searchAppearances: 1
      }
    })
  )).catch(err => console.error('[Monthly Search Stats Error]', err));
};

const trackMonthlyView = (providerId) => {
  if (!providerId) return;
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;

  prisma.providerMonthlyStats.upsert({
    where: {
      providerId_year_month: {
        providerId,
        year,
        month
      }
    },
    update: {
      profileViews: { increment: 1 }
    },
    create: {
      providerId,
      year,
      month,
      profileViews: 1
    }
  }).catch(err => console.error('[Monthly View Stats Error]', err));
};

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
    const { category, search } = req.query;
    const clientCountry = req.user?.country || 'Cameroon';
    const isRemote = isRemoteSkill(category || search);

    const providers = await prisma.providerProfile.findMany({
      where: { 
        profileMode: 'WORK',
        user: { 
          isOnline: true,
          country: isRemote ? undefined : clientCountry
        }
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

    const maskedProviders = maskProvidersPhone(sorted);

    // Track search appearances
    const providerIds = sorted.map(p => p.id);
    if (providerIds.length > 0) {
      prisma.providerProfile.updateMany({
        where: { id: { in: providerIds } },
        data: { searchAppearances: { increment: 1 } }
      }).catch(err => console.error('[Stats Error]', err));
      trackMonthlySearches(providerIds);
    }

    res.status(200).json({ success: true, data: maskedProviders });
  } catch (error) {
    next(error);
  }
};

const getProvidersOfTheMonth = async (req, res, next) => {
  try {
    const clientCountry = req.user?.country || 'Cameroon';
    const providers = await prisma.providerProfile.findMany({
      where: { 
        profileMode: 'WORK',
        user: { 
          isOnline: true,
          country: clientCountry
        }
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

    const maskedProviders = maskProvidersPhone(sorted);
    res.status(200).json({ success: true, data: maskedProviders });
  } catch (error) {
    next(error);
  }
};

const getNearbyProviders = async (req, res, next) => {
  try {
    const { category, latitude, longitude, distance = 10 } = req.query;
    const clientCountry = req.user?.country || 'Cameroon';

    const providers = await prisma.providerProfile.findMany({
      where: {
        profileMode: 'WORK',
        skills: category ? { has: category } : undefined,
        user: { 
          isOnline: true,
          country: clientCountry
        }
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
    const maskedProviders = maskProvidersPhone(enriched);

    // Track search appearances
    const providerIds = enriched.map(p => p.id);
    if (providerIds.length > 0) {
      prisma.providerProfile.updateMany({
        where: { id: { in: providerIds } },
        data: { searchAppearances: { increment: 1 } }
      }).catch(err => console.error('[Stats Error]', err));
      trackMonthlySearches(providerIds);
    }

    res.status(200).json({ success: true, data: maskedProviders });
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

    // Check if client has unlocked this provider (within 24h window)
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
        if (unlock) {
          // null expiresAt = old record (treat as expired), must re-unlock
          if (unlock.expiresAt && new Date(unlock.expiresAt) > new Date()) {
            phoneUnlocked = true;
          } else {
            // Expired or old record — delete so they can unlock again
            await prisma.unlockedProvider.deleteMany({
              where: { clientId: req.user.id, providerId: provider.id }
            });
          }
        }
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

    if (req.user && req.user.role === 'CLIENT' && req.user.id !== provider.userId) {
      prisma.providerProfile.update({
        where: { id: provider.id },
        data: { profileViews: { increment: 1 } }
      }).catch(err => console.error('[Stats Error]', err));
      trackMonthlyView(provider.id);
    }

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

    let providers = favorites.map((favorite) => favorite.provider);
    providers = maskProvidersPhone(providers);

    const activeUnlocks = await prisma.unlockedProvider.findMany({
      where: { clientId: req.user.id, expiresAt: { gt: new Date() } },
      include: { provider: { select: { id: true, user: { select: { phone: true } } } } }
    });
    
    const unlockMap = {};
    activeUnlocks.forEach(u => {
      if (u.provider?.user?.phone) unlockMap[u.providerId] = u.provider.user.phone;
    });

    providers = providers.map(p => {
      if (unlockMap[p.id]) {
        return {
          ...p,
          phoneUnlocked: true,
          user: { ...p.user, phone: unlockMap[p.id] }
        };
      }
      return p;
    });

    res.status(200).json({ success: true, data: providers });
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
      // Check if still valid
      if (new Date(existingUnlock.expiresAt) > new Date()) {
        return res.status(200).json({ success: true, message: 'Profile already unlocked', data: existingUnlock });
      }
      // Expired — delete so we can re-unlock below
      await prisma.unlockedProvider.deleteMany({
        where: { clientId: req.user.id, providerId: providerId }
      });
    }

    const wallet = await prisma.wallet.findUnique({
      where: { userId: req.user.id }
    });

    if (!wallet || wallet.balance < cost) {
      return res.status(400).json({ success: false, message: 'Insufficient coins in wallet' });
    }

    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours from now

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
          providerId: providerId,
          expiresAt
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

const claimSetupBonus = async (req, res, next) => {
  try {
    const userId = req.user.id;
    
    // Check if provider profile exists and hasn't claimed bonus
    const profile = await prisma.providerProfile.findUnique({
      where: { userId }
    });
    
    if (!profile) {
      return res.status(404).json({ success: false, message: 'Provider profile not found' });
    }
    
    if (profile.setupBonusClaimed) {
      return res.status(400).json({ success: false, message: 'Setup bonus already claimed' });
    }
    
    // Check if profile is complete (e.g., bio, rate, etc. are set)
    // The requirement says "upon completion of the setup". Let's assume frontend controls the button state,
    // but we should verify that basic fields exist
    if (!profile.bio || !profile.skills || profile.skills.length === 0 || profile.verification !== 'VERIFIED') {
      return res.status(400).json({ success: false, message: 'Profile is not fully complete or verified yet' });
    }
    
    const wallet = await prisma.wallet.findUnique({ where: { userId } });
    if (!wallet) {
      return res.status(404).json({ success: false, message: 'Wallet not found' });
    }
    
    const BONUS_AMOUNT = 1;
    
    await prisma.$transaction([
      prisma.providerProfile.update({
        where: { id: profile.id },
        data: { setupBonusClaimed: true }
      }),
      prisma.wallet.update({
        where: { id: wallet.id },
        data: { balance: { increment: BONUS_AMOUNT } }
      }),
      prisma.transaction.create({
        data: {
          walletId: wallet.id,
          amount: BONUS_AMOUNT,
          type: 'PURCHASE',
          status: 'SUCCESS',
          reference: `SETUP-BONUS-${Date.now()}`,
          description: 'Profile Setup Bonus'
        }
      })
    ]);
    
    res.status(200).json({
      success: true,
      message: 'Bonus claimed successfully! 1 coin added to your wallet.'
    });
  } catch (error) {
    next(error);
  }
};

const getProviderReports = async (req, res, next) => {
  try {
    const profile = await prisma.providerProfile.findUnique({
      where: { userId: req.user.id }
    });
    if (!profile) {
      return res.status(404).json({ success: false, message: 'Provider profile not found' });
    }
    const reports = await prisma.providerReport.findMany({
      where: { providerId: profile.id },
      orderBy: [
        { year: 'desc' },
        { month: 'desc' }
      ]
    });
    res.status(200).json({ success: true, data: reports });
  } catch (error) {
    next(error);
  }
};

const generateProviderReport = async (req, res, next) => {
  try {
    const { year, month } = req.body;
    if (!year || !month) {
      return res.status(400).json({ success: false, message: 'Year and month are required' });
    }

    const yearNum = Number(year);
    const monthNum = Number(month);

    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1;
    const currentDay = now.getDate();
    const lastDayOfMonth = new Date(currentYear, currentMonth, 0).getDate();

    const isCurrentMonth = yearNum === currentYear && monthNum === currentMonth;
    const isPastMonth = yearNum < currentYear || (yearNum === currentYear && monthNum < currentMonth);
    const isMonthEnd = isCurrentMonth && currentDay === lastDayOfMonth;

    if (!isPastMonth && !isMonthEnd) {
      return res.status(400).json({ success: false, message: 'Cannot generate report for an ongoing month until month end' });
    }

    const profile = await prisma.providerProfile.findUnique({
      where: { userId: req.user.id }
    });
    if (!profile) {
      return res.status(404).json({ success: false, message: 'Provider profile not found' });
    }

    const existing = await prisma.providerReport.findUnique({
      where: {
        providerId_year_month: {
          providerId: profile.id,
          year: yearNum,
          month: monthNum
        }
      }
    });
    if (existing) {
      return res.status(400).json({ success: false, message: 'Report already generated for this month' });
    }

    const monthlyStats = await prisma.providerMonthlyStats.findUnique({
      where: {
        providerId_year_month: {
          providerId: profile.id,
          year: yearNum,
          month: monthNum
        }
      }
    }) || { profileViews: 0, searchAppearances: 0 };

    const startOfMonth = new Date(yearNum, monthNum - 1, 1);
    const endOfMonth = new Date(yearNum, monthNum, 0, 23, 59, 59, 999);

    const completedJobs = await prisma.job.findMany({
      where: {
        status: 'COMPLETED',
        updatedAt: {
          gte: startOfMonth,
          lte: endOfMonth
        },
        assignments: {
          some: {
            providerId: profile.id,
            status: 'ACCEPTED'
          }
        }
      }
    });

    const completedBookings = await prisma.booking.findMany({
      where: {
        status: 'COMPLETED',
        updatedAt: {
          gte: startOfMonth,
          lte: endOfMonth
        },
        providerId: profile.userId
      }
    });

    const totalJobsCount = completedJobs.length + completedBookings.length;
    const totalEarnings = completedJobs.reduce((sum, j) => sum + (j.budget || 0), 0) + 
                          completedBookings.reduce((sum, b) => sum + (b.budget || 0), 0);

    const stats = await calculateProviderStats(profile.id).catch(() => null);
    const rating = stats ? stats.trustScore : profile.rating;
    const successRate = stats ? stats.completionRate : 100;

    const coinPurchases = await prisma.coinPurchase.aggregate({
      _sum: {
        coins: true
      },
      where: {
        userId: req.user.id,
        status: 'SUCCESS',
        createdAt: {
          gte: startOfMonth,
          lte: endOfMonth
        }
      }
    });
    const coinsPurchased = coinPurchases._sum.coins || 0;

    if (
      monthlyStats.profileViews === 0 &&
      monthlyStats.searchAppearances === 0 &&
      totalJobsCount === 0 &&
      totalEarnings === 0 &&
      coinsPurchased === 0
    ) {
      return res.status(400).json({ success: false, message: 'No data available for this month' });
    }

    const report = await prisma.providerReport.create({
      data: {
        providerId: profile.id,
        year: yearNum,
        month: monthNum,
        views: monthlyStats.profileViews,
        searches: monthlyStats.searchAppearances,
        jobsCompleted: totalJobsCount,
        earnings: totalEarnings,
        rating,
        successRate,
        coinsPurchased
      }
    });

    res.status(201).json({ success: true, data: report });
  } catch (error) {
    console.error('[Generate Report Error]', error);
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
  maskProvidersPhone,
  claimSetupBonus,
  getProviderReports,
  generateProviderReport,
};
