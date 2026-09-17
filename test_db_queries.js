const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function testDatabaseQueries() {
  console.log('Testing Prisma queries to verify the manual SQL migration...');
  
  try {
    // Test 1: Jobs (checking budgetMin / budgetMax)
    console.log('\n1. Testing Job table (budgetMin/budgetMax)...');
    const jobs = await prisma.job.findMany({
      take: 1,
      select: { id: true, title: true, budgetMin: true, budgetMax: true }
    });
    console.log('✅ Job query successful:', jobs.length ? jobs[0] : 'No jobs found, but query succeeded');

    // Test 2: Chat Conversations (checking Message.deliveredAt/readAt)
    console.log('\n2. Testing Message table (deliveredAt/readAt)...');
    const messages = await prisma.message.findMany({
      take: 1,
      select: { id: true, content: true, deliveredAt: true, readAt: true }
    });
    console.log('✅ Message query successful:', messages.length ? messages[0] : 'No messages found, but query succeeded');

    // Test 3: Wallet Transactions (checking Transaction.paymentMethod)
    console.log('\n3. Testing Transaction table (paymentMethod, providerReference)...');
    const txs = await prisma.transaction.findMany({
      take: 1,
      select: { id: true, amount: true, paymentMethod: true, providerReference: true }
    });
    console.log('✅ Transaction query successful:', txs.length ? txs[0] : 'No transactions found, but query succeeded');

    // Test 4: New Tables (Payment, Booking)
    console.log('\n4. Testing Payment table...');
    const payments = await prisma.payment.findMany({ take: 1 });
    console.log('✅ Payment query successful');

    console.log('\n🎉 ALL DB QUERIES PASSED. The 500 API errors should now be resolved!');
  } catch (error) {
    console.error('\n❌ ERROR during query:', error.message);
  } finally {
    await prisma.$disconnect();
  }
}

testDatabaseQueries();
