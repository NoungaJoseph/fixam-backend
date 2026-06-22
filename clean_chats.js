const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function cleanDuplicates() {
  const supportConvs = await prisma.supportConversation.findMany({
    include: { conversation: { include: { participants: true } } }
  });
  
  // group by userId
  const grouped = {};
  for (const sc of supportConvs) {
    if (!grouped[sc.userId]) grouped[sc.userId] = [];
    grouped[sc.userId].push(sc);
  }

  for (const [userId, convs] of Object.entries(grouped)) {
    if (convs.length > 1) {
      // sort by createdAt desc to keep the newest
      convs.sort((a, b) => b.createdAt - a.createdAt);
      const toDelete = convs.slice(1);
      
      for (const sc of toDelete) {
        console.log(`Deleting duplicate conversation ${sc.conversationId} for user ${userId}`);
        
        // Delete messages first
        await prisma.message.deleteMany({ where: { conversationId: sc.conversationId } });
        
        // Delete participants
        await prisma.conversationParticipant.deleteMany({ where: { conversationId: sc.conversationId } });
        
        // Delete support conversation
        await prisma.supportConversation.delete({ where: { id: sc.id } });
        
        // Delete conversation
        await prisma.conversation.delete({ where: { id: sc.conversationId } });
      }
    }
  }
}

cleanDuplicates().then(() => console.log('Done')).catch(console.error).finally(() => prisma.$disconnect());
