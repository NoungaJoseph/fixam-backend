const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const count = await prisma.providerProfile.count();
  const providers = await prisma.providerProfile.findMany({
    include: { user: true }
  });
  console.log('Total ProviderProfiles:', count);
  providers.forEach(p => {
    console.log(`- ${p.user?.fullName} (Verified: ${p.verification}, Skills: ${p.skills})`);
  });
}

main()
  .catch(e => console.error(e))
  .finally(() => prisma.$disconnect());
