const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const test = async () => {
  const userId = "test-user-1";
  const participantId = "test-user-2";

  try {
    const activeJob = await prisma.job.findFirst({
      where: {
        status: { notIn: ['CANCELLED'] },
        OR: [
          {
            clientId: userId,
            assignments: { some: { provider: { userId: participantId }, status: 'ACCEPTED' } },
          },
          {
            clientId: participantId,
            assignments: { some: { provider: { userId }, status: 'ACCEPTED' } },
          },
        ],
      },
      select: { id: true },
    });
    console.log("Job query successful:", activeJob);
  } catch (e) {
    console.error("Job query error:", e.message);
  }

  try {
    const anyBooking = await prisma.booking.findFirst({
      where: {
        status: { in: ['ACCEPTED', 'COMPLETED'] },
        OR: [
          { clientId: userId, providerId: participantId },
          { clientId: participantId, providerId: userId },
        ],
      },
      select: { id: true },
    });
    console.log("Booking query successful:", anyBooking);
  } catch (e) {
    console.error("Booking query error:", e.message);
  }

  await prisma.$disconnect();
};

test();
