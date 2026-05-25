CREATE TYPE "PaymentMethod" AS ENUM ('MTN_MOMO', 'ORANGE_MONEY');
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'PROCESSING', 'SUCCESS', 'FAILED', 'CANCELLED');
CREATE TYPE "BookingStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED', 'CANCELLED', 'COMPLETED');
CREATE TYPE "SupportConversationStatus" AS ENUM ('OPEN', 'WAITING', 'RESOLVED');

ALTER TABLE "Job" ADD COLUMN "budgetMin" DOUBLE PRECISION;
ALTER TABLE "Job" ADD COLUMN "budgetMax" DOUBLE PRECISION;
UPDATE "Job" SET "budgetMin" = "budget", "budgetMax" = "budget" WHERE "budgetMin" IS NULL OR "budgetMax" IS NULL;

ALTER TABLE "Transaction" ADD COLUMN "paymentMethod" "PaymentMethod";
ALTER TABLE "Transaction" ADD COLUMN "providerReference" TEXT;
ALTER TABLE "Transaction" ADD COLUMN "phoneNumber" TEXT;

CREATE TABLE "Payment" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "transactionId" TEXT,
  "amount" INTEGER NOT NULL,
  "coins" INTEGER NOT NULL,
  "paymentMethod" "PaymentMethod" NOT NULL,
  "providerReference" TEXT,
  "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
  "phoneNumber" TEXT NOT NULL,
  "providerPayload" JSONB,
  "failureReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CoinPurchase" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "paymentId" TEXT NOT NULL,
  "transactionId" TEXT,
  "amount" INTEGER NOT NULL,
  "coins" INTEGER NOT NULL,
  "paymentMethod" "PaymentMethod" NOT NULL,
  "providerReference" TEXT,
  "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
  "phoneNumber" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CoinPurchase_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SupportConversation" (
  "id" TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "assignedAdminId" TEXT,
  "status" "SupportConversationStatus" NOT NULL DEFAULT 'OPEN',
  "lastReadAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SupportConversation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Booking" (
  "id" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "providerId" TEXT NOT NULL,
  "taskId" TEXT,
  "bookingDate" TIMESTAMP(3) NOT NULL,
  "bookingTime" TEXT NOT NULL,
  "status" "BookingStatus" NOT NULL DEFAULT 'PENDING',
  "budget" DOUBLE PRECISION NOT NULL,
  "location" TEXT NOT NULL,
  "notes" TEXT,
  "paymentStatus" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Booking_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Message" ADD COLUMN "deliveredAt" TIMESTAMP(3);
ALTER TABLE "Message" ADD COLUMN "readAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "Payment_transactionId_key" ON "Payment"("transactionId");
CREATE UNIQUE INDEX "Payment_providerReference_key" ON "Payment"("providerReference");
CREATE INDEX "Payment_userId_createdAt_idx" ON "Payment"("userId", "createdAt");
CREATE INDEX "Payment_status_createdAt_idx" ON "Payment"("status", "createdAt");
CREATE INDEX "Payment_paymentMethod_createdAt_idx" ON "Payment"("paymentMethod", "createdAt");

CREATE UNIQUE INDEX "CoinPurchase_paymentId_key" ON "CoinPurchase"("paymentId");
CREATE UNIQUE INDEX "CoinPurchase_transactionId_key" ON "CoinPurchase"("transactionId");
CREATE INDEX "CoinPurchase_userId_createdAt_idx" ON "CoinPurchase"("userId", "createdAt");
CREATE INDEX "CoinPurchase_status_createdAt_idx" ON "CoinPurchase"("status", "createdAt");

CREATE UNIQUE INDEX "SupportConversation_conversationId_key" ON "SupportConversation"("conversationId");
CREATE INDEX "SupportConversation_userId_status_idx" ON "SupportConversation"("userId", "status");
CREATE INDEX "SupportConversation_status_updatedAt_idx" ON "SupportConversation"("status", "updatedAt");

CREATE INDEX "Booking_clientId_createdAt_idx" ON "Booking"("clientId", "createdAt");
CREATE INDEX "Booking_providerId_createdAt_idx" ON "Booking"("providerId", "createdAt");
CREATE INDEX "Booking_status_bookingDate_idx" ON "Booking"("status", "bookingDate");

ALTER TABLE "Payment" ADD CONSTRAINT "Payment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CoinPurchase" ADD CONSTRAINT "CoinPurchase_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CoinPurchase" ADD CONSTRAINT "CoinPurchase_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CoinPurchase" ADD CONSTRAINT "CoinPurchase_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SupportConversation" ADD CONSTRAINT "SupportConversation_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SupportConversation" ADD CONSTRAINT "SupportConversation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Job"("id") ON DELETE SET NULL ON UPDATE CASCADE;
