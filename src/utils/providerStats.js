const prisma = require('../config/prisma');

const RANKS = [
  { name: 'Newcomer', minJobs: 0, minTrust: 0 },
  { name: 'Beginner', minJobs: 1, minTrust: 1.0 },
  { name: 'Rising Star', minJobs: 5, minTrust: 2.0 },
  { name: 'Skilled', minJobs: 15, minTrust: 2.5 },
  { name: 'Expert', minJobs: 30, minTrust: 3.0 },
  { name: 'Master', minJobs: 50, minTrust: 3.5 },
  { name: 'Elite', minJobs: 100, minTrust: 4.0 },
];

const hasValue = (value) => {
  if (Array.isArray(value)) return value.length > 0;
  if (value && typeof value === 'object') return Object.keys(value).length > 0;
  return value !== null && value !== undefined && value !== '';
};

const calculateProviderStats = async (providerId, tx = prisma) => {
  const provider = await tx.providerProfile.findUnique({
    where: { id: providerId },
    include: { user: { select: { avatar: true } } },
  });
  if (!provider) return null;

  const [reviews, acceptedAssignments, completedJobs] = await Promise.all([
    tx.review.aggregate({
      where: { targetUserId: provider.userId },
      _avg: { rating: true },
      _count: { rating: true },
    }),
    tx.jobAssignment.count({ where: { providerId, status: 'ACCEPTED' } }),
    tx.jobAssignment.count({ where: { providerId, job: { status: 'COMPLETED' } } }),
  ]);

  const averageRating = reviews._avg.rating || 0;
  const completionRate = acceptedAssignments > 0 ? completedJobs / acceptedAssignments : 0;
  const fields = [
    provider.bio,
    provider.skills,
    provider.user?.avatar,
    provider.serviceArea,
    provider.experienceLevel,
    provider.portfolio,
    provider.certificates,
    provider.socialLinks,
  ];
  const completedFields = fields.filter(hasValue).length;
  const profileCompleteness = completedFields / 8;
  const verificationScore = provider.verification === 'VERIFIED' ? 5 : provider.verification === 'PENDING' ? 2.5 : 0;

  const score1 = (averageRating / 5) * 5;
  const score2 = completionRate * 5;
  const score3 = profileCompleteness * 5;
  const rawTrustScore = (score1 * 0.40) + (score2 * 0.30) + (score3 * 0.20) + (verificationScore * 0.10);
  const trustScore = Math.max(0, Math.min(5, Math.round(rawTrustScore * 10) / 10));

  let skillRank = RANKS[0].name;
  for (const rank of RANKS) {
    if (completedJobs >= rank.minJobs && trustScore >= rank.minTrust) {
      skillRank = rank.name;
    }
  }

  await tx.providerProfile.update({
    where: { id: providerId },
    data: {
      rating: trustScore,
      reviewCount: reviews._count.rating || 0,
      profileScore: completedFields,
      skillRank,
    },
  });

  return {
    trustScore,
    skillRank,
    completedJobs,
    completionRate,
    profileCompleteness,
  };
};

const enrichProvidersWithStats = async (providers) => {
  if (!providers || providers.length === 0) return [];
  
  const providerIds = providers.map(p => p.id);
  const userIds = providers.map(p => p.userId).filter(Boolean);

  const [reviewsRaw, acceptedAssignmentsRaw, completedJobsRaw] = await Promise.all([
    prisma.review.groupBy({
      by: ['targetUserId'],
      where: { targetUserId: { in: userIds } },
      _avg: { rating: true },
      _count: { rating: true },
    }),
    prisma.jobAssignment.groupBy({
      by: ['providerId'],
      where: { providerId: { in: providerIds }, status: 'ACCEPTED' },
      _count: { _all: true },
    }),
    prisma.jobAssignment.groupBy({
      by: ['providerId'],
      where: { providerId: { in: providerIds }, job: { status: 'COMPLETED' } },
      _count: { _all: true },
    })
  ]);

  const reviewsMap = new Map(reviewsRaw.map(r => [r.targetUserId, r]));
  const acceptedMap = new Map(acceptedAssignmentsRaw.map(a => [a.providerId, a._count._all]));
  const completedMap = new Map(completedJobsRaw.map(c => [c.providerId, c._count._all]));

  return providers.map(provider => {
    const userReviews = reviewsMap.get(provider.userId) || { _avg: { rating: 0 }, _count: { rating: 0 } };
    const acceptedAssignments = acceptedMap.get(provider.id) || 0;
    const completedJobs = completedMap.get(provider.id) || 0;

    const averageRating = userReviews._avg.rating || 0;
    const completionRate = acceptedAssignments > 0 ? completedJobs / acceptedAssignments : 0;
    const fields = [
      provider.bio,
      provider.skills,
      provider.user?.avatar,
      provider.serviceArea,
      provider.experienceLevel,
      provider.portfolio,
      provider.certificates,
      provider.socialLinks,
    ];
    const completedFields = fields.filter(hasValue).length;
    const profileCompleteness = completedFields / 8;
    const verificationScore = provider.verification === 'VERIFIED' ? 5 : provider.verification === 'PENDING' ? 2.5 : 0;

    const score1 = (averageRating / 5) * 5;
    const score2 = completionRate * 5;
    const score3 = profileCompleteness * 5;
    const rawTrustScore = (score1 * 0.40) + (score2 * 0.30) + (score3 * 0.20) + (verificationScore * 0.10);
    const trustScore = Math.max(0, Math.min(5, Math.round(rawTrustScore * 10) / 10));

    let skillRank = RANKS[0].name;
    for (const rank of RANKS) {
      if (completedJobs >= rank.minJobs && trustScore >= rank.minTrust) {
        skillRank = rank.name;
      }
    }

    return {
      ...provider,
      rating: trustScore,
      skillRank,
      jobsCompleted: completedJobs,
      completionRate,
      profileCompleteness
    };
  });
};

module.exports = { calculateProviderStats, enrichProvidersWithStats, RANKS };

