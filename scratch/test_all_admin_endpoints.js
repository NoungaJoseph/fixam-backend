const prisma = require('../src/config/prisma');

async function testAllAdminEndpoints() {
  console.log('--- TESTING ALL ADMIN CONTROLLER QUERIES ---');
  try {
    // 1. Stats
    console.log('1. Testing getDashboardStats queries...');
    const [
      totalUsers, totalProviders, totalJobs, activeJobs, completedJobs,
      pendingApprovals, totalReports, openReports, totalFeedback, newFeedback
    ] = await Promise.all([
      prisma.user.count({ where: { role: 'CLIENT' } }),
      prisma.user.count({ where: { role: 'PROVIDER' } }),
      prisma.job.count(),
      prisma.job.count({ where: { status: 'IN_PROGRESS' } }),
      prisma.job.count({ where: { status: 'COMPLETED' } }),
      prisma.job.count({ where: { approvalStatus: 'PENDING_APPROVAL' } }),
      prisma.report.count(),
      prisma.report.count({ where: { status: 'PENDING' } }),
      prisma.feedback.count(),
      prisma.feedback.count({ where: { status: 'NEW' } })
    ]);
    console.log('  -> Basic counts OK:', { totalUsers, totalProviders, totalJobs, activeJobs, completedJobs, pendingApprovals });

    // 2. Raw SQL
    const revenueRows = await prisma.$queryRaw`
      SELECT COALESCE(SUM(NULLIF(regexp_replace("paidPrice", '[^0-9.]', '', 'g'), '')::float), 0) AS revenue
      FROM "Transaction"
      WHERE type = 'PURCHASE' AND status = 'SUCCESS'
    `;
    console.log('  -> Revenue raw query OK:', revenueRows);

    // 3. Users query
    console.log('2. Testing getUsers queries...');
    const users = await prisma.user.findMany({
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: { id: true, fullName: true, email: true, phone: true, role: true, isBlocked: true, createdAt: true }
    });
    console.log('  -> Users count:', users.length);

    // 4. Providers query
    console.log('3. Testing getProviders queries...');
    const providers = await prisma.providerProfile.findMany({
      include: { user: { select: { id: true, fullName: true, email: true, phone: true, role: true } } },
      take: 10
    });
    console.log('  -> Providers count:', providers.length);

    // 5. Jobs query
    console.log('4. Testing getPendingJobs queries...');
    const pendingJobs = await prisma.job.findMany({
      where: { approvalStatus: 'PENDING_APPROVAL' },
      include: { client: { select: { id: true, fullName: true, email: true } } }
    });
    console.log('  -> Pending jobs count:', pendingJobs.length);

    console.log('--- ALL ADMIN QUERIES TESTED SUCCESSFULLY WITH ZERO ERRORS ---');
  } catch (err) {
    console.error('CRITICAL ADMIN QUERY ERROR:', err);
  } finally {
    await prisma.$disconnect();
  }
}

testAllAdminEndpoints();
