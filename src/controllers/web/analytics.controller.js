const prisma = require('../../config/prisma');

// Track a Page View & Cookie Choice
exports.trackPageView = async (req, res) => {
  try {
    const { path = '/', domain = 'usefixam.com', duration, cookieConsent, isGuest = true } = req.body;
    const ipAddress = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || req.connection?.remoteAddress;
    const userAgent = req.headers['user-agent'] || 'Unknown';
    const userId = req.user ? (req.user.id || req.user.userId) : null;
    const isLoggedIn = Boolean(userId || isGuest === false);

    // Strict privacy rule: For logged-in users, DO NOT monitor how long they stayed (duration = null)
    let sanitizedDuration = null;
    if (!isLoggedIn && duration !== undefined && duration !== null) {
      const parsed = parseInt(duration, 10);
      if (!isNaN(parsed) && parsed >= 0) {
        // Cap single page stay duration at 24 hours to prevent anomalous timers
        sanitizedDuration = Math.min(parsed, 86400);
      }
    }

    // Save PageView in database
    await prisma.pageView.create({
      data: {
        path: String(path).substring(0, 500),
        domain: String(domain).substring(0, 255),
        ipAddress: ipAddress ? String(ipAddress).substring(0, 100) : null,
        userAgent: userAgent ? String(userAgent).substring(0, 500) : null,
        userId: userId ? String(userId) : null,
        duration: sanitizedDuration,
        cookieConsent: cookieConsent ? String(cookieConsent).toUpperCase() : null,
        isLoggedIn
      }
    });

    res.status(200).json({ success: true });
  } catch (error) {
    console.error('[Analytics Error]:', error.message);
    // Return 200/204 to never block client browsing if analytics fails
    res.status(200).json({ success: false, message: error.message });
  }
};

// Admin: Get Full Web & SEO Analytics Stats
exports.getStats = async (req, res) => {
  try {
    const now = new Date();
    const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);

    const [
      totalViews,
      uniqueVisitorsRow,
      guestDurationAgg,
      cookieConsentRows,
      topPagesRaw,
      dailyTrendRows,
      deviceRows
    ] = await Promise.all([
      prisma.pageView.count().catch(() => 0),
      prisma.$queryRaw`
        SELECT COUNT(DISTINCT "ipAddress") AS "uniqueCount"
        FROM "PageView"
        WHERE "ipAddress" IS NOT NULL
      `.catch(() => [{ uniqueCount: 0 }]),
      prisma.pageView.aggregate({
        _avg: { duration: true },
        where: { duration: { not: null }, isLoggedIn: false }
      }).catch(() => ({ _avg: { duration: 0 } })),
      prisma.pageView.groupBy({
        by: ['cookieConsent'],
        where: { cookieConsent: { not: null } },
        _count: { cookieConsent: true }
      }).catch(() => []),
      prisma.$queryRaw`
        SELECT 
          path,
          COUNT(*)::int AS "views",
          ROUND(AVG(duration)::numeric, 1) AS "avgDuration"
        FROM "PageView"
        GROUP BY path
        ORDER BY "views" DESC
        LIMIT 15
      `.catch(() => []),
      prisma.$queryRaw`
        SELECT 
          DATE("createdAt") AS date,
          COUNT(*)::int AS views,
          COUNT(DISTINCT "ipAddress")::int AS visitors
        FROM "PageView"
        WHERE "createdAt" >= ${fourteenDaysAgo}
        GROUP BY DATE("createdAt")
        ORDER BY date ASC
      `.catch(() => []),
      prisma.$queryRaw`
        SELECT
          CASE 
            WHEN "userAgent" ILIKE '%Mobile%' OR "userAgent" ILIKE '%Android%' OR "userAgent" ILIKE '%iPhone%' THEN 'Mobile'
            WHEN "userAgent" ILIKE '%Tablet%' OR "userAgent" ILIKE '%iPad%' THEN 'Tablet'
            ELSE 'Desktop'
          END AS device,
          COUNT(*)::int AS count
        FROM "PageView"
        GROUP BY 1
        ORDER BY count DESC
      `.catch(() => [])
    ]);

    // Parse Cookie Consent breakdown
    let acceptAllCount = 0;
    let refuseEssentialCount = 0;
    let totalConsentResponses = 0;

    for (const row of cookieConsentRows) {
      const consentType = (row.cookieConsent || '').toUpperCase();
      const count = Number(row._count?.cookieConsent || 0);
      totalConsentResponses += count;
      if (consentType === 'ALL' || consentType === 'ACCEPT' || consentType === 'ACCEPTED') {
        acceptAllCount += count;
      } else {
        refuseEssentialCount += count;
      }
    }

    const acceptRate = totalConsentResponses > 0
      ? Math.round((acceptAllCount / totalConsentResponses) * 100)
      : 0;

    // Daily traffic trend mapping
    const dailyTraffic = (dailyTrendRows || []).map(r => ({
      date: r.date ? new Date(r.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '',
      views: Number(r.views || 0),
      visitors: Number(r.visitors || 0)
    }));

    const topPages = (topPagesRaw || []).map(p => ({
      path: p.path || '/',
      views: Number(p.views || 0),
      avgDuration: p.avgDuration ? Math.round(Number(p.avgDuration)) : 0,
      _count: { path: Number(p.views || 0) }
    }));

    const uniqueVisitors = Number(uniqueVisitorsRow[0]?.uniqueCount || 0);
    const avgGuestStayDuration = Math.round(guestDurationAgg._avg?.duration || 0);

    res.status(200).json({
      success: true,
      stats: {
        totalViews,
        uniqueVisitors,
        avgGuestStayDuration,
        cookies: {
          totalResponses: totalConsentResponses,
          acceptAll: acceptAllCount,
          refuseEssential: refuseEssentialCount,
          acceptRate
        },
        topPages,
        dailyTraffic,
        devices: (deviceRows || []).map(d => ({
          name: d.device || 'Desktop',
          count: Number(d.count || 0)
        }))
      }
    });
  } catch (error) {
    console.error('[Web Analytics Stats Error]:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};
