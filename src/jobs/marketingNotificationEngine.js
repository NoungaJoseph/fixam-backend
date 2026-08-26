const prisma = require('../config/prisma');
const { sendPushNotification } = require('../services/notification.service');

const ROTATING_SKILLS = [
  {
    en: {
      title: 'Need a Private Home Teacher? 📚',
      body: 'Find top-rated tutors for your children on Fixam Pro — math, science, languages, and more!'
    },
    fr: {
      title: 'Besoin d\'un répétiteur à domicile ? 📚',
      body: 'Trouvez les meilleurs enseignants particuliers pour vos enfants sur Fixam Pro !'
    },
    category: 'Tutoring'
  },
  {
    en: {
      title: 'Moving or Need Heavy Lifting? 📦',
      body: 'Hire reliable moving and packing professionals nearby to transport your items safely.'
    },
    fr: {
      title: 'Besoin d\'aide pour déménager ? 📦',
      body: 'Engagez des professionnels du déménagement et de la manutention vérifiés près de chez vous.'
    },
    category: 'Moving & Packing'
  },
  {
    en: {
      title: 'AC Not Cooling or Fridge Issue? ❄️',
      body: 'Book certified air conditioning and refrigeration technicians on Fixam today!'
    },
    fr: {
      title: 'Problème de climatiseur ou frigo ? ❄️',
      body: 'Réservez des techniciens certifiés en climatisation et froid sur Fixam dès aujourd\'hui !'
    },
    category: 'Air Conditioning'
  },
  {
    en: {
      title: 'Water Leak or Plumbing Problem? 🔧',
      body: 'Get verified master plumbers to fix leaks, drainage, and installations instantly.'
    },
    fr: {
      title: 'Fuite d\'eau ou souci de plomberie ? 🔧',
      body: 'Trouvez des plombiers qualifiés pour réparer vos fuites et installations en toute sécurité.'
    },
    category: 'Plumbing'
  },
  {
    en: {
      title: 'Electrical Faults or Wiring Needs? ⚡',
      body: 'Protect your home with certified electricians for fast repairs and safe installations.'
    },
    fr: {
      title: 'Panne électrique ou besoin de câblage ? ⚡',
      body: 'Sécurisez votre maison avec des électriciens agréés pour des interventions rapides et sûres.'
    },
    category: 'Electrical'
  },
  {
    en: {
      title: 'Give Your Home a Fresh Look! 🎨',
      body: 'Professional painters and interior decor experts are ready to transform your space.'
    },
    fr: {
      title: 'Envie de rafraîchir vos murs ? 🎨',
      body: 'Des peintres professionnels et décorateurs d\'intérieur sont disponibles pour embellir votre espace.'
    },
    category: 'Painting'
  },
  {
    en: {
      title: 'Deep House & Office Cleaning 🧹',
      body: 'Book professional cleaners for a spotless, sanitized home or workspace.'
    },
    fr: {
      title: 'Nettoyage complet maison & bureau 🧹',
      body: 'Réservez des professionnels du nettoyage pour un intérieur éclatant et désinfecté.'
    },
    category: 'Cleaning'
  },
  {
    en: {
      title: 'Custom Furniture & Carpentry 🪚',
      body: 'Connect with skilled carpenters for custom woodwork, door fixes, and furniture repair.'
    },
    fr: {
      title: 'Menuiserie & Meubles sur mesure 🪚',
      body: 'Contactez des menuisiers qualifiés pour vos fabrications en bois et réparations de meubles.'
    },
    category: 'Carpentry'
  },
  {
    en: {
      title: 'Car Diagnostics & Auto Mechanics 🚗',
      body: 'Certified mobile mechanics ready for on-demand inspection, oil change, and engine repair.'
    },
    fr: {
      title: 'Entretien auto & mécanique 🚗',
      body: 'Des mécaniciens qualifiés interviennent à domicile pour vos diagnostics et réparations.'
    },
    category: 'Auto Repair'
  },
  {
    en: {
      title: 'CCTV & Security System Setup 📹',
      body: 'Upgrade your home and business security with certified surveillance camera technicians.'
    },
    fr: {
      title: 'Installation caméras & sécurité 📹',
      body: 'Renforcez la sécurité de votre domicile ou commerce avec des experts en vidéosurveillance.'
    },
    category: 'Security Installation'
  }
];

// Helper to determine day of year for deterministic non-repeating rotation
function getSkillForToday() {
  const dayIndex = Math.floor(Date.now() / (24 * 60 * 60 * 1000)) % ROTATING_SKILLS.length;
  return ROTATING_SKILLS[dayIndex];
}

