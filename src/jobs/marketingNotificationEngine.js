const prisma = require('../config/prisma');
const { sendPushNotification } = require('../services/notification.service');

// Dedicated, rotating weekly skills with engaging, problem-solving copy for clients.
// Each new week spotlights strictly ONE skill, rotating deterministically.
const WEEKLY_SKILLS = [
  {
    category: 'Home Tutor',
    search: 'tutor',
    en: {
      title: 'Need a Home Tutor for Your Kids? 📚',
      body: 'Give your children the academic edge! Find verified private tutors on Fixam for mathematics, science, languages, and exam prep.'
    },
    fr: {
      title: 'Besoin d\'un répétiteur à domicile pour vos enfants ? 📚',
      body: 'Offrez le meilleur soutien scolaire à vos enfants ! Trouvez des répétiteurs qualifiés sur Fixam en maths, sciences, langues et préparation aux examens.'
    }
  },
  {
    category: 'AC Repair',
    search: 'ac repair',
    en: {
      title: 'Is Your AC or Fridge Giving You Trouble? ❄️',
      body: 'Stay cool and protect your food! Book certified refrigeration technicians on Fixam for AC servicing, gas refill, and fridge repairs.'
    },
    fr: {
      title: 'Votre climatiseur ou frigo vous pose problème ? ❄️',
      body: 'Restez au frais ! Réservez des frigoristes certifiés sur Fixam pour l\'entretien de votre clim, recharge de gaz et réparation de frigos.'
    }
  },
  {
    category: 'Plumbing',
    search: 'plumber',
    en: {
      title: 'Water Leak, Clogged Drain or Tap Issues? 🔧',
      body: 'Don\'t let a small leak cause costly damage. Hire top-rated master plumbers near you on Fixam for fast and reliable repairs.'
    },
    fr: {
      title: 'Fuite d\'eau, tuyau bouché ou souci de robinet ? 🔧',
      body: 'Ne laissez pas une fuite abîmer votre maison. Engagez des plombiers expérimentés près de chez vous sur Fixam pour des réparations rapides.'
    }
  },
  {
    category: 'Electrical',
    search: 'electrician',
    en: {
      title: 'Electrical Fault, Spark or Rewiring Needed? ⚡',
      body: 'Protect your home and loved ones. Connect with certified electricians on Fixam for circuit diagnostics, socket fixes, and safe installations.'
    },
    fr: {
      title: 'Panne électrique, disjoncteur ou besoin de câblage ? ⚡',
      body: 'Sécurisez votre habitation sans attendre. Contactez des électriciens agréés sur Fixam pour vos diagnostics, prises et installations en toute sûreté.'
    }
  },
  {
    category: 'Cleaning',
    search: 'cleaning',
    en: {
      title: 'Time for a Sparkling Deep Clean at Home? 🧹',
      body: 'Relax and let the pros handle it! Book vetted cleaners on Fixam for deep house cleaning, sofa washing, and complete sanitization.'
    },
    fr: {
      title: 'Envie d\'un grand nettoyage étincelant chez vous ? 🧹',
      body: 'Détendez-vous et laissez faire les pros ! Réservez des agents de ménage vérifiés sur Fixam pour un nettoyage complet et désinfection de votre maison.'
    }
  },
  {
    category: 'Carpentry',
    search: 'carpentry',
    en: {
      title: 'Broken Wardrobe, Squeaky Doors or Custom Furniture? 🪚',
      body: 'Give your home a quality wooden touch. Hire skilled carpenters on Fixam to craft custom wardrobes, repair doors, and restore furniture.'
    },
    fr: {
      title: 'Porte bloquée, placard cassé ou meuble sur mesure ? 🪚',
      body: 'Embellissez votre intérieur avec du bois de qualité ! Engagez des menuisiers qualifiés sur Fixam pour placards sur mesure et réparations de meubles.'
    }
  },
  {
    category: 'Painting',
    search: 'painter',
    en: {
      title: 'Give Your Home a Fresh New Look with Paint! 🎨',
      body: 'Brighten your living spaces with expert finishes. Hire professional interior and exterior house painters on Fixam today.'
    },
    fr: {
      title: 'Envie de rafraîchir et embellir vos murs ? 🎨',
      body: 'Illuminez votre intérieur avec des finitions impeccables. Trouvez des peintres en bâtiment professionnels sur Fixam dès aujourd\'hui.'
    }
  },
  {
    category: 'Mechanic',
    search: 'mechanic',
    en: {
      title: 'Strange Engine Noise or Time for Car Servicing? 🚗',
      body: 'Save time and avoid towing! Experienced mobile mechanics can come directly to your home or office for vehicle checkups and repairs.'
    },
    fr: {
      title: 'Bruit suspect au moteur ou révision auto à faire ? 🚗',
      body: 'Gagnez du temps ! Des mécaniciens auto mobiles se déplacent directement à votre domicile ou bureau pour diagnostics et réparations.'
    }
  },
  {
    category: 'Child Care',
    search: 'nanny',
    en: {
      title: 'Need a Caring, Vetted Nanny or Babysitter? 👶',
      body: 'Enjoy peace of mind while at work. Find trusted, background-checked child care providers and nannies on Fixam.'
    },
    fr: {
      title: 'Besoin d\'une nounou ou baby-sitter de confiance ? 👶',
      body: 'Ayez l\'esprit serein durant vos journées. Trouvez des gardiennes d\'enfants et nounous vérifiées sur Fixam pour prendre soin de vos tout-petits.'
    }
  },
  {
    category: 'Appliance Repair',
    search: 'appliance',
    en: {
      title: 'Washing Machine, TV or Microwave Not Working? 🔌',
      body: 'Before buying a replacement, have an expert check it! Book skilled electronics & appliance technicians on Fixam to fix it at a great price.'
    },
    fr: {
      title: 'Machine à laver, téléviseur ou micro-ondes en panne ? 🔌',
      body: 'Avant de racheter, faites réparer ! Trouvez des techniciens qualifiés en électroménager sur Fixam pour dépanner vos appareils à bon prix.'
    }
  },
  {
    category: 'Security Guard',
    search: 'cctv',
    en: {
      title: 'Keep Your Family & Home Safe with CCTV 📹',
      body: 'Monitor your property anytime from your phone. Connect with verified security camera and alarm technicians on Fixam.'
    },
    fr: {
      title: 'Renforcez la sécurité de votre famille avec des caméras 📹',
      body: 'Gardez un œil sur votre maison 24h/24 depuis votre smartphone. Faites appel à des installateurs de vidéosurveillance agréés sur Fixam.'
    }
  },
  {
    category: 'Moving Service',
    search: 'moving',
    en: {
      title: 'Moving House or Need Heavy Transport? 📦',
      body: 'Relocate with ease! Book reliable moving teams with transport vehicles on Fixam for hassle-free packing and safe delivery.'
    },
    fr: {
      title: 'Déménagement ou transport d\'équipements lourds ? 📦',
      body: 'Déménagez sans stress ! Réservez des déménageurs et véhicules adaptés sur Fixam pour un transport sécurisé de vos affaires.'
    }
  }
];

