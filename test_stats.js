const prisma = require('./src/config/prisma');

async function test() {
  try {
    const revenueRows = await prisma.$queryRaw`
      SELECT COALESCE(SUM(NULLIF(regexp_replace("paidPrice", '[^0-9.]', '', 'g'), '')::float), 0) AS revenue
      FROM "Transaction"
      WHERE type = 'PURCHASE' AND status = 'SUCCESS'
    `;
    const monthlyCoinSales = await prisma.$queryRaw`
      SELECT
        date_trunc('month', "createdAt")::date AS month,
        COALESCE(SUM(amount), 0) AS "coinsPurchased",
        COALESCE(SUM(NULLIF(regexp_replace("paidPrice", '[^0-9.]', '', 'g'), '')::float), 0) AS "revenueFCFA"
      FROM "Transaction"
      WHERE type = 'PURCHASE'
        AND status = 'SUCCESS'
        AND "createdAt" >= date_trunc('month', CURRENT_DATE) - interval '5 months'
      GROUP BY date_trunc('month', "createdAt")::date
      ORDER BY month ASC
    `;
    console.log("SQL Queries success:", { revenueRows, monthlyCoinSales });
  } catch (err) {
    console.error("SQL query failed:", err);
  } finally {
    await prisma.$disconnect();
  }
}

test();
