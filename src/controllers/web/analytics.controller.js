const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// Track a Page View
exports.trackPageView = async (req, res) => {
  try {
    const { path, domain, duration } = req.body;
    const ipAddress = req.ip || req.connection.remoteAddress;
    const userAgent = req.headers['user-agent'];
    const userId = req.user ? req.user.userId : null;

    const pageView = await prisma.pageView.create({
      data: { path, domain, ipAddress, userAgent, userId, duration }
    });

    res.status(200).json({ success: true });
  } catch (error) {
    console.error("Analytics Error:", error);
    res.status(500).json({ success: false });
  }
};

// Admin: Get Dashboard Stats
exports.getStats = async (req, res) => {
  try {
    // Requires ADMIN role middleware on this route
    
    // Total Page Views
    const totalViews = await prisma.pageView.count();
    
    // Careerpath Enrollments
    const enrollments = await prisma.careerpathEnrollment.count();

    // Group views by path (Simple "Heatmap" representation)
    const viewsByPath = await prisma.pageView.groupBy({
      by: ['path'],
      _count: { path: true },
      orderBy: { _count: { path: 'desc' } },
      take: 10
    });

    res.status(200).json({
      success: true,
      stats: { totalViews, enrollments, topPages: viewsByPath }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};