// Determine the skill and ISO week key for the given date (anchored to Monday Sept 7, 2026)
function getCurrentWeekInfo(date = new Date()) {
  const anchorMs = Date.UTC(2026, 8, 7); // Sept 7, 2026 is Monday (Week 0 = Home Tutor)
  const diffWeeks = Math.floor((date.getTime() - anchorMs) / (7 * 24 * 60 * 60 * 1000));
  const weekIndex = ((diffWeeks % WEEKLY_SKILLS.length) + WEEKLY_SKILLS.length) % WEEKLY_SKILLS.length;

  const tempDate = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = tempDate.getUTCDay() || 7;
  tempDate.setUTCDate(tempDate.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(tempDate.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((tempDate - yearStart) / 86400000) + 1) / 7);
  const weekKey = `${tempDate.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;

  return {
    weekKey,
    weekIndex,
    skill: WEEKLY_SKILLS[weekIndex]
  };
}

// Push notifications to all active clients for the current week's single spotlighted skill
async function sendWeeklyClientSkillAlert(options = {}) {
  const { force = false, targetDate = new Date() } = options;
  const { weekKey, skill } = getCurrentWeekInfo(targetDate);

  try {
    if (!force) {
      // Check if this week's skill notification has already been sent to prevent duplicate blasts
      const alreadySent = await prisma.notification.findFirst({
        where: {
          data: {
            path: ['weekKey'],
            equals: weekKey
          }
        }
      });

      if (alreadySent) {
        console.log(`[Marketing Scheduler] Weekly skill alert for ${weekKey} ("${skill.category}") was already sent. Skipping.`);
        return { success: true, skipped: true, weekKey, category: skill.category };
      }
    }

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
      take: 2000
    });

    console.log(`[Marketing Scheduler] Dispatching new week skill spotlight: "${skill.category}" (${weekKey}) to ${clients.length} clients`);

    let sentCount = 0;
    for (const client of clients) {
      const isFr = (client.preferredLanguage === 'fr' || client.language === 'fr');
      const content = isFr ? skill.fr : skill.en;

      // 1. Create In-App Notification
      await prisma.notification.create({
        data: {
          userId: client.id,
          title: content.title,
          body: content.body,
          data: {
            type: 'WEEKLY_SKILL_SPOTLIGHT',
            weekKey,
            category: skill.category,
            search: skill.search,
            screen: 'ProviderList'
          }
        }
      }).catch(err => console.error('[DB Notification Error]:', client.id, err.message));

      // 2. Send Push Notification via FCM
      await sendPushNotification(
        client.id,
        content.title,
        content.body,
        {
          type: 'WEEKLY_SKILL_SPOTLIGHT',
          weekKey,
          category: skill.category,
          search: skill.search,
          screen: 'ProviderList'
        }
      ).catch(err => console.error('[Push Error] Weekly client push failed:', client.id, err.message));

      sentCount++;
    }

    return {
      success: true,
      sent: sentCount,
      weekKey,
      category: skill.category,
      title: skill.en.title
    };
  } catch (err) {
    console.error('[Marketing Scheduler] sendWeeklyClientSkillAlert error:', err.message);
    throw err;
  }
}

function getProviderTrendContent(category, isFr) {
  const normalized = String(category || '').trim().toLowerCase();
  const focused = [
    { matches: ['home tutor', 'tutor', 'teaching'], en: ['Provider demand this week: Home tutors', 'More families are looking for home tutors for their children this week. Keep your subjects, service area and availability up to date so the right clients can find you.'], fr: ['Demande de la semaine : répétiteurs à domicile', 'Cette semaine, davantage de familles recherchent un répétiteur à domicile pour leurs enfants. Mettez à jour vos matières, votre zone d’intervention et vos disponibilités.'] },
    { matches: ['cleaning', 'cleaner'], en: ['Provider demand this week: Cleaning services', 'More clients are looking for reliable cleaners this week. Make sure your cleaning services, area and availability are clear on your profile.'], fr: ['Demande de la semaine : services de nettoyage', 'Cette semaine, davantage de clients recherchent des agents de nettoyage fiables. Vérifiez vos services, votre zone d’intervention et vos disponibilités.'] },
    { matches: ['plumb'], en: ['Provider demand this week: Plumbing', 'More clients are looking for plumbers this week. Keep your repair skills and availability current to appear in relevant searches.'], fr: ['Demande de la semaine : plomberie', 'Cette semaine, davantage de clients recherchent des plombiers. Gardez vos compétences et vos disponibilités à jour pour apparaître dans les recherches.'] },
    { matches: ['electr'], en: ['Provider demand this week: Electrical services', 'More clients are looking for electricians this week. Confirm your services and availability so clients can discover your profile.'], fr: ['Demande de la semaine : services électriques', 'Cette semaine, davantage de clients recherchent des électriciens. Confirmez vos services et vos disponibilités pour être trouvé plus facilement.'] },
  ].find((item) => item.matches.some((match) => normalized.includes(match)));
  const copy = focused ? (isFr ? focused.fr : focused.en) : isFr
    ? ['Demande de services cette semaine', `Cette semaine, davantage de clients recherchent des prestataires en ${category || 'services'}. Mettez à jour vos compétences, votre zone et vos disponibilités pour apparaître dans les résultats.`]
    : ['Service demand this week', `More clients are looking for ${category || 'professional'} services this week. Keep your skills, service area and availability current so you appear in relevant results.`];
  return { title: copy[0], body: copy[1] };
}

// Weekly provider demand signal (runs every Wednesday and Sunday).
async function sendWeeklyProviderIntelligence() {
  try {
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
      : getCurrentWeekInfo().skill.category;

    const providers = await prisma.user.findMany({
      where: {
        role: 'PROVIDER',
        isBlocked: false,
        providerProfile: { isNot: null }
      },
      include: {
        providerProfile: true
      },
      take: 1000
    });

    console.log(`[Marketing Scheduler] Sending weekly provider marketplace trends to ${providers.length} providers (Top: ${topCategory})`);

    for (const provider of providers) {
      const isFr = (provider.preferredLanguage === 'fr' || provider.language === 'fr');
      const { title, body } = getProviderTrendContent(topCategory, isFr);

      await prisma.notification.create({
        data: {
          userId: provider.id,
          title,
          body,
          data: {
            type: 'MARKETING_PROVIDER_TREND',
            category: topCategory,
            screen: 'FindJobs'
          }
        }
      }).catch(() => {});

      await sendPushNotification(
        provider.id,
        title,
        body,
        {
          type: 'MARKETING_PROVIDER_TREND',
          category: topCategory,
          screen: 'FindJobs'
        }
      ).catch(err => console.error('[Push Error] Weekly provider push failed:', provider.id, err.message));
    }
  } catch (err) {
    console.error('[Marketing Scheduler] sendWeeklyProviderIntelligence error:', err.message);
  }
}

// Background Cron Scheduler (Runs every 15 minutes)
let lastWeeklyClientRunWeek = null;
let lastWeeklyProviderRunWeek = null;

function startMarketingNotificationEngine() {
  console.log('[Marketing Scheduler] Initialized Weekly Skill Spotlight & Provider Engine');

  setInterval(async () => {
    try {
      const now = new Date();
      const dayOfWeek = now.getUTCDay(); // 0 = Sunday, 1 = Monday, 3 = Wednesday
      const hour = now.getUTCHours();
      const { weekKey } = getCurrentWeekInfo(now);

      // 1. Run Weekly Client Skill Spotlight on Mondays between 08:00 and 12:00 UTC
      if (dayOfWeek === 1 && hour >= 8 && hour <= 12 && lastWeeklyClientRunWeek !== weekKey) {
        lastWeeklyClientRunWeek = weekKey;
        await sendWeeklyClientSkillAlert();
      }

      // 2. Run weekly provider trends on Wednesdays & Sundays between 14:00 and 17:00 UTC
      const todayStr = now.toISOString().split('T')[0];
      const provWeekKey = `${todayStr}-${dayOfWeek}`;
      if ((dayOfWeek === 0 || dayOfWeek === 3) && hour >= 14 && hour <= 17 && lastWeeklyProviderRunWeek !== provWeekKey) {
        lastWeeklyProviderRunWeek = provWeekKey;
        await sendWeeklyProviderIntelligence();
      }
    } catch (err) {
      console.error('[Marketing Scheduler] Interval check error:', err.message);
    }
  }, 15 * 60 * 1000); // Check every 15 minutes
}

module.exports = {
  WEEKLY_SKILLS,
  ROTATING_SKILLS: WEEKLY_SKILLS,
  getCurrentWeekInfo,
  sendWeeklyClientSkillAlert,
  sendDailyClientSkillAlert: sendWeeklyClientSkillAlert,
  sendWeeklyProviderIntelligence,
  startMarketingNotificationEngine
};
