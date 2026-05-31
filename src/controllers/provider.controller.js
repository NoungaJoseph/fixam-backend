const prisma = require('../config/prisma');
const { setupProviderSchema } = require('../validators/provider.validator');
const { calculateProviderStats } = require('../utils/providerStats');

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
        profileMode: 'WORK'
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
    }).then(async (providers) => {
      const enriched = await Promise.all(providers.map(async (provider) => {
        const stats = await calculateProviderStats(provider.id).catch(() => null);
        return stats ? { ...provider, rating: stats.trustScore, skillRank: stats.skillRank, jobsCompleted: stats.completedJobs, completionRate: stats.completionRate, profileCompleteness: stats.profileCompleteness } : provider;
      }));
      return enriched.sort((a, b) => {
        const scoreA = (a.profileScore || 0) + (a.verification === 'VERIFIED' ? 5 : 0) + (a.user?.isOnline ? 2 : 0) + Number(a.rating || 0);
        const scoreB = (b.profileScore || 0) + (b.verification === 'VERIFIED' ? 5 : 0) + (b.user?.isOnline ? 2 : 0) + Number(b.rating || 0);
        return scoreB - scoreA;
      });
    });
    res.status(200).json({ success: true, data: providers });
  } catch (error) {
    next(error);
  }
};

const getProvidersOfTheMonth = async (req, res, next) => {
  try {
    const providers = await prisma.providerProfile.findMany({
      where: { 
        profileMode: 'WORK'
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
    }).then(async (providers) => {
      const enriched = await Promise.all(providers.map(async (provider) => {
        const stats = await calculateProviderStats(provider.id).catch(() => null);
        return stats ? { ...provider, rating: stats.trustScore, skillRank: stats.skillRank, jobsCompleted: stats.completedJobs, completionRate: stats.completionRate, profileCompleteness: stats.profileCompleteness } : provider;
      }));
      return enriched.sort((a, b) => {
        const scoreA = (a.profileScore || 0) + (a.verification === 'VERIFIED' ? 5 : 0) + (a.user?.isOnline ? 2 : 0) + Number(a.rating || 0) + (a.jobsCompleted || 0);
        const scoreB = (b.profileScore || 0) + (b.verification === 'VERIFIED' ? 5 : 0) + (b.user?.isOnline ? 2 : 0) + Number(b.rating || 0) + (b.jobsCompleted || 0);
        return scoreB - scoreA;
      }).slice(0, 3).map(p => ({ ...p, isProviderOfMonth: true }));
    });
    res.status(200).json({ success: true, data: providers });
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

    const enriched = await Promise.all(providers.map(async (provider) => {
      const stats = await calculateProviderStats(provider.id).catch(() => null);
      return stats ? { ...provider, rating: stats.trustScore, skillRank: stats.skillRank, jobsCompleted: stats.completedJobs, completionRate: stats.completionRate, profileCompleteness: stats.profileCompleteness } : provider;
    }));
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

    const stats = await calculateProviderStats(provider.id).catch(() => null);
    res.status(200).json({
      success: true,
      data: stats ? { ...provider, rating: stats.trustScore, skillRank: stats.skillRank, jobsCompleted: stats.completedJobs, completionRate: stats.completionRate, profileCompleteness: stats.profileCompleteness } : provider
    });
  } catch (error) {
    next(error);
  }
};

const getFavoriteProviders = async (req, res, next) => {
  try {
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

    const doc = await prisma.verificationDocument.create({
      data: {
        providerId: req.user.providerProfile.id,
        type,
        url,
        status: 'PENDING'
      }
    });

    // Update profile status to PENDING
    await prisma.providerProfile.update({
      where: { id: req.user.providerProfile.id },
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
};
