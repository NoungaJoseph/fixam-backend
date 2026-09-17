const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('Checking for mismatched user roles...');
  
  // Find all users with a provider profile in PERSONAL mode but role is PROVIDER
  const usersToUpdate = await prisma.user.findMany({
    where: {
      role: 'PROVIDER',
      providerProfile: {
        profileMode: 'PERSONAL'
      }
    },
    include: {
      providerProfile: true
    }
  });

  console.log(`Found ${usersToUpdate.length} users with mismatched roles:`, usersToUpdate.map(u => ({ id: u.id, phone: u.phone, role: u.role, mode: u.providerProfile?.profileMode })));

  if (usersToUpdate.length > 0) {
    const ids = usersToUpdate.map(u => u.id);
    const result = await prisma.user.updateMany({
      where: {
        id: { in: ids }
      },
      data: {
        role: 'CLIENT'
      }
    });
    console.log(`Successfully updated ${result.count} users to CLIENT role.`);
  } else {
    console.log('No mismatched users found.');
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
