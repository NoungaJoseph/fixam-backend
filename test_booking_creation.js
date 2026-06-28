const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function testBooking() {
  try {
    // 1. Create Provider
    const provider = await prisma.user.create({
      data: {
        phone: '1234567890',
        role: 'PROVIDER',
        fullName: 'Test Provider',
        providerProfile: {
          create: {
            skills: ['Plumbing'],
            bio: 'Test bio'
          }
        }
      }
    });

    // 2. Create Client
    const client = await prisma.user.create({
      data: {
        phone: '0987654321',
        role: 'CLIENT',
        fullName: 'Test Client',
        wallet: {
          create: {
            balance: 5
          }
        }
      },
      include: { wallet: true }
    });

    // 3. Attempt Booking Transaction
    const coinCost = 1;
    const bookingBudget = 1000;
    const providerId = provider.id;

    const booking = await prisma.$transaction(async (tx) => {
      const wallet = await tx.wallet.findUnique({ where: { userId: client.id } });
      if (!wallet || wallet.balance < coinCost) {
        throw new Error(`Insufficient coins.`);
      }

      const newBooking = await tx.booking.create({
        data: {
          clientId: client.id,
          providerId,
          taskId: null,
          bookingDate: new Date(),
          bookingTime: "10:00 AM",
          bookingDuration: 'DAY',
          urgencyLevel: 'NORMAL',
          coinCost: coinCost,
          budget: bookingBudget,
          location: 'Test Location',
          notes: 'Test Notes',
        }
      });

      await tx.wallet.update({
        where: { userId: client.id },
        data: { balance: { decrement: coinCost } },
      });

      await tx.transaction.create({
        data: {
          walletId: wallet.id,
          amount: coinCost,
          type: 'DEDUCTION',
          status: 'SUCCESS',
          description: `Booking: NORMAL - Provider`,
          isSystemTransaction: false
        },
      });

      return newBooking;
    });

    console.log("Booking created successfully:", booking.id);
  } catch (error) {
    console.error("Booking failed:", error);
  } finally {
    await prisma.$disconnect();
  }
}

testBooking();
