const prisma = require('../src/config/prisma');

async function testAdminStats() {
  try {
    console.log('Testing Admin Dashboard stats query...');
    const [
      totalUsers,
      totalProviders,
      totalJobs,
      activeJobs,
      completedJobs,
      pendingApprovals,
      totalReports,
      openReports,
      totalFeedback,
      newFeedback,
      recentSignups,
      recentBroadcasts,
      revenueRows,
      monthlyCoinSales
    ] = await prisma.$transaction([
      prisma.user.count({ where: { role: 'CLIENT' } }),
      prisma.user.count({ where: { role: 'PROVIDER' } }),
      prisma.job.count(),
      prisma.job.count({ where: { status: 'IN_PROGRESS' } }),
      prisma.job.count({ where: { status: 'COMPLETED' } }),
      prisma.job.count({ where: { approvalStatus: 'PENDING_APPROVAL' } }),
      prisma.report.count(),
      prisma.report.count({ where: { status: 'PENDING' } }),
      prisma.feedback.count(),
      prisma.feedback.count({ where: { status: 'NEW' } }),
      prisma.user.findMany({
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: { id: true, fullName: true, phone: true, role: true, avatar: true, createdAt: true }
      }),
      prisma.adminMessage.findMany({
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: { id: true, subject: true, content: true, recipientRole: true, createdAt: true }
      }),
      prisma.$queryRaw`
        SELECT COALESCE(SUM(NULLIF(regexp_replace("paidPrice", '[^0-9.]', '', 'g'), '')::float), 0) AS revenue
        FROM "Transaction"
        WHERE type = 'PURCHASE' AND status = 'SUCCESS'
      `,
      prisma.$queryRaw`
        SELECT
          date_trunc('month', "createdAt")::date AS month,
          COALESCE(SUM(amount), 0) AS "coinsPurchased",
          COALESCE(SUM(NULLIF(regexp_replace("paidPrice", '[^0-9.]', '', 'g'), '')::float), 0) AS "revenueFCFA"
        FROM "Transaction"
        WHERE type = 'PURCHASE'
          AND status = 'SUCCESS'
          AND "createdAt" >= date_trunc('month', CURRENT_DATE) - interval '5 months'
        GROUP BY date_trunc('month', "createdAt")::date
        ORDER BY month ASC
      `
    ]);

    console.log('SUCCESS! Admin stats fetched:', {
      totalUsers, totalProviders, totalJobs, activeJobs, completedJobs
    });
  } catch (err) {
    console.error('ERROR in Admin Stats:', err);
  } finally {
    await prisma.$disconnect();
  }
}

testAdminStats();
