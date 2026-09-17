const prisma = require('../src/config/prisma');

async function main() {
  try {
    const totalJobs = await prisma.job.count();
    const pendingStatusCount = await prisma.job.count({ where: { status: 'PENDING' } });
    const approvedCount = await prisma.job.count({ where: { approvalStatus: 'APPROVED' } });
    const pendingApprovalCount = await prisma.job.count({ where: { approvalStatus: 'PENDING_APPROVAL' } });
    const availableApprovedPending = await prisma.job.count({
      where: {
        status: 'PENDING',
        approvalStatus: 'APPROVED'
      }
    });

    console.log('\n--- JOB STATS IN DATABASE ---');
    console.log(`Total Jobs in DB: ${totalJobs}`);
    console.log(`Jobs with status 'PENDING': ${pendingStatusCount}`);
    console.log(`Jobs with approvalStatus 'APPROVED': ${approvedCount}`);
    console.log(`Jobs with approvalStatus 'PENDING_APPROVAL': ${pendingApprovalCount}`);
    console.log(`Available Jobs (PENDING + APPROVED): ${availableApprovedPending}`);

    const allJobs = await prisma.job.findMany({
      take: 10,
      select: {
        id: true,
        title: true,
        status: true,
        approvalStatus: true,
        isRemote: true,
        country: true,
        createdAt: true,
        client: { select: { fullName: true, email: true } }
      },
      orderBy: { createdAt: 'desc' }
    });

    console.log('\n--- RECENT 10 JOBS ---');
    console.dir(allJobs, { depth: null });
  } catch (err) {
    console.error('Error querying jobs:', err);
  } finally {
    await prisma.$disconnect();
  }
}

main();