// Daily Client Skill Discovery Alert (Runs once per day around 10:00 AM)
async function sendDailyClientSkillAlert() {
  try {
    const skillItem = getSkillForToday();
    const clients = await prisma.user.findMany({
      where: {
        role: 'CLIENT',
        isBlocked: false,
      },
      select: {
        id: true,
        fullName: true,
        language: true,
        preferredLanguage: true
      },
      take: 500
    });

    console.log(`[Marketing Scheduler] Sending daily skill alert (${skillItem.category}) to ${clients.length} clients`);

    for (const client of clients) {
      const isFr = (client.preferredLanguage === 'fr' || client.language === 'fr');
      const content = isFr ? skillItem.fr : skillItem.en;

      // Create DB notification
      await prisma.notification.create({
        data: {
          userId: client.id,
          title: content.title,
          body: content.body,
          data: {
            type: 'MARKETING_SKILL_DISCOVERY',
            category: skillItem.category,
            screen: 'FindServices'
          }
        }
      }).catch(() => {});

      // Send Push Notification
      await sendPushNotification(
        client.id,
        content.title,
        content.body,
        {
          type: 'MARKETING_SKILL_DISCOVERY',
          category: skillItem.category,
          screen: 'FindServices'
        }
      ).catch(err => console.error('[Push Error] Daily client push failed:', client.id, err.message));
    }
  } catch (err) {
    console.error('[Marketing Scheduler] sendDailyClientSkillAlert error:', err.message);
  }
}

// Weekly Provider Intelligence & Boost Notification (Runs every Wednesday / Sunday)
async function sendWeeklyProviderIntelligence() {
  try {
    // 1. Calculate the most requested category in the last 7 days
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const recentJobs = await prisma.job.groupBy({
      by: ['category'],
      where: { createdAt: { gte: sevenDaysAgo } },
      _count: { id: true },
      orderBy: { _count: { id: 'desc' } },
      take: 1
    });

    const topCategory = recentJobs.length > 0 && recentJobs[0].category
      ? recentJobs[0].category
      : 'Home & Professional Services';

    const providers = await prisma.user.findMany({
      where: {
        role: 'PROVIDER',
        isBlocked: false,
        providerProfile: { isNot: null }
      },
      include: {
        providerProfile: true
      },
      take: 500
    });

    console.log(`[Marketing Scheduler] Sending weekly provider marketplace trends to ${providers.length} providers (Top: ${topCategory})`);

    const now = new Date();

    for (const provider of providers) {
      const isFr = (provider.preferredLanguage === 'fr' || provider.language === 'fr');
      const isBoosted = provider.providerProfile?.boostExpiresAt && new Date(provider.providerProfile.boostExpiresAt) > now;

      let title;
      let body;

      if (!isBoosted) {
        title = isFr 
          ? `Tendance de la semaine : ${topCategory} 🚀`
          : `Market Trend of the Week: ${topCategory} 🚀`;
        body = isFr
          ? `La demande pour "${topCategory}" est en forte hausse sur Fixam Pro cette semaine ! Boostez votre profil pour recevoir plus de réservations directes.`
          : `Demand for "${topCategory}" has surged on Fixam Pro this week! Boost your profile to capture direct client bookings and instant alerts.`;
      } else {
        title = isFr 
          ? `Profil Boosté Actif ⚡` 
          : `Active Boosted Visibility ⚡`;
        body = isFr
          ? `Votre profil boosté est mis en avant auprès des clients cherchant "${topCategory}". Restez disponible pour maximiser vos gains.`
          : `Your boosted profile is featured to clients searching for "${topCategory}". Keep your status available to maximize bookings.`;
      }

      // Create DB notification
      await prisma.notification.create({
        data: {
          userId: provider.id,
          title,
          body,
          data: {
            type: 'MARKETING_PROVIDER_TREND',
            category: topCategory,
            screen: isBoosted ? 'FindJobs' : 'BoostProfile'
          }
        }
      }).catch(() => {});

      // Send Push Notification
      await sendPushNotification(
        provider.id,
        title,
        body,
        {
          type: 'MARKETING_PROVIDER_TREND',
          category: topCategory,
          screen: isBoosted ? 'FindJobs' : 'BoostProfile'
        }
      ).catch(err => console.error('[Push Error] Weekly provider push failed:', provider.id, err.message));
    }
  } catch (err) {
    console.error('[Marketing Scheduler] sendWeeklyProviderIntelligence error:', err.message);
  }
}

// Background Cron Scheduler (Runs every 15 minutes check)
let lastDailyRunDate = null;
let lastWeeklyRunWeek = null;

function startMarketingNotificationEngine() {
  console.log('[Marketing Scheduler] Initialized Automated Skill & Market Alert Engine');

  setInterval(async () => {
    try {
      const now = new Date();
      const todayStr = now.toISOString().split('T')[0];
      const hour = now.getUTCHours(); // UTC hour

      // Run daily client notification around 09:00 - 12:00 UTC once per day
      if (hour >= 9 && hour <= 12 && lastDailyRunDate !== todayStr) {
        lastDailyRunDate = todayStr;
        await sendDailyClientSkillAlert();
      }

      // Run weekly provider trend alert on Wednesdays & Sundays
      const dayOfWeek = now.getUTCDay(); // 0 = Sunday, 3 = Wednesday
      const weekKey = `${todayStr}-${dayOfWeek}`;
      if ((dayOfWeek === 0 || dayOfWeek === 3) && hour >= 14 && hour <= 17 && lastWeeklyRunWeek !== weekKey) {
        lastWeeklyRunWeek = weekKey;
        await sendWeeklyProviderIntelligence();
      }
    } catch (err) {
      console.error('[Marketing Scheduler] Interval check error:', err.message);
    }
  }, 15 * 60 * 1000); // Check every 15 minutes
}

module.exports = {
  startMarketingNotificationEngine,
  sendDailyClientSkillAlert,
  sendWeeklyProviderIntelligence
};
