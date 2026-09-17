require('dotenv').config();
const { calculateProviderStats } = require('./src/utils/providerStats');
const prisma = require('./src/config/prisma');

async function fixStats() {
  console.log('Recalculating stats for all providers...');
  const providers = await prisma.providerProfile.findMany();
  
  for (const provider of providers) {
    try {
      await calculateProviderStats(provider.id);
      console.log(`Updated provider ${provider.id}`);
    } catch (e) {
      console.error(`Failed to update provider ${provider.id}`, e.message);
    }
  }

  console.log('Done recalculating providers.');
}

fixStats()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
