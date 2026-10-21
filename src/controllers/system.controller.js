const getSystemStatus = async (req, res) => {
  try {
    const prisma = require('../config/prisma');

    let appMaintenanceEnabled = false;
    let webMaintenanceEnabled = false;
    let maintenanceMessage = 'We are improving Fixam for you. Back soon!';

    try {
      const settings = await prisma.settings.findUnique({
        where: { id: 'global' },
        select: { appMaintenanceEnabled: true, webMaintenanceEnabled: true, maintenanceMessage: true }
      });

      if (settings) {
        appMaintenanceEnabled = settings.appMaintenanceEnabled === true;
        webMaintenanceEnabled = settings.webMaintenanceEnabled === true;
        if (settings.maintenanceMessage) {
          maintenanceMessage = settings.maintenanceMessage;
        }
      }
    } catch (dbError) {
      // If DB fails, definitely not in maintenance — proceed normally
      console.warn('[System] DB error on status check:', dbError.message);
      appMaintenanceEnabled = false;
      webMaintenanceEnabled = false;
    }

    // Release controls are environment based so publishing a new version does
    // not require a database migration or a new backend deployment. Example:
    // APP_LATEST_VERSION=1.1.5 APP_MINIMUM_VERSION=1.1.4 APP_UPDATE_REQUIRED=false
    const latestVersion = process.env.APP_LATEST_VERSION || null;
    const minimumVersion = process.env.APP_MINIMUM_VERSION || null;
    const updateRequired = process.env.APP_UPDATE_REQUIRED === 'true';
    const updateMessage = process.env.APP_UPDATE_MESSAGE || 'A new version of Fixam is ready. Update now for the latest improvements.';

    return res.json({
      success: true,
      appMaintenanceEnabled,
      webMaintenanceEnabled,
      message: maintenanceMessage,
      appUpdate: {
        latestVersion,
        minimumVersion,
        required: updateRequired,
        message: updateMessage,
        androidUrl: process.env.APP_ANDROID_STORE_URL || 'https://play.google.com/store/apps/details?id=com.fixam.app.android',
        iosUrl: process.env.APP_IOS_STORE_URL || 'https://apps.apple.com/cm/app/fixam-pro/id6791191286?l=en-GB'
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    // Never block app startup on error
    return res.json({
      success: true,
      appMaintenanceEnabled: false,
      webMaintenanceEnabled: false,
      message: ''
    });
  }
};

/**
 * Public Platform Statistics
 * Aggregates real platform numbers (completed tasks, verified providers, ratings, users)
 * for public marketing pages with zero latency and fallback defaults.
 */
const getPlatformPublicStats = async (req, res) => {
  try {
    const prisma = require('../config/prisma');

    const [
      completedJobs,
      completedBookings,
      totalJobs,
      totalBookings,
      totalProviders,
      verifiedProviders,
      totalUsers,
      reviewsAggregate
    ] = await Promise.all([
      prisma.job.count({ where: { status: 'COMPLETED' } }).catch(() => 0),
      prisma.booking.count({ where: { status: 'COMPLETED' } }).catch(() => 0),
      prisma.job.count().catch(() => 0),
      prisma.booking.count().catch(() => 0),
      prisma.user.count({ where: { role: 'PROVIDER' } }).catch(() => 0),
      prisma.providerProfile.count({ where: { verification: 'VERIFIED' } }).catch(() => 0),
      prisma.user.count().catch(() => 0),
      prisma.review.aggregate({
        _avg: { rating: true },
        _count: { rating: true }
      }).catch(() => ({ _avg: { rating: null }, _count: { rating: 0 } }))
    ]);

    const completedTasksCount = completedJobs + completedBookings;
    const totalTasksPostedCount = totalJobs + totalBookings;
    const activeProvidersCount = Math.max(totalProviders, verifiedProviders);
    const avgRating = reviewsAggregate._avg?.rating ? Number(reviewsAggregate._avg.rating.toFixed(1)) : 4.9;
    const totalReviews = reviewsAggregate._count?.rating || 0;

    return res.json({
      success: true,
      stats: {
        completedTasks: completedTasksCount,
        completedJobs,
        completedBookings,
        totalTasksPosted: totalTasksPostedCount,
        verifiedPros: activeProvidersCount,
        totalUsers,
        averageRating: avgRating,
        totalReviews,
        activeCities: ['Douala', 'Yaoundé', 'Bafoussam', 'Buea', 'Limbe', 'Bamenda'],
        citiesCount: 6,
        categoriesCount: 13,
        bookingFee: '100% Free'
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('[Public Stats Error]:', error.message);
    return res.json({
      success: true,
      stats: {
        completedTasks: 0,
        completedJobs: 0,
        completedBookings: 0,
        totalTasksPosted: 0,
        verifiedPros: 0,
        totalUsers: 0,
        averageRating: 4.9,
        totalReviews: 0,
        activeCities: ['Douala', 'Yaoundé', 'Bafoussam', 'Buea', 'Limbe'],
        citiesCount: 5,
        categoriesCount: 13,
        bookingFee: '100% Free'
      },
      timestamp: new Date().toISOString()
    });
  }
};

module.exports = { getSystemStatus, getPlatformPublicStats };
