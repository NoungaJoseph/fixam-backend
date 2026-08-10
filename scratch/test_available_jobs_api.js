const prisma = require('../src/config/prisma');

async function testQuery() {
  try {
    const user = await prisma.user.findFirst({
      where: { role: 'PROVIDER' }
    });

    if (!user) {
      console.log('No provider user found in DB');
      return;
    }

    console.log(`Testing query for provider user: ${user.fullName} (${user.id}), Country: ${user.country}`);

    const req = {
      user: { id: user.id, country: user.country || 'Cameroon', role: user.role },
      query: { page: 1, limit: 10, search: '', sortBy: 'newest' }
    };

    const { page = 1, limit = 10, search = '', location = '', sortBy = 'newest', budgetMin, budgetMax, jobType = '' } = req.query;
    const skip = (page - 1) * limit;

    const whereClause = {
      clientId: { not: req.user.id },
      status: 'PENDING',
      approvalStatus: 'APPROVED',
      assignments: {
        none: {
          OR: [
            { provider: { userId: req.user.id } },
            { status: 'ACCEPTED' }
          ]
        }
      }
    };

    const providerCountry = req.user.country || 'Cameroon';

    if (jobType === 'remote') {
      whereClause.isRemote = true;
    } else if (jobType === 'physical') {
      whereClause.OR = [
        { isRemote: false, country: providerCountry },
        { isRemote: false }
      ];
    } else {
      whereClause.OR = [
        { isRemote: true },
        { isRemote: false, country: providerCountry },
        { isRemote: false, country: null },
        { isRemote: false, country: '' }
      ];
    }

    console.log('Where clause:', JSON.stringify(whereClause, null, 2));

    const total = await prisma.job.count({ where: whereClause });
    console.log('Total count:', total);

    const jobs = await prisma.job.findMany({
      where: whereClause,
      include: {
        client: {
          select: {
            id: true, fullName: true, avatar: true,
            providerProfile: { select: { verification: true } }
          }
        },
        assignments: { 
          select: { 
            id: true, 
            providerId: true, 
            status: true, 
            boostCoins: true, 
            assignedAt: true,
            provider: {
              select: {
                id: true,
                user: {
                  select: { id: true, fullName: true, avatar: true }
                }
              }
            }
          } 
        }
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take: parseInt(limit)
    });

    console.log(`Found ${jobs.length} jobs.`);

    if (jobs.length > 0) {
      const clientIds = [...new Set(jobs.map(j => j.clientId))];
      console.log('Client IDs:', clientIds);

      const spendingData = await prisma.transaction.groupBy({
        by: ['walletId'],
        where: { type: 'DEDUCTION', status: 'SUCCESS', wallet: { userId: { in: clientIds } } },
        _sum: { amount: true }
      });
      console.log('Spending data:', spendingData);
    }
  } catch (err) {
    console.error('API Error caught:', err);
  } finally {
    await prisma.$disconnect();
  }
}

testQuery();
