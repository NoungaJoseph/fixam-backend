const prisma = require('../config/prisma');
const { sendPushNotification } = require('./notification.service');

const DEFAULT_PREFERENCES = {
  enabled: true,
  categories: [],
  locations: [],
  includeRemote: true,
  minimumBudget: null,
  frequency: 'INSTANT',
  matchMode: 'BEST_MATCHES',
  dailyLimit: 10,
};

const normalizeText = (value) => String(value || '').trim().toLowerCase();
const normalizeList = (values) => Array.isArray(values)
  ? values.map(normalizeText).filter(Boolean)
  : [];

const CATEGORY_ALIASES = {
  technologie: 'technology',
  informatique: 'technology',
  logiciel: 'software',
  sante: 'healthcare',
  santé: 'healthcare',
  medecine: 'medicine',
  médecine: 'medicine',
  medical: 'medicine',
  plomberie: 'plumbing',
  electricite: 'electrical',
  électricité: 'electrical',
  nettoyage: 'cleaning',
  peinture: 'painting',
  livraison: 'delivery',
  traduction: 'translation',
  comptabilite: 'accounting',
  comptabilité: 'accounting',
};

const canonicalCategory = (value) => CATEGORY_ALIASES[normalizeText(value)] || normalizeText(value);

const getPreferences = (profile) => ({
  ...DEFAULT_PREFERENCES,
  ...(profile?.jobAlertPreferences && typeof profile.jobAlertPreferences === 'object' ? profile.jobAlertPreferences : {})
});

const containsMatch = (values, target) => {
  const cleanTarget = normalizeText(target);
  return values.some(value => cleanTarget && (value === cleanTarget || value.includes(cleanTarget) || cleanTarget.includes(value)));
};

const scoreProviderForJob = (provider, job) => {
  const profile = provider.providerProfile;
  if (!profile || provider.isBlocked) return { score: 0, reasons: [] };
  const preferences = getPreferences(profile);
  if (preferences.enabled === false) return { score: 0, reasons: [] };
  if (job.isRemote && preferences.includeRemote === false) return { score: 0, reasons: [] };

  const skills = normalizeList(profile.skills).map(canonicalCategory);
  const categories = normalizeList(preferences.categories).map(canonicalCategory);
  const locations = normalizeList(preferences.locations);
  const jobCategory = canonicalCategory(job.category);
  const jobLocation = normalizeText(job.location || job.country);
  const skillMatch = skills.some(skill => skill === jobCategory || skill.includes(jobCategory) || jobCategory.includes(skill));
  const categoryMatch = categories.length === 0 || containsMatch(categories, jobCategory);
  const locationMatch = locations.length === 0 || containsMatch(locations, jobLocation) || (job.isRemote && preferences.remoteOnly);
  const remoteMatch = preferences.includeRemote !== false || !Boolean(job.isRemote);
  const budget = Number(job.budgetMax || job.budget || 0);
  const budgetMatch = !preferences.minimumBudget || budget === 0 || budget >= Number(preferences.minimumBudget);

  let score = 0;
  const reasons = [];
  if (skillMatch) { score += 35; reasons.push('skills'); }
  if (categoryMatch) { score += 30; reasons.push('category'); }
  if (locationMatch) { score += 15; reasons.push('location'); }
  if (remoteMatch) { score += 10; reasons.push('remote'); }
  if (budgetMatch) { score += 10; reasons.push('budget'); }

  if (preferences.matchMode === 'MORE_OPPORTUNITIES') {
    score = Math.max(score, skillMatch || categoryMatch ? 50 : 0);
  }

  return { score, reasons };
};

const notifyMatchingProviders = async (job) => {
  const providers = await prisma.user.findMany({
    where: { role: 'PROVIDER', isBlocked: false, providerProfile: { isNot: null } },
    include: { providerProfile: true },
  });
  const applications = await prisma.jobAssignment.findMany({ where: { jobId: job.id }, select: { providerId: true } });
  const appliedProviderIds = new Set(applications.map(application => application.providerId));
  const now = new Date();

  for (const provider of providers) {
    if (appliedProviderIds.has(provider.providerProfile.id)) continue;
    const preferences = getPreferences(provider.providerProfile);
    const result = scoreProviderForJob(provider, job);
    const hasTargetMatch = result.reasons.includes('skills') || (Array.isArray(preferences.categories) && preferences.categories.length > 0 && result.reasons.includes('category'));
    if (!hasTargetMatch) continue;
    const threshold = preferences.matchMode === 'MORE_OPPORTUNITIES' ? 50 : 60;
    if (result.score < threshold) continue;

    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const alertsToday = await prisma.notification.count({
      where: { userId: provider.id, createdAt: { gte: startOfDay }, data: { path: ['type'], equals: 'SMART_JOB_MATCH' } }
    });
    if (alertsToday >= Number(preferences.dailyLimit || 10)) continue;

    const isFrench = String(provider.preferredLanguage || '').toLowerCase().startsWith('fr');
    const title = isFrench ? 'Mission recommandée pour vous' : 'Recommended job for you';
    const body = isFrench
      ? `Cette mission correspond à vos ${result.reasons.join(', ')} : « ${job.title} ».`
      : `This job matches your ${result.reasons.join(', ')}: “${job.title}”.`;
    const data = { type: 'SMART_JOB_MATCH', jobId: job.id, matchScore: result.score, matchReasons: result.reasons, screen: 'TaskDetails' };
    const notification = await prisma.notification.create({ data: { userId: provider.id, title, body, data } });

    try {
      const { getIO } = require('./socket.service');
      getIO().to(provider.id).emit('notification:new', notification);
    } catch (_) {}
    if (preferences.frequency === 'INSTANT') {
      await sendPushNotification(provider.id, title, body, data).catch(() => {});
    }
  }
};

module.exports = { DEFAULT_PREFERENCES, getPreferences, scoreProviderForJob, notifyMatchingProviders };
