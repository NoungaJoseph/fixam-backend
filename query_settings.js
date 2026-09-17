const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  try {
    const settings = await prisma.settings.findMany();
    console.log('Settings:', JSON.stringify(settings, null, 2));
  } catch (error) {
    console.error('Error querying Settings:', error);
  } finally {
    await prisma.$disconnect();
  }
}

main();
