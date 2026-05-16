const prisma = require('../config/prisma');
const { setupProviderSchema } = require('../validators/provider.validator');

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
    }).then((providers) => {
      return providers.sort((a, b) => {
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

    res.status(200).json({ success: true, data: providers });
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
  getProviders,
  getNearbyProviders,
  uploadVerificationDocs,
};
